/**
 * Masar AI (مسار) — Precision Career & Interview Mentor.
 * Cloudflare Worker Backend.
 *
 * Core Capabilities:
 * - Multi-turn conversational memory (contextual follow-up understanding).
 * - Strict factual grounding (NO outside hallucination / guessing; strictly based on the 7 playbooks).
 * - Out-of-domain detection and refusal (strictly prevents answering general trivia/outside topics).
 * - Contextual standalone query reformulation for accurate follow-up retrieval.
 * - Language matching (pure English on English prompts, pure Arabic on Arabic prompts).
 * - High-availability multi-model LLM fallback chain.
 */

const TOP_K_CANDIDATES = 20;
const TOP_N_AFTER_RERANK = 4;
const RELEVANCE_THRESHOLD = 0.20; // Calibrated relevance threshold for bge-reranker-base
const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 6;

// High-availability fallback chain
const LLM_MODELS_FALLBACK_CHAIN = [
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.2-lora",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok", app: "Masar AI", memory: true }, 200);
    }

    if (url.pathname !== "/chat") {
      return jsonResponse({ error: "Not found. POST a question to /chat." }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_MESSAGES) : [];

    if (!question) {
      return jsonResponse({ error: "The 'question' field must not be empty." }, 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse(
        { error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters).` },
        400
      );
    }

    const wantsStream = body.stream === true;

    if (wantsStream) {
      try {
        const { stream: llmStream, sources } = await answerQuestion(question, history, env, true);

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        (async () => {
          try {
            // First send sources metadata
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`));

            const reader = llmStream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              await writer.write(value);
            }
          } catch (streamErr) {
            console.error("Stream piping error:", streamErr);
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", error: streamErr.message })}\n\n`));
          } finally {
            try {
              await writer.close();
            } catch (_) {}
          }
        })();

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        console.error("Masar AI streaming pipeline error:", err);
        return jsonResponse(
          {
            error: "Something went wrong while processing your request.",
            detail: String(err && err.message ? err.message : err),
          },
          500
        );
      }
    }

    try {
      const answerPayload = await answerQuestion(question, history, env, false);
      return jsonResponse(answerPayload, 200);
    } catch (err) {
      console.error("Masar AI pipeline error:", err);
      return jsonResponse(
        {
          error: "Something went wrong while processing your request.",
          detail: String(err && err.message ? err.message : err),
        },
        500
      );
    }
  },
};

/**
 * Executes LLM call with automated multi-model fallback and streaming.
 */
async function callLLMStreamWithFallback(env, payload) {
  let lastError = null;

  for (const model of LLM_MODELS_FALLBACK_CHAIN) {
    try {
      const stream = await env.AI.run(model, {
        ...payload,
        stream: true,
      });
      if (stream) {
        return { stream, modelUsed: model };
      }
    } catch (err) {
      console.warn(`Streaming with model ${model} failed, trying next fallback:`, err && err.message ? err.message : err);
      lastError = err;
    }
  }

  throw new Error(`All LLM models in fallback chain failed for streaming. Last error: ${lastError && lastError.message}`);
}

/**
 * Executes LLM call with automated multi-model fallback.
 */
async function callLLMWithFallback(env, payload) {
  let lastError = null;

  for (const model of LLM_MODELS_FALLBACK_CHAIN) {
    try {
      const res = await env.AI.run(model, payload);
      if (res && res.response) {
        return { response: res.response, modelUsed: model };
      }
    } catch (err) {
      console.warn(`Model ${model} failed, trying next fallback:`, err && err.message ? err.message : err);
      lastError = err;
    }
  }

  throw new Error(`All LLM models in fallback chain failed. Last error: ${lastError && lastError.message}`);
}

function isArabic(text) {
  const arabicPattern = /[\u0600-\u06FF]/;
  return arabicPattern.test(text);
}

function cleanQuery(query) {
  return query
    .replace(/[_\t]+/g, " ")
    .replace(/\b(zou)\b/gi, "you")
    .replace(/\b(hlep)\b/gi, "help")
    .trim();
}

function stripArabicFillers(text) {
  return text
    .toLowerCase()
    .replace(/[؟?.,!،_«»"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(طب|طيب|يعني|هو|هي|طب هو|طيب هو|يا ريت|لو سمحت|ممكن|طب ممكن|ممكن تقولي|ممكن تفهمني|ممكن تساعدني|قولي|فهمني|فهمنا|عرفني|تحب|عايز اعرف|عايزك|عايزة اعرف|حابب اعرف|محتاج اعرف)\s+/, "")
    .trim();
}

function isTopicAdviceOrChoiceQuestion(text) {
  const raw = text.trim().toLowerCase();
  const stripped = stripArabicFillers(raw);

  const arPatterns = [
    /(انهي|أنهي|انهي واحده|انهي واحدة|انهي مجال|اي واحده|أي واحدة|اي مجال|أي مجال|ايهم|أيهم|انهو)/,
    /(نبدأ بايه|نبدأ بإيه|نبتدي بايه|نبتدي بإيه|ابدا بايه|أبدأ بإيه|ابدأ منين|نبدأ منين)/,
    /(تنصحني بايه|تنصحني بإيه|شايف ايه|ايه رأيك|إيه رأيك|اختار انت|اختارلي|قولي انت|رشحلي|بماذا تنصحني|ابدا بايه|أبدأ بإيه)/,
    /(مش عارف اختار|محتار|مش عارف ابدأ|مش عارفه ابدأ)/
  ];

  const enPatterns = [
    /(which one|which domain|which topic|which playbook|where should we start|what do you recommend|pick one|choose for me)/
  ];

  return arPatterns.some((p) => p.test(raw) || p.test(stripped)) ||
         enPatterns.some((p) => p.test(raw));
}

function getTopicAdviceResponse(isAr) {
  if (isAr) {
    return `بما أن كل مرحلة مهنية بتكمل التي تليها، **أنصحك بالبدء وفقاً لأولويتك ووضعك الحالي:**

1. **إذا كنت في مرحلة البحث والتقديم على الوظائف:**  
   أنصحك أن نبدأ بـ **«صياغة وتطوير السيرة الذاتية (ATS Resume)»** لتحويل إنجازاتك إلى صياغة رقمية قياسية وتخطي أنظمة الفرز الآلي.

2. **إذا كان لديك موعد مقابلة شخصية قادمة قريباً:**  
   من الأفضل أن نقفز مباشرة للتدريب على **«المقابلات السلوكية (منهجية STAR)»** أو **«المقابلات التقنية»** لترتيب إجاباتك باحترافية وثقة.

3. **إذا تلقيت عرض عمل (Job Offer) بالفعل:**  
   نبدأ فوراً بـ **«استراتيجيات التفاوض على الراتب»** لتقييم العرض الشامل وصياغة عروض الرد المضادة.

4. **إذا كنت تخطط للدخول في مجالات البيانات:**  
   نستكشف معاً **«مسارات وظائف تكنولوجيا البيانات (Data Roles)»** لمعرفة الفروق والمهارات المطلوبة لكل مسار.

**أخبرني، ما هو وضعك وأولويتك الحالية الآن؟ هل تحضر الـ CV أم تستعد لمقابلة عمل؟**`;
  }
  return `Depending on your current priority, here is my recommendation on where we should start:

1. **If you are actively applying for positions:**  
   I recommend starting with **ATS Resume Optimization** to craft metric-driven bullet points that clear recruiter ATS screeners.

2. **If you have an upcoming interview:**  
   Let's jump straight into **Behavioral Interviews (STAR Method)** or **Technical & System Design** drills.

3. **If you already received a job offer:**  
   We should focus on **Salary Negotiation Playbook** to benchmark compensation and frame counteroffers.

4. **If exploring data tracks:**  
   We can break down **Data Career Roadmaps (Analyst vs Engineer vs Scientist)**.

Which of these matches your current situation best?`;
}

function isIdentityOrCapabilityQuestion(text) {
  const raw = text.trim().toLowerCase();
  const stripped = stripArabicFillers(raw);

  const arPatterns = [
    // Identity questions
    /(مين انت|من أنت|انت مين|أنت مين|عرف نفسك|مين مسار|ايه مسار|ما هو مسار|عرفني بنفسك|اسمك ايه|هو انت مين|من مسار)/,
    // Capabilities and services
    /(تساعدني|تساعد|تفيدني|تفيد)\s*(ب|ف|في|بإيه|بايه|بشو)?/,
    /(تقدر|ممكن|بتقدر|تستطيع|مستعد)\s+(تساعد|تفيد|تعمل|تقدّم|تقدم|تفهمني|تفهمنا)/,
    /(ايه|إيه|ما هي|ما)\s*(خدماتك|وظيفتك|فائدتك|فايدتك|شغلتك|مهامك)/,
    /(بتعمل|بتعملوا|بتعملو|بتسوي|بتسووا|بتفيد|بتفيدوا|بتساعد)\s*(ايه|إيه|شنو|شو|بايه|بإيه|في ايه|ف ايه)?/,
    /(تفهمني ايه|تفهمني إيه|ممكن تفهمني|ممكن تفيدني|خدماتك ايه|ايه فايدتك|بتفيد بإيه)/,
    // Scope, topics, playbooks overview
    /(تكلمني عن ايه|تكلمني عن إيه|نتكلم في ايه|نتكلم ف ايه|تحب نتكلم|ايه المواضيع|إيه المواضيع|ايه المجالات|ايه هما الادلة|ايه هما الأدلة|ايه هي الادلة|ايه هي الأدلة|الادلة السبعة|الأدلة السبعة|7 ادلة|7 أدلة|كتب ايه|ملفات ايه|مراجع ايه)/
  ];

  const enPatterns = [
    /(who are you|what is masar|what are you|introduce yourself)/,
    /(what can you do|how can you help|what do you do|what are your capabilities|what services)/,
    /(what topics|what can we talk about|what are the 7 playbooks|which playbooks|tell me about them|what do you cover)/
  ];

  return arPatterns.some((p) => p.test(raw) || p.test(stripped)) ||
         enPatterns.some((p) => p.test(raw));
}

function isGreetingOrSmallTalk(text) {
  const raw = text.trim().toLowerCase();
  const stripped = stripArabicFillers(raw);

  const arGreetings = [
    /^(أهلا|اهلا|مرحبا|مرحباً|مرحب|مراحب|اهلين|أهلين|مرحبتين|هلا|يا هلا|هلا وغلا|هلا والله|حياك|حياك الله|سلام|السلام عليكم|سلام عليكم|سلامات|صباح الخير|مساء الخير|صباح النور|مساء النور|صباح الورد|مساء الورد|يسعد صباحك|يسعد مساك|هاي|ازيك|إزيك|عامل ايه|عاملة ايه|كيف حالك|كيفك|شخبارك|اخبارك|إخبارك|علومك|شعلومك|شمسوي|كيف الامور|كيف الأمور|منور|تحياتي|اهلا وسهلا|أهلا وسهلا)/,
    /^(شكرا|شكراً|تسلم|تسلمي|جزاك الله خيرا|يعطيك العافية|تمام|ماشي|أوك|اوك|ok|bye|مع السلامة|باي)$/
  ];

  const enGreetings = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|sup|greetings)\b/,
    /^(how are you|how are you doing|how is it going)\b/,
    /^(thanks|thank you|thx|cool|awesome|great|ok|okay|bye|goodbye|see you)\b/
  ];

  return arGreetings.some((r) => r.test(raw) || r.test(stripped)) ||
         enGreetings.some((r) => r.test(raw));
}

function getGreetingResponse(isAr) {
  if (isAr) {
    return "يا أهلاً وسهلاً بك! أنا مسار، مرشدك المهني والوظيفي الذكي. أنا هنا لمساعدتك في كل ما يخص مستقبلك المهني والتحضير للوظائف استناداً إلى أدلتنا السبعة المعتمدة (صياغة السيرة الذاتية واجتياز الفرز الآلي، المقابلات السلوكية والتقنية، التفاوض على الرواتب، ومسارات وظائف البيانات). كيف يمكنني مساعدتك اليوم؟";
  }
  return "Hello! I am Masar AI, your precision career and interview mentor. I am here to help you navigate your professional journey grounded in our 7 verified playbooks—covering ATS resume optimization, behavioral & technical interviews, salary negotiation, and data career roadmaps. How can I assist you today?";
}

function getCapabilityResponse(isAr) {
  if (isAr) {
    return `أهلاً بك! أنا **مسار**، مرشدك المهني الذكي. مهمتي تقديم استشارات مهنية دقيقة وموثوقة استناداً إلى **أدلتنا السبعة المعتمدة**، ويمكنني مساعدتك خطوة بخطوة في المجالات التالية:

1. **صياغة وتحسين السيرة الذاتية (ATS Resume):** تحويل إنجازاتك إلى صياغة رقمية قياسية وتخطي أنظمة الفرز الآلي بنجاح.
2. **المقابلات السلوكية (منهجية STAR):** التدريب على صياغة مواقفك وإجاباتك باحترافية وفق نموذج (الموقف، المهمة، الإجراء، النتيجة).
3. **المقابلات التقنية وتصميم الأنظمة (System Design):** استراتيجيات حل المشكلات البرمجية، التفكير المنطقي، وهندسة الأنظمة.
4. **التفاوض على العروض والرواتب:** تقييم القيمة السوقية، إدارة العروض الوظيفية، وصياغة عروض الرد المضادة.
5. **مسارات وظائف تكنولوجيا البيانات:** توضيح الفروق والمهارات المطلوبة لكل من مسارات Data Analyst و Data Engineer و Data Scientist.
6. **تحليل بطاقات الوصف الوظيفي (Job Descriptions):** استخراج الكلمات المفتاحية ومطابقة خبراتك بدقة مع متطلبات الوظيفة المستهدفة.

تحب نبدأ بمناقشة أي من هذه المجالات؟ أو اكتب لي سؤالك مباشرة!`;
  }
  return `Hello! I am **Masar AI**, your precision Career Intelligence Mentor. I am here to guide you through your professional career journey strictly grounded in our **7 verified playbooks**:

1. **ATS Resume Optimization:** Crafting metric-driven bullet points that clear recruiter ATS screeners.
2. **Behavioral Interviews (STAR Method):** Structuring impactful answers using Situation, Task, Action, and Result.
3. **Technical Interviews & System Design:** Problem-solving approaches, coding patterns, and system design frameworks.
4. **Salary & Offer Negotiation:** Total compensation evaluation, leverage discovery, and framing counteroffers.
5. **Data Career Roadmaps:** Understanding role expectations across Data Analyst, Data Engineer, and Data Scientist.
6. **Job Description Keyword Analysis:** Extracting core competencies and aligning your profile to job postings.

Which of these domains would you like to explore first? Or feel free to ask any specific career question!`;
}

function getOutOfDomainResponse(isAr) {
  if (isAr) {
    return "عذراً، هذا الموضوع خارج نطاق الأدلة المهنية المعتمدة المتاحة لدي. أنا مرشد مهني مخصص فقط لمساعدتك في موضوعات التطوير المهني والوظائف المذكورة في أدلتنا السبعة (كتابة السيرة الذاتية، المقابلات الشخصية والتقنية، التفاوض على الرواتب، ومسارات وظائف البيانات). هل ترغب في سؤالي عن أي من هذه المجالات المهنية؟";
  }
  return "I apologize, but this topic is outside the scope of our verified career playbooks. I am strictly specialized in career guidance (resume writing, job description analysis, behavioral and technical interviews, salary negotiation, career growth, and data roles). How can I assist you with your career preparation?";
}

function createStaticStream(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: text })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/**
 * Resolves standalone search query taking prior conversation history into account.
 * Crucial for follow-up questions like "can you give me an example of this?" or "how about the second point?".
 */
async function resolveSearchQuery(question, history, isAr, env) {
  // If there's no history, standard translation/cleaning is enough
  if (!history || history.length === 0) {
    if (isAr) {
      try {
        const transResult = await callLLMWithFallback(env, {
          messages: [
            {
              role: "system",
              content:
                "You are a search query translator for tech career documents. Translate the user query into concise English search keywords (2 to 8 words). Output ONLY the English search keywords with no explanations, no quotes, and no conversational filler. If purely small talk or greeting, output 'greeting'.",
            },
            { role: "user", content: question },
          ],
          max_tokens: 30,
        });
        if (transResult && transResult.response) {
          const parsed = transResult.response
            .trim()
            .replace(/^["']|["']$/g, "")
            .split("\n")[0]
            .trim();
          if (parsed && parsed.length > 2 && !parsed.toLowerCase().includes("greeting")) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn("Translation bridge skipped:", e);
      }
    }
    return question;
  }

  // With history: reformulate into standalone search query
  try {
    const historySummary = history
      .slice(-4)
      .map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.content.slice(0, 600)}`)
      .join("\n\n");

    const reformulationSystem =
      "You are an AI search query generator for a career coaching system grounded in tech career playbooks. " +
      "Given the chat history and follow-up question, identify the core career topic and output ONLY a concise English search phrase (2 to 8 words). " +
      "No intro text, no conversational filler. If purely greeting, output 'greeting'.";

    const refResult = await callLLMWithFallback(env, {
      messages: [
        { role: "system", content: reformulationSystem },
        {
          role: "user",
          content: `Chat History:\n${historySummary}\n\nLatest Question: "${question}"\n\nSearch Keywords:`,
        },
      ],
      max_tokens: 30,
    });

    if (refResult && refResult.response) {
      const parsed = refResult.response
        .trim()
        .replace(/^["']|["']$/g, "")
        .split("\n")[0]
        .trim();
      if (parsed && parsed.length > 2 && !parsed.toLowerCase().includes("greeting")) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Query contextualization skipped, using original query:", err);
  }

  return question;
}

/**
 * Builds the Master Unified System Prompt for Masar AI.
 * Enforces strict grounding, no outside hallucination, language consistency, and domain boundary protection.
 */
function buildMasterSystemPrompt(isAr) {
  if (isAr) {
    return `أنت "مَسار" (Masar AI) — مرشد مهني ومستشار مقابلات وظيفية مبني حصراً على أدلة التطوير المهني السبعة المرفقة.

قواعد الالتزام المعرفي الصارم (Strict Grounding — ممنوع الفتي والخروج عن النص تماماً):
1. الالتزام الحصري بالأدلة المرفقة:
   - إجاباتك المهنية يجب أن تنبع حصراً من نصوص "Career Playbook Reference Material" المرفقة في هذه الرسالة.
   - يُحظر تماماً الإجابة عن أي أسئلة خارج نطاق هذه الأدلة أو من معلوماتك العامة المسبقة (مثل العلوم العامة، الدراسات الاجتماعية، التاريخ، الجغرافيا، الرياضة، السياسة، الطبخ، الفن، إلخ).
   - إذا كان سؤال المستخدم لا يمكن الإجابة عليه حصراً من نصوص الأدلة المرفقة أعلاه، اعتذر بلطف وبيّن أن هذا الموضوع خارج نطاق أدلتك المهنية المعتمدة (السيرة الذاتية، المقابلات، تحليل الوظائف، التفاوض على الراتب، مسارات البيانات).
   - لا تخترع أو تفترض أي إجابة من عندك إطلاقاً.

2. استمرارية المحادثة والذاكرة التفاعلية (Conversational Memory):
   - تابع سياق الحوار السابق مع المستخدم بسلاسة؛ افهم الضمائر والإشارات (مثل "عايز مثال على ده"، "اشرحلي أكتر"، "طب إزاي أطبق النقطة التانية عملياً؟").
   - وسّع الشرح وبسّط المفاهيم اعتماداً على ما تم مناقشته وسياق الأدلة دون أن تجبر المستخدم على إعادة كتابة الكلمات المفتاحية.
   - لا تكرر نفسك ولا تعد تعريف نفسك في كل رسالة؛ تحدث معه كجلسة إرشاد مستمرة بين إنسان ومستشاره.

3. التوثيق والمصادر:
   - اذكر دائماً اسم الدليل ورقم الصفحة عند تقديم النصائح المهنية (مثال: [Resume Writing Best Practices, Page 2]).

4. اتساق اللغة:
   - تحدّث بلغة عربية فصحى طبيعية وسلسة دون أي تكلف.`;
  }

  return `You are Masar AI — a precision Career & Interview Mentor strictly grounded in the 7 verified tech career playbooks.

STRICT GROUNDING & DOMAIN BOUNDARIES:
1. Strict Grounding — Zero Hallucination:
   - Ground all professional advice strictly and exclusively in the provided Career Playbook Reference Materials below.
   - Do NOT answer questions outside the scope of these career playbooks using pre-trained general knowledge (e.g. social studies, history, science, geography, trivia, entertainment).
   - If the user's question cannot be answered purely and directly from the provided Career Playbook Reference Material, you MUST refuse and state:
     "I apologize, but this topic is outside the scope of the verified career playbooks. I am strictly specialized in career guidance (resume writing, job description analysis, interviews, salary negotiation, career growth, and data roles)."
   - Zero tolerance for outside hallucination or unsupported claims.

2. Conversational Memory & Multi-Turn Flow:
   - Track prior context naturally across the conversation (understand pronouns like "can you give an example of that?", "what about the second tip?", etc.).
   - Do NOT re-introduce yourself or repeat welcome greetings during ongoing discussions. Speak as an active human mentor in an ongoing session.

3. Strict Language Consistency:
   - The user is speaking in English. You must respond 100% in natural, fluent English.
   - NEVER insert Arabic words or foreign phrases into an English conversation. Speak as a native English career coach.

4. Evidence & Citations:
   - When career references apply, cite the playbook name and page number naturally (e.g. [Salary Negotiation Playbook, Page 2]).`;
}

async function answerQuestion(question, history, env, wantsStream = false) {
  const cleanedQuestion = cleanQuery(question);
  const isAr = isArabic(cleanedQuestion);

  // Fast path 1: Topic Advice & Selection (which one to start with, which one do you recommend, where to begin)
  if (isTopicAdviceOrChoiceQuestion(cleanedQuestion)) {
    const resp = getTopicAdviceResponse(isAr);
    if (wantsStream) return { stream: createStaticStream(resp), sources: [] };
    return { answer: resp, sources: [] };
  }

  // Fast path 2: Identity & Capabilities (who are you, what can you do, topics overview, how to help)
  if (isIdentityOrCapabilityQuestion(cleanedQuestion)) {
    const resp = getCapabilityResponse(isAr);
    if (wantsStream) return { stream: createStaticStream(resp), sources: [] };
    return { answer: resp, sources: [] };
  }

  // Fast path 3: Greetings & Small Talk (hi, thanks, how are you, bye, هلا وغلا)
  if (isGreetingOrSmallTalk(cleanedQuestion)) {
    const greeting = getGreetingResponse(isAr);
    if (wantsStream) return { stream: createStaticStream(greeting), sources: [] };
    return { answer: greeting, sources: [] };
  }

  // 1. Resolve Search Query (taking history into account for follow-ups)
  const searchQuery = await resolveSearchQuery(cleanedQuestion, history, isAr, env);

  // 2. Vector Retrieval against English Playbooks
  let rankedChunks = [];
  try {
    const embedResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [searchQuery],
    });
    const questionVector = embedResult.data[0];

    const searchResult = await env.VECTOR_INDEX.query(questionVector, {
      topK: TOP_K_CANDIDATES,
      returnMetadata: "all",
    });

    const matches = searchResult.matches || [];
    if (matches.length > 0) {
      const ids = matches.map((m) => m.id);
      const placeholders = ids.map(() => "?").join(",");
      const query = `SELECT chunk_id, document, page, text FROM chunks WHERE chunk_id IN (${placeholders})`;
      const { results } = await env.DB.prepare(query).bind(...ids).all();

      const rowsById = new Map(results.map((row) => [row.chunk_id, row]));
      const candidates = ids.map((id) => rowsById.get(id)).filter(Boolean);

      if (candidates.length > 0) {
        const rerankResult = await env.AI.run("@cf/baai/bge-reranker-base", {
          query: searchQuery,
          contexts: candidates.map((c) => ({ text: c.text })),
          top_k: Math.min(TOP_N_AFTER_RERANK, candidates.length),
        });

        rankedChunks = (rerankResult.response || [])
          .filter((r) => typeof r.score === "number" && r.score >= RELEVANCE_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .slice(0, TOP_N_AFTER_RERANK)
          .map((r) => ({ ...candidates[r.id], score: r.score }));
      }
    }
  } catch (err) {
    console.warn("RAG retrieval step encountered non-fatal error:", err);
  }

  // Guardrail 1: Strictly handle empty/irrelevant retrieval
  if (rankedChunks.length === 0) {
    if (isTopicAdviceOrChoiceQuestion(cleanedQuestion)) {
      const resp = getTopicAdviceResponse(isAr);
      if (wantsStream) return { stream: createStaticStream(resp), sources: [] };
      return { answer: resp, sources: [] };
    }

    if (isIdentityOrCapabilityQuestion(cleanedQuestion)) {
      const resp = getCapabilityResponse(isAr);
      if (wantsStream) return { stream: createStaticStream(resp), sources: [] };
      return { answer: resp, sources: [] };
    }

    if (isGreetingOrSmallTalk(cleanedQuestion)) {
      const greeting = getGreetingResponse(isAr);
      if (wantsStream) {
        return { stream: createStaticStream(greeting), sources: [] };
      }
      return { answer: greeting, sources: [] };
    }

    // STRICT GROUNDING REFUSAL:
    // Out-of-domain question (e.g., social studies, general trivia, unrelated inquiry)
    const refusal = getOutOfDomainResponse(isAr);
    if (wantsStream) {
      return { stream: createStaticStream(refusal), sources: [] };
    }
    return { answer: refusal, sources: [] };
  }

  // 3. Build Grounded Context Block
  const contextBlock =
    "Career Playbook Reference Material:\n\n" +
    rankedChunks
      .map(
        (c, i) =>
          `[Source ${i + 1}: ${formatDocName(c.document)}, Page ${c.page}]\n${c.text}`
      )
      .join("\n\n---\n\n") +
    "\n\n";

  const systemPrompt = buildMasterSystemPrompt(isAr);
  const currentTurnContent = `${contextBlock}User Question: ${cleanedQuestion}`;

  // 4. Construct Multi-Turn Messages Array for LLM
  const messages = [{ role: "system", content: systemPrompt }];

  // Append validated recent history
  if (Array.isArray(history) && history.length > 0) {
    history.forEach((msg) => {
      if (msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string") {
        messages.push({
          role: msg.role,
          content: msg.content.trim(),
        });
      }
    });
  }

  // Append current turn
  messages.push({
    role: "user",
    content: currentTurnContent,
  });

  const sources = rankedChunks.map((c) => ({
    document: formatDocName(c.document),
    raw_document: c.document,
    page: c.page,
    chunk_id: c.chunk_id,
    relevance: Math.round((c.score || 0.8) * 1000) / 1000,
  }));

  // 5. Generate Answer via Resilient LLM Fallback Chain
  if (wantsStream) {
    const { stream } = await callLLMStreamWithFallback(env, {
      messages: messages,
      max_tokens: 850,
    });
    return { stream, sources };
  }

  const llmResult = await callLLMWithFallback(env, {
    messages: messages,
    max_tokens: 850,
  });

  const answer = (llmResult && llmResult.response) || (isAr ? "أهلاً بك! كيف يمكنني مساعدتك؟" : "Hello! How can I help you today?");

  return { answer, sources };
}

function formatDocName(raw) {
  if (!raw) return "Career Guide";
  return raw
    .replace(/^\d+[\s_-]*/, "")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ");
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
