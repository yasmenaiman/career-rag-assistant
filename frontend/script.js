/**
 * MASAR AI — Application Logic & Bilingual Controller
 * Reference Style: Precision Tech Platform (OpenAI / Linear / Anthropic aesthetic)
 */

const WORKER_URL = "https://rag-pdf-worker.career-rag.workers.dev/chat";

// Bilingual Dictionary
const DICTIONARY = {
  en: {
    lang_btn: "العربية",
    nav_pillars: "Our Pillars",
    nav_stats: "7 Playbooks",
    nav_coach: "AI Mentor",
    nav_cta: "Explore roles",
    nav_cta_text: "Explore roles",
    hero_pretag: "CAREERS & INTERVIEWS AT MASAR AI",
    hero_head_1: "Intelligence",
    hero_head_2: "starts with",
    hero_head_accent: "people.",
    hero_sub: "Bring your curiosity. Challenge what's possible. Grounded in 7 verified tech career playbooks: Master ATS resume crafting, ace technical & behavioral interviews, and negotiate top-of-market compensation.",
    btn_primary: "Find your next chapter",
    btn_secondary: "Meet MASAR",
    hero_footnote: "FOR THE CURIOUS. THE BUILDERS. THE WHAT-IF THINKERS.",
    emblem_tag: "CAREER & INTERVIEW INTELLIGENCE",
    ticker_title: "HUMAN AMBITION. SHARED DIRECTION.",
    ticker_1: "Think deeply",
    ticker_2: "Build thoughtfully",
    ticker_3: "Move forward together",
    m1_val: "7 PLAYBOOKS",
    m1_desc: "Comprehensive Verified Career Guides",
    m2_val: "ATS COMPLIANT",
    m2_desc: "Keyword Matching & Standard Formats",
    m3_val: "STAR METHOD",
    m3_desc: "Structured Behavioral Interview Mastery",
    m4_val: "100% GROUNDED",
    m4_desc: "Zero Hallucination • Strictly Verified",
    role_bar_title: "Select your career focus:",
    btn_explore: "Explore Playbook",
    pillars_pretag: "VERIFIED KNOWLEDGE BASE",
    pillars_heading: "Six Core Pillars of Career Preparation",
    pillars_sub: "Click any pillar to consult Masar AI directly on verified insights from our 7 playbooks:",
    p_consult: "Consult Masar",
    p1_h: "ATS Resume Best Practices",
    p1_p: "Quantified impact formulas, clean hierarchy, avoiding formatting traps, and passing recruiter screening scans.",
    p2_h: "Behavioral & STAR Method",
    p2_p: "Master Situation, Task, Action, and Result framing to deliver structured, compelling stories to interviewers.",
    p3_h: "Technical & System Design",
    p3_p: "Problem solving strategies, communication during code reviews, and distributed architecture basics.",
    p4_h: "Salary Negotiation Playbook",
    p4_p: "Benchmarking market value, avoiding early disclosure, evaluating total comp, and framing confident counter-offers.",
    p5_h: "Data & Tech Roles Roadmaps",
    p5_p: "Detailed skill matrices, tool stacks, and career progression paths across modern data and analytics disciplines.",
    p6_h: "Job Description Breakdown",
    p6_p: "Deconstruct requirements, separate must-haves from nice-to-haves, and align proof points directly to interviewer criteria.",
    status_online: "ACTIVE",
    clear_btn: "Reset Session",
    brand_sub: "Career Intelligence Mentor",
    tag_grounded: "100% STRICT GROUNDING",
    welcome_prompt_main: "Where should we elevate your career today?",
    welcome_sub_main: "Select a playbook domain below or type your question:",
    card_cv_title: "ATS Resume Optimization",
    card_cv_desc: "Quantified impact formulas & keyword matching",
    card_star_title: "STAR Behavioral Interviews",
    card_star_desc: "Frameworks, storytelling & situational drills",
    card_salary_title: "Salary Negotiation Playbook",
    card_salary_desc: "Market benchmarking & counter-offer scripts",
    card_data_title: "Data Career Roadmaps",
    card_data_desc: "Analyst vs. Engineer vs. Scientist progression",
    persona_label: "Avatar:",
    persona_female: "Female",
    persona_male: "Male",
    sidebar_badge: "7 VERIFIED PLAYBOOKS",
    sidebar_title: "Career Intelligence Suite",
    sidebar_sub: "Strictly grounded in tech career playbooks",
    sb_cv: "ATS Resume Writing",
    sb_cv_sub: "Quantified impact & keywords",
    sb_star: "STAR Behavioral Method",
    sb_star_sub: "Situation, Task, Action, Result",
    sb_tech: "System Design & Tech",
    sb_tech_sub: "Architecture & problem-solving",
    sb_salary: "Salary Negotiation",
    sb_salary_sub: "Counter-offers & benchmarking",
    sb_data: "Data Career Roadmaps",
    sb_data_sub: "Analyst vs Engineer vs Scientist",
    sb_jd: "JD Keyword Analysis",
    sb_jd_sub: "Targeted skill alignment",
    sb_tip: "Click any playbook above to explore immediately.",
    welcome_heading: "I am Masar AI — Your Career & Interview Coach.",

    welcome_body: "I am here to guide you across ATS resume preparation, structured behavioral interviews (STAR framework), technical interview principles, salary negotiation playbooks, and modern data roadmaps.",
    welcome_prompt: "Select a quick prompt below or type your question:",
    chips_label: "PROMPTS:",
    placeholder_input: "Ask Masar about resume optimization, STAR interview answers, salary negotiation, or data roadmaps...",
    footer_tag: "Intelligence starts with people.",
    footer_copy: "© 2026 Masar AI. All rights reserved.",
  },
  ar: {
    lang_btn: "English",
    nav_pillars: "الركائز المهنية",
    nav_stats: "أدلة التحضير",
    nav_coach: "المرشد الذكي",
    nav_cta: "استكشف الفرص",
    nav_cta_text: "استكشف الفرص",
    hero_pretag: "المسار المهني والمقابلات في MASAR AI",
    hero_head_1: "مسارك المهني",
    hero_head_2: "يبدأ برؤية",
    hero_head_accent: "واضحة.",
    hero_sub: "دليلك المعتمد المستند إلى 7 أدلة مهنية تخصصية: لصياغة السيرة الذاتية واجتياز أنظمة الـ ATS، المقابلات السلوكية والتقنية، والتفاوض على أعلى عرض عمل.",
    btn_primary: "ابدأ استشارتك مع مسار",
    btn_secondary: "تعرف على مسار",
    hero_footnote: "للطامحين. للبُناة. لصنّاع المستقبل.",
    emblem_tag: "المرشد الذكي للتحضير المهني والمقابلات",
    ticker_title: "طموح حقيقي. مسار مشترك.",
    ticker_1: "فكّر بعمق",
    ticker_2: "ابنِ بوعي",
    ticker_3: "انطلق بثقة",
    m1_val: "7 أدلة معتمدة",
    m1_desc: "أدلة تحضير مهنية موثوقة وشاملة",
    m2_val: "معايير ATS القياسية",
    m2_desc: "مطابقة الكلمات وتنسيق معتمد",
    m3_val: "نموذج STAR العالمي",
    m3_desc: "إتقان المقابلات السلوكية والشخصية",
    m4_val: "100% موثقة بالورق",
    m4_desc: "خالية تماماً من الفتي أو التخمين",
    role_bar_title: "اختر مجالك وتحديك المهني:",
    btn_explore: "استكشف الدليل",
    pillars_pretag: "قاعدة المعرفة المعتمدة",
    pillars_heading: "ركائز النجاح الست في رحلتك الوظيفية",
    pillars_sub: "اضغط على أي ركيزة للبدء الفوري في محادثة استشارية متخصصة ومستندة للأدلة السبعة المعتمدة:",
    p_consult: "استشر مسار",
    p1_h: "السيرة الذاتية ومعايير الـ ATS",
    p1_p: "صياغة الإنجازات بلغة الأرقام، وتخطي خوارزميات الفرز الآلي بنجاح.",
    p2_h: "المقابلات السلوكية ونموذج STAR",
    p2_p: "إتقان هيكل (الموقف، المهمة، الإجراء، النتيجة) للإجابة بثقة في المقابلات الشخصية.",
    p3_h: "المقابلات التقنية وSystem Design",
    p3_p: "استراتيجيات حل المشكلات البرمجية، التفكير المنطقي، وتصميم الأنظمة الموزعة.",
    p4_h: "دليل التفاوض على الراتب",
    p4_p: "تقييم العرض الشامل، صياغة عروض الرد المضادة، وتحصيل قيمتك السوقية الحقيقية.",
    p5_h: "مسارات وظائف البيانات (Data Roles)",
    p5_p: "مقارنة المهارات والأدوات بين Data Analyst و Data Engineer و Data Scientist.",
    p6_h: "تحليل متطلبات الوظائف (JD Analysis)",
    p6_p: "استخراج الكلمات المفتاحية الأساسية وربطها بنقاط قوتك في الـ CV والإنترفيو.",
    status_online: "نشط",
    clear_btn: "بدء جلسة جديدة",
    brand_sub: "المرشد المهني والوظيفي الذكي",
    tag_grounded: "100% موثق بالأدلة المعتمدة",
    welcome_prompt_main: "كيف نبدأ بتطوير مسارك المهني اليوم؟",
    welcome_sub_main: "اختر أحد مجالات التحضير المعتمدة أدناه أو اكتب سؤالك مباشرة:",
    card_cv_title: "صياغة السيرة الذاتية (ATS)",
    card_cv_desc: "صياغة الإنجازات بلغة الأرقام وتخطي الفرز الآلي",
    card_star_title: "المقابلات السلوكية (STAR)",
    card_star_desc: "إتقان هيكل STAR والإجابة بثقة على المواقف",
    card_salary_title: "دليل التفاوض على الراتب",
    card_salary_desc: "تقييم العرض الوظيفي وصياغة عروض الرد المضادة",
    card_data_title: "مسارات وظائف البيانات",
    card_data_desc: "مقارنة المهارات بين Analyst و Engineer و Scientist",
    persona_label: "الأفاتار:",
    persona_female: "أنثى",
    persona_male: "ذكر",
    sidebar_badge: "7 أدلة مهنية معتمدة",
    sidebar_title: "منظومة مسار الاستشارية",
    sidebar_sub: "موثقة بالكامل بدون تخمين أو خروج عن النص",
    sb_cv: "السيرة الذاتية (معايير ATS)",
    sb_cv_sub: "صياغة بالأرقام وتخطي الفرز الآلي",
    sb_star: "المقابلات السلوكية (STAR)",
    sb_star_sub: "الموقف والمهمة والإجراء والنتيجة",
    sb_tech: "المقابلات التقنية والأنظمة",
    sb_tech_sub: "هندسة الأنظمة وحل المشكلات",
    sb_salary: "دليل التفاوض على الراتب",
    sb_salary_sub: "العروض المضادة وتحصيل القيمة",
    sb_data: "مسارات وظائف البيانات",
    sb_data_sub: "مقارنة Analyst و Engineer و Scientist",
    sb_jd: "تحليل بطاقة الوظيفة (JD)",
    sb_jd_sub: "استخراج الكلمات وتطابق المهارات",
    sb_tip: "اضغط على أي مسار لبدء الاستشارة فوراً.",
    welcome_heading: "أنا مسار (Masar AI) 🧭 — مرشدك المهني الذكي.",

    welcome_body: "أنا هنا لمساعدتك في صياغة سيرتك الذاتية لاجتياز أنظمة الـ ATS، التدريب على أسئلة المقابلات السلوكية والتقنية، التفاوض على الراتب، واختيار مسارك في مجالات البيانات.",
    welcome_prompt: "اختر أحد الأسئلة السريعة بالأسفل أو اكتب سؤالك مباشرة:",
    chips_label: "أسئلة مقترحة:",
    placeholder_input: "اسأل مسار عن السيرة الذاتية، المقابلات، التفاوض على الراتب، أو مسارات الداتا...",
    footer_tag: "مسارك المهني يبدأ برؤية واضحة.",
    footer_copy: "© 2026 مسار AI. جميع الحقوق محفوظة.",
  },
};

const SUGGESTED_CHIPS = {
  en: [
    { label: "Salary Negotiation", query: "What are the most effective strategies and steps to negotiate a salary offer?" },
    { label: "ATS Resume Writing", query: "How can I format and write high-impact resume bullet points that pass ATS filters?" },
    { label: "STAR Interview Method", query: "Explain the STAR method for behavioral interviews with a strong real-world example." },
    { label: "Data Analyst vs Engineer", query: "What is the key difference between a Data Analyst and Data Engineer roadmap and tools?" },
    { label: "JD Keyword Analysis", query: "How do I break down a job description to extract keywords and align my experience?" },
  ],
  ar: [
    { label: "التفاوض على الراتب", query: "ما هي خطوات واستراتيجيات التفاوض على الراتب عند تلقي عرض وظيفي؟" },
    { label: "صياغة الـ CV للـ ATS", query: "إزاي أصيغ إنجازاتي في السيرة الذاتية بطريقة احترافية تجتاز فحص أنظمة الـ ATS؟" },
    { label: "طريقة STAR للمقابلات", query: "اشرحلي طريقة STAR للإجابة على الأسئلة السلوكية في المقابلة مع مثال عملي." },
    { label: "Data Analyst vs Engineer", query: "ما الفرق بين مسار Data Analyst ومسار Data Engineer وما هي المهارات المطلوبة؟" },
    { label: "تحليل الـ Job Description", query: "كيف أحلل الـ Job Description وأستخرج الكلمات المفتاحية لربطها بمهاراتي؟" },
  ],
};

let currentLang = localStorage.getItem("masar-lang") || "en";
let isWaitingForResponse = false;
let initialWelcomeHTML = "";
let conversationHistory = [];

let currentGender = localStorage.getItem("masar_user_gender") || "female";

// DOM Elements
const langToggleBtn = document.getElementById("lang-toggle-btn");
const langLabel = document.getElementById("lang-label");
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const questionInput = document.getElementById("question-input");
const sendButton = document.getElementById("send-button");
const errorBanner = document.getElementById("error-banner");
const suggestedContainer = document.getElementById("suggested-questions");
const clearChatBtn = document.getElementById("clear-chat-btn");
const explorerSubmitBtn = document.getElementById("explorer-submit-btn");
const roleSelect = document.getElementById("role-select");
const focusSelect = document.getElementById("focus-select");
const personaFemaleBtn = document.getElementById("persona-female-btn");
const personaMaleBtn = document.getElementById("persona-male-btn");

function getUserAvatarSrc() {
  return currentGender === "male"
    ? "assets/user_avatar_male.png"
    : "assets/user_avatar_female.png";
}

function updatePersonaUi(gender) {
  currentGender = gender;
  localStorage.setItem("masar_user_gender", gender);
  if (gender === "female") {
    personaFemaleBtn?.classList.add("active");
    personaMaleBtn?.classList.remove("active");
  } else {
    personaMaleBtn?.classList.add("active");
    personaFemaleBtn?.classList.remove("active");
  }

  // Update existing user avatars in the chat log live
  const userImgs = document.querySelectorAll(".message.user .user-avatar-img");
  userImgs.forEach((img) => {
    img.src = getUserAvatarSrc();
    img.alt = gender === "male" ? "Male User" : "Female User";
  });
}

function init() {
  if (chatLog) initialWelcomeHTML = chatLog.innerHTML;

  applyLanguage(currentLang);
  updatePersonaUi(currentGender);
  setupEventListeners();
}

function setupEventListeners() {
  // Persona Profile Switcher
  personaFemaleBtn?.addEventListener("click", () => updatePersonaUi("female"));
  personaMaleBtn?.addEventListener("click", () => updatePersonaUi("male"));

  // Language Switch
  langToggleBtn.addEventListener("click", () => {
    currentLang = currentLang === "en" ? "ar" : "en";
    localStorage.setItem("masar-lang", currentLang);
    applyLanguage(currentLang);
  });


  // Clickable 2x2 Hero Action Cards
  chatLog?.addEventListener("click", (e) => {
    const card = e.target.closest(".hero-action-card");
    if (card) {
      const queryAttr = currentLang === "ar" ? "data-query-ar" : "data-query-en";
      const query = card.getAttribute(queryAttr) || card.getAttribute("data-query-en");
      if (query) {
        questionInput.value = query;
        handleSend();
      }
    }
  });

  // Desktop Sidebar Playbook Items
  document.querySelectorAll(".sidebar-playbook-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sidebar-playbook-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const queryAttr = currentLang === "ar" ? "data-query-ar" : "data-query-en";
      const query = btn.getAttribute(queryAttr) || btn.getAttribute("data-query-en");
      if (query) {
        questionInput.value = query;
        handleSend();
      }
    });
  });

  // Role Explorer Action Button (if present)
  explorerSubmitBtn?.addEventListener("click", () => {
    if (!roleSelect || !focusSelect) return;
    const role = roleSelect.value;
    const focusText = focusSelect.options[focusSelect.selectedIndex].text;

    let query = "";
    if (currentLang === "ar") {
      query = `أنا استهدف وظيفة (${role}) وأريد استراتيجيات وخطة عمل واضحة بخصوص (${focusText}) مستندة للأدلة المرجعية.`;
    } else {
      query = `I am targeting a ${role} role and I need a clear strategy regarding ${focusText} based on our career playbooks.`;
    }

    questionInput.value = query;
    scrollToCoach();
    handleSend();
  });

  // Submit Question
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSend();
  });

  questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  questionInput.addEventListener("input", () => {
    questionInput.style.height = "auto";
    questionInput.style.height = Math.min(questionInput.scrollHeight, 120) + "px";
  });

  // Reset Session
  clearChatBtn.addEventListener("click", () => {
    const msg = currentLang === "ar" ? "هل ترغب في إعادة ضبط الجلسة؟" : "Do you want to reset this coaching session?";
    if (confirm(msg)) {
      chatLog.innerHTML = initialWelcomeHTML;
      conversationHistory = [];
      applyLanguage(currentLang);
      hideError();
    }
  });
}

function applyLanguage(lang) {
  const isAr = lang === "ar";
  document.documentElement.lang = lang;
  document.documentElement.dir = isAr ? "rtl" : "ltr";

  const dict = DICTIONARY[lang] || DICTIONARY.en;

  if (langLabel) {
    langLabel.textContent = dict.lang_btn;
  }

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });

  if (questionInput) {
    questionInput.placeholder = dict.placeholder_input;
  }

  renderChips(lang);
}

function renderChips(lang) {
  if (!suggestedContainer) return;
  suggestedContainer.innerHTML = "";

  const chips = SUGGESTED_CHIPS[lang] || SUGGESTED_CHIPS.en;
  chips.forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = item.label;
    chip.title = item.query;
    chip.addEventListener("click", () => {
      questionInput.value = item.query;
      scrollToCoach();
      handleSend();
    });
    suggestedContainer.appendChild(chip);
  });
}

function scrollToCoach() {
  const coachEl = document.getElementById("coach-section");
  if (coachEl) {
    coachEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function handleSend() {
  if (isWaitingForResponse) return;
  const text = questionInput.value.trim();
  if (!text) return;

  hideError();
  const welcomeHero = document.getElementById("welcome-hero");
  if (welcomeHero) {
    welcomeHero.style.display = "none";
  }
  appendUserMessage(text);
  questionInput.value = "";
  questionInput.style.height = "auto";

  // Snapshot recent history before adding the new user message
  const recentHistory = conversationHistory.slice(-6);
  conversationHistory.push({ role: "user", content: text });

  setWaitingState(true);

  // Create streaming assistant message immediately with thinking pulse
  const streamUi = createStreamingAssistantMessage();

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, history: recentHistory, stream: true }),
    });

    if (!response.ok) {
      let msg = currentLang === "ar"
        ? `خطأ في الاتصال بالمرشد (${response.status})`
        : `Connection error (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) msg = errJson.error;
      } catch (_) {}
      throw new Error(msg);
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream") && response.body) {
      // True SSE Stream from Cloudflare Workers AI
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let accumulatedText = "";
      let retrievedSources = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep last incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            break;
          }

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === "sources" && Array.isArray(parsed.sources)) {
              retrievedSources = parsed.sources;
            } else if (parsed.sources && Array.isArray(parsed.sources)) {
              retrievedSources = parsed.sources;
            }

            if (typeof parsed.response === "string") {
              accumulatedText += parsed.response;
              streamUi.updateContent(accumulatedText);
            }
          } catch (_) {
            // Unparsed chunk
          }
        }
      }

      // Check remainder of buffer
      if (buffer.trim().startsWith("data:")) {
        const dataStr = buffer.trim().slice(5).trim();
        if (dataStr !== "[DONE]") {
          try {
            const parsed = JSON.parse(dataStr);
            if (typeof parsed.response === "string") {
              accumulatedText += parsed.response;
              streamUi.updateContent(accumulatedText);
            }
          } catch (_) {}
        }
      }

      if (!accumulatedText.trim()) {
        accumulatedText = currentLang === "ar"
          ? "أهلاً بك! كيف يمكنني مساعدتك؟"
          : "Hello! How can I help you today?";
      }

      conversationHistory.push({ role: "assistant", content: accumulatedText });
      streamUi.finalize(accumulatedText, retrievedSources);

    } else {
      // Standard JSON fallback -> Typewriter token by token
      const data = await response.json();
      const fullAnswer = data.answer || "";
      const sources = data.sources || [];

      await runTypewriterEffect(fullAnswer, streamUi.updateContent);
      conversationHistory.push({ role: "assistant", content: fullAnswer });
      streamUi.finalize(fullAnswer, sources);
    }

  } catch (err) {
    console.error("Masar AI Request Error:", err);
    showError(err.message || (currentLang === "ar" ? "تعذر الاتصال بالمرشد حالياً." : "Failed to connect to Masar AI."));
    const errorMsg = currentLang === "ar"
      ? "عذراً، حدث خطأ مؤقت في الاتصال. يمكنك المحاولة مرة أخرى."
      : "Sorry, a temporary connection error occurred. Please try again.";
    streamUi.finalize(errorMsg, []);
  } finally {
    setWaitingState(false);
  }
}

function appendUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message user";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar user-avatar";
  const avatarImg = document.createElement("img");
  avatarImg.src = getUserAvatarSrc();
  avatarImg.alt = currentGender === "male" ? "Male User" : "Female User";
  avatarImg.className = "avatar-img user-avatar-img";
  avatar.appendChild(avatarImg);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.setAttribute("dir", "auto");
  bubble.textContent = text;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatLog.appendChild(row);
  scrollChatToBottom();
}

function createStreamingAssistantMessage() {
  const row = document.createElement("div");
  row.className = "message assistant streaming-active";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar assistant-avatar";
  const avatarImg = document.createElement("img");
  avatarImg.src = "assets/masar_3d_emblem.png";
  avatarImg.alt = "M";
  avatarImg.className = "avatar-img assistant-avatar-img";
  avatar.appendChild(avatarImg);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.setAttribute("dir", "auto");

  const bubbleContent = document.createElement("div");
  bubbleContent.className = "bubble-content";
  bubbleContent.setAttribute("dir", "auto");
  bubbleContent.innerHTML = `<span class="thinking-pulse"><span></span><span></span><span></span></span>`;

  bubble.appendChild(bubbleContent);
  row.appendChild(avatar);
  row.appendChild(bubble);
  chatLog.appendChild(row);
  scrollChatToBottom();

  let hasStartedWriting = false;

  function updateContent(markdownText) {
    if (!hasStartedWriting) {
      hasStartedWriting = true;
    }
    const rawHtml = marked.parse(markdownText || "");
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    bubbleContent.innerHTML = cleanHtml + `<span class="streaming-cursor">▌</span>`;
    bubbleContent.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, ul, ol").forEach((el) => {
      el.setAttribute("dir", "auto");
    });
    scrollChatToBottom();
  }

  function finalize(finalMarkdownText, sources) {
    row.classList.remove("streaming-active");
    const rawHtml = marked.parse(finalMarkdownText || "");
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    bubbleContent.innerHTML = cleanHtml;
    bubbleContent.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, ul, ol").forEach((el) => {
      el.setAttribute("dir", "auto");
    });

    const footer = document.createElement("div");
    footer.className = "bubble-footer";

    const sourcesDiv = document.createElement("div");
    sourcesDiv.className = "sources-container";

    if (sources && sources.length > 0) {
      const label = document.createElement("span");
      label.className = "sources-label";
      label.textContent = currentLang === "ar" ? "المراجع:" : "SOURCES:";
      sourcesDiv.appendChild(label);

      const seen = new Set();
      sources.forEach((s) => {
        const key = `${s.document}_${s.page}`;
        if (seen.has(key)) return;
        seen.add(key);

        const badge = document.createElement("span");
        badge.className = "source-badge";
        const docName = s.document || "Career Guide";
        const pageInfo = s.page ? (currentLang === "ar" ? `ص ${s.page}` : `p. ${s.page}`) : "";
        badge.textContent = `${docName} ${pageInfo ? `(${pageInfo})` : ""}`;
        sourcesDiv.appendChild(badge);
      });
    }

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = currentLang === "ar" ? "نسخ" : "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(finalMarkdownText).then(() => {
        copyBtn.textContent = currentLang === "ar" ? "تم النسخ!" : "Copied!";
        setTimeout(() => {
          copyBtn.textContent = currentLang === "ar" ? "نسخ" : "Copy";
        }, 2000);
      });
    });

    footer.appendChild(sourcesDiv);
    footer.appendChild(copyBtn);
    bubble.appendChild(footer);
    scrollChatToBottom();
  }

  return { row, updateContent, finalize };
}

async function runTypewriterEffect(fullText, updateFn) {
  if (!fullText) return;
  const words = fullText.match(/\S+|\s+/g) || [fullText];
  let current = "";
  const step = words.length > 100 ? 2 : 1;
  for (let i = 0; i < words.length; i += step) {
    current += words.slice(i, i + step).join("");
    updateFn(current);
    await new Promise((r) => setTimeout(r, 20));
  }
  updateFn(fullText);
}

function setWaitingState(waiting) {
  isWaitingForResponse = waiting;
  sendButton.disabled = waiting;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove("hidden");
  scrollChatToBottom();
}

function hideError() {
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

function scrollChatToBottom() {
  setTimeout(() => {
    chatLog.scrollTop = chatLog.scrollHeight;
  }, 50);
}

document.addEventListener("DOMContentLoaded", init);
