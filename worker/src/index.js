/**
 * Masar AI (مسار) — Precision Career & Interview Mentor.
 * Cloudflare Worker Backend.
 *
 * Core Capabilities:
 * - Multi-turn conversational memory (contextual follow-up understanding).
 * - Strict factual grounding (NO outside hallucination / guessing; strictly based on the 7 playbooks).
 * - Contextual standalone query reformulation for accurate follow-up retrieval.
 * - Language matching (pure English on English prompts, pure Arabic on Arabic prompts).
 * - High-availability multi-model LLM fallback chain.
 */

const TOP_K_CANDIDATES = 20;
const TOP_N_AFTER_RERANK = 4;
const RELEVANCE_THRESHOLD = 0.03;
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
 * Enforces strict grounding, no outside hallucination, language consistency, and proportional dialogue.
 */
function buildMasterSystemPrompt(isAr) {
  if (isAr) {
    return `أنت "مَسار" (Masar AI) — مرشد مهني ومستشار مقابلات وظيفية ذكي، إيجابي، وموثوق.

قواعد الإرشاد والالتزام المعرفي الصارم:
1. الالتزام الصارم بالحقائق والورق المعتمد (Strict Grounding — ممنوع الفتي تماماً):
   - إجاباتك المهنية يجب أن تنبع حصراً من واقع الأدلة السبعة المعتمدة المرفقة (Career Playbooks).
   - ممنوع اختلاق معلومات خارج الأدلة أو التخمين أو التأليف. قدم دائماً كلاماً واقعياً، منطقياً، ومفهوماً يعكس ما جاء في الأدلة المعتمدة.
   - إذا سأل المستخدم عن جزئية غير موجودة في الأدلة المعتمدة، وضّح له بصراحة وبأسلوب احترافي أن هذه الجزئية غير مغطاة في أدلة التحضير الحالية، ولا تخترع شيئاً من عندك.

2. استمرارية المحادثة والذاكرة التفاعلية (Conversational Memory):
   - تابع سياق الحوار السابق مع المستخدم بسلاسة؛ افهم الضمائر والإشارات (مثل "عايز مثال على ده"، "اشرحلي أكتر"، "طب إزاي أطبق النقطة التانية عملياً؟").
   - وسّع الشرح وبسّط المفاهيم اعتماداً على ما تم مناقشته وسياق الأدلة دون أن تجبر المستخدم على إعادة كتابة الكلمات المفتاحية.
   - لا تكرر نفسك ولا تعد تعريف نفسك في كل رسالة؛ تحدث معه كجلسة إرشاد مستمرة بين إنسان ومستشاره.

3. فهم القصد والتناسب (Proportionality):
   - إذا سلّم عليك أو سأل عن حالك: رد بلطف وإيجاز شديد في جملة أو جملتين فقط دون أي سرد تسويقي أو قوائم طويلة غير مطلوبة.
   - إذا سأل سؤالاً مهنياً أو طلب توضيحاً: قدم إجابة منظمة، عملية، ومدعومة بالمصدر ورقم الصفحة.

4. اتساق اللغة:
   - تحدّث بلغة عربية فصحى طبيعية وسلسة دون أي تكلف.`;
  }

  return `You are Masar AI — an experienced, empathetic, and sharp Career & Interview Mentor.

CORE CONVERSATIONAL & GROUNDING PRINCIPLES:
1. Strict Grounding — Zero Hallucination:
   - Ground all professional advice strictly in the verified Career Playbook Reference Materials provided below.
   - Do NOT invent outside company policies, fake statistics, or unverified claims.
   - If the user asks about something not covered in the playbooks, be honest and transparent: explain what the playbooks do say, and candidly state that this specific detail is not covered rather than guessing or fabricating.

2. Conversational Memory & Multi-Turn Flow:
   - Track prior context naturally across the conversation (understand pronouns like "can you give an example of that?", "what about the second tip?", etc.).
   - Do NOT re-introduce yourself or repeat welcome greetings during ongoing discussions. Speak as an active human mentor in an ongoing session.

3. Intent & Proportionality:
   - If the user makes small talk or greets you: Respond warmly and CONCISELY in 1-2 friendly sentences. Never dump a massive unsolicited bulleted list.
   - If the user asks a career question or follow-up: Provide a structured, actionable, and clear answer.

4. Strict Language Consistency:
   - The user is speaking in English. You must respond 100% in natural, fluent English.
   - NEVER insert Arabic words, Arabic transliterations (like "As-salamu alaykum" or "(مسار)"), or foreign phrases into an English conversation. Speak as a native English career coach.

5. Evidence & Citations:
   - When career references apply, cite the playbook name and page number naturally (e.g. [Salary Negotiation Playbook, p. 2]).`;
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

  // 3. Build Grounded Context Block
  let contextBlock = "";
  if (rankedChunks.length > 0) {
    contextBlock =
      "Career Playbook Reference Material:\n\n" +
      rankedChunks
        .map(
          (c, i) =>
            `[Source ${i + 1}: ${formatDocName(c.document)}, Page ${c.page}]\n${c.text}`
        )
        .join("\n\n---\n\n") +
      "\n\n";
  }

  const systemPrompt = buildMasterSystemPrompt(isAr);
  const currentTurnContent = contextBlock
    ? `${contextBlock}User Question: ${cleanedQuestion}`
    : cleanedQuestion;

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
