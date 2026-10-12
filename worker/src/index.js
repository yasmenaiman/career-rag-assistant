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

function isGreetingOrSmallTalk(text) {
  const t = text.trim().toLowerCase();

  const arGreetings = [
    /^(أهلا|اهلا|مرحبا|مرحباً|سلام|السلام عليكم|سلام عليكم|صباح الخير|مساء الخير|هاي|ازيك|إزيك|عامل ايه|كيف حالك|كيفك|شخبارك)/,
    /^(شكرا|شكراً|تسلم|تسلمي|جزاك الله خيرا|يعطيك العافية|تمام|ماشي|أوك|اوك|ok|bye|مع السلامة|باي)$/,
    /^(مين انت|من أنت|عرف نفسك|بتعمل ايه|إيه وظيفتك|وظيفتك ايه|عرفني بيك|انت مين)/
  ];

  const enGreetings = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|sup|greetings)\b/,
    /^(how are you|how are you doing|who are you|what can you do|what is your name)\b/,
    /^(thanks|thank you|thx|cool|awesome|great|ok|okay|bye|goodbye|see you)\b/
  ];

  return arGreetings.some((r) => r.test(t)) || enGreetings.some((r) => r.test(t));
}

function getGreetingResponse(isAr) {
  if (isAr) {
    return "أهلاً بك! أنا «مسار» (Masar AI)، مرشدك المهني الذكي. أنا هنا لمساعدتك في كل ما يخص مستقبلك المهني والتحضير للوظائف استناداً إلى أدلتنا السبعة المعتمدة (صياغة السيرة الذاتية وفق معايير ATS، التحضير للمقابلات السلوكية والتقنية بمنهجية STAR، التفاوض على العروض الوظيفية، ومسارات وظائف البيانات). كيف يمكنني مساعدتك اليوم؟";
  }
  return "Hello! I am Masar AI, your precision career and interview mentor. I am here to help you navigate your professional journey grounded in our 7 verified playbooks—covering ATS resume optimization, behavioral & technical interviews, salary negotiation, and data career roadmaps. How can I assist you today?";
}

function getOutOfDomainResponse(isAr) {
  if (isAr) {
    return "عذراً، هذا الموضوع غير موجود في الأدلة المهنية المعتمدة المتاحة لدي. أنا مرشد مهني مخصص فقط لمساعدتك في موضوعات التطوير المهني والوظائف المذكورة في أدلتنا السبعة (كتابة السيرة الذاتية، تحليل الوظائف، المقابلات الشخصية، التفاوض على الرواتب، ومسارات تكنولوجيا البيانات). هل ترغب في سؤالي عن أي من هذه المجالات المهنية؟";
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
