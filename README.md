# Masar AI — Precision Serverless RAG Assistant

<p align="center">
  <img src="frontend/assets/masar_3d_emblem.png" alt="Masar AI Emblem" width="120" style="border-radius: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.25);" />
</p>

<p align="center">
  <strong>Production-Grade, Zero-Cold-Start Retrieval-Augmented Generation (RAG) Architecture built 100% on Cloudflare Serverless Edge Infrastructure.</strong>
</p>

<p align="center">
  <a href="https://masar-ai-app.pages.dev"><img src="https://img.shields.io/badge/Live%20Demo-masar--ai--app.pages.dev-6366f1?style=for-the-badge&logo=cloudflarepages&logoColor=white" alt="Live Demo" /></a>
  <a href="https://github.com/yasmenaiman/career-rag-assistant/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge" alt="License" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Edge%20Runtime-Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Vector%20DB-Cloudflare%20Vectorize-orange?style=flat-square&logo=cloudflare" alt="Vectorize" />
  <img src="https://img.shields.io/badge/Relational%20Store-Cloudflare%20D1%20(SQLite)-f59e0b?style=flat-square&logo=sqlite&logoColor=white" alt="D1" />
  <img src="https://img.shields.io/badge/Embedding-BAAI%20BGE--base--en--v1.5%20(768d)-06b6d4?style=flat-square" alt="Embedding" />
  <img src="https://img.shields.io/badge/Reranker-BAAI%20BGE--Reranker--Base-8b5cf6?style=flat-square" alt="Reranker" />
  <img src="https://img.shields.io/badge/Primary%20LLM-Meta%20Llama%203.1%208B%20FP8-blue?style=flat-square&logo=meta&logoColor=white" alt="Llama 3.1" />
  <img src="https://img.shields.io/badge/Infra%20Cost-%240.00%2Fmonth%20(Free%20Tier)-success?style=flat-square" alt="Cost" />
</p>

---

## Executive Architecture Summary

Most production RAG implementations rely on heavy infrastructure stacks (dedicated Python microservice containers, hosted vector subscriptions, and multi-tier cloud clusters).

**Masar AI** demonstrates a **zero-overhead, serverless AI architecture**:
- **Zero Containers / Instant Cold Starts**: Executes on Cloudflare V8 worker isolates across global points of presence (<15ms routing).
- **Two-Stage Precision Retrieval**: Vector approximate nearest neighbors (ANN) retrieval via **Vectorize**, followed by cross-encoder neural verification via **Workers AI BGE-Reranker**.
- **Hierarchical Semantic Boundary Chunking**: Section-boundary parsing that keeps atomic logical units intact with injected contextual breadcrumbs.
- **Cross-Language Semantic Bridge**: Normalizes Arabic queries into dense English vector targets on the edge before retrieval, ensuring zero semantic drift against English corpora.
- **Resilient Fallback Inference**: Multi-tier model failover chain guarding against rate limits and transient cloud provider throttles.

---

## System Architecture

```mermaid
flowchart TD
    subgraph Ingestion["1. Offline Semantic Ingestion Engine (Python)"]
        PDFs["Curated Career Playbooks (*.pdf)"]
        Parser["pypdf Text Extraction & Unicode Normalization"]
        Chunker["Hierarchical Semantic Boundary Chunker\n- Heading Detection\n- Sub-chunking (40-290 words)\n- Contextual Header Injection"]
        BGE_Embed["Workers AI: @cf/baai/bge-base-en-v1.5\n(768-dim dense vectors)"]
        Upsert_Vec["Upsert into Cloudflare Vectorize\n(rag-pdf-index)"]
        Insert_D1["Batch INSERT into Cloudflare D1\n(rag-pdf-db: chunks table)"]

        PDFs --> Parser --> Chunker --> BGE_Embed
        BGE_Embed --> Upsert_Vec
        Chunker --> Insert_D1
    end

    subgraph Runtime["2. Serverless Edge Query Pipeline (Cloudflare Worker)"]
        UserQuery["User Query\n(Arabic or English)"]
        QueryClassifier{"Is Arabic Query?"}
        CrossLang["Workers AI: Llama 3.1\nKeyword & Intent Normalization"]
        QueryEmbed["Workers AI: BGE-base-en-v1.5\n(Query Embedding)"]
        ANN["Vectorize ANN Search\n(Top-K = 20 candidates, Cosine)"]
        D1Fetch["D1 Database Lookup\n(Fetch text, doc title, page metadata)"]
        Reranker["Workers AI: @cf/baai/bge-reranker-base\n(Cross-Encoder Reranking)"]
        Filter["Relevance Gate: Score > 0.03\nSelect Top-N = 4 High-Signal Chunks"]
        LLMWaterfall["High-Availability LLM Waterfall\n1. Llama 3.1 8B Instruct FP8\n2. Llama 3.3 70B Instruct Fast\n3. Llama 3.2 3B Instruct\n4. Mistral 7B Instruct"]
        Response["Stream/Return Grounded Answer\n+ Verified Source Citations"]

        UserQuery --> QueryClassifier
        QueryClassifier -- "Yes" --> CrossLang --> QueryEmbed
        QueryClassifier -- "No" --> QueryEmbed
        QueryEmbed --> ANN --> D1Fetch --> Reranker --> Filter --> LLMWaterfall --> Response
    end
```

---

## Core Engineering Decisions

### 1. Hierarchical Semantic Chunking vs. Naive Fixed Windows

| Metric / Feature | Naive Fixed Chunking (Traditional) | Masar AI Hierarchical Chunker |
| :--- | :--- | :--- |
| **Strategy** | Arbitrary token count (e.g., 500 chars) | Section-heading regex boundary detection |
| **Sentence Integrity** | Cuts sentences, bullet points, and tables mid-thought | Keeps atomic thoughts, bullet lists, and paragraphs intact |
| **Context Awareness** | Chunks become orphaned without section context | Injects contextual breadcrumbs (`Document: ... \| Section: ... (Pages ...)`) |
| **Chunk Efficiency** | High fragmentation (100+ noisy vectors) | 46 dense, semantically high-value chunks |

```python
# Contextual Header Injection Pattern (ingestion/ingest.py)
header_prefix = f"Document: {clean_title} | Section: {current_section} (Pages {min_p}-{max_p})\n"
chunk_text = header_prefix + body_text
```

### 2. Two-Stage Retrieval (Bi-Encoder + Cross-Encoder)

1. **Stage 1 (Bi-Encoder - Fast Candidate Retrieval)**:
   - Model: `@cf/baai/bge-base-en-v1.5` (768 dimensions).
   - Computes query vector and searches **Cloudflare Vectorize** using cosine similarity.
   - Retrieves `Top-K = 20` candidate vectors in ~45ms.
2. **Stage 2 (Cross-Encoder - Neural Verification & Reranking)**:
   - Model: `@cf/baai/bge-reranker-base`.
   - Passes the `(query, candidate_text)` pairs jointly through the attention layers of the reranker.
   - Cross-attends query terms with document context, assigning calibrated relevance probabilities (scoring between **0.92 to 0.997** on domain queries).
   - Filters out semantic noise and passes only `Top-N = 4` verified chunks to the LLM.

### 3. Cross-Language Intent Bridge (Arabic / English Corpus)

When users submit questions in Arabic, multilingual vector embeddings often suffer from cross-lingual cosine drift when matched against English technical texts.

- Masar AI executes a deterministic intent normalization step on Workers AI:
  ```json
  [
    {"role": "system", "content": "You are a bilingual RAG query translator. Output ONLY the concise English search query keywords. Do not explain."},
    {"role": "user", "content": "إزاي أعمل سيرة ذاتية تعدي من الـ ATS؟"}
  ]
  ```
- **Output:** `"ATS friendly resume formatting keywords parsing best practices"`
- The resulting vector aligns accurately with the English corpus clusters, maintaining high retrieval precision while the synthesis stage responds in the user's selected language.

### 4. High-Availability LLM Fallback Chain

Serverless AI endpoints can encounter transient rate limits or regional capacity constraints. The worker implements an automated failover waterfall:

```javascript
const LLM_MODELS_FALLBACK_CHAIN = [
  "@cf/meta/llama-3.1-8b-instruct-fp8",        // Primary: Low latency, high reasoning
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast", // High capacity fallback
  "@cf/meta/llama-3.2-3b-instruct",           // Fast ultra-light fallback
  "@cf/mistral/mistral-7b-instruct-v0.2-lora" // External fallback
];
```

---

## Latency and Cost Breakdown

| Pipeline Stage | Technology | Latency | Monthly Cost |
| :--- | :--- | :--- | :--- |
| **Edge Routing & CORS** | Cloudflare Workers (V8 Isolate) | ~5ms | $0.00 (100k req/day free) |
| **Query Embedding** | Workers AI (`bge-base-en-v1.5`) | ~35ms | $0.00 (10k neurons/day free) |
| **Vector Search (Top-20)** | Cloudflare Vectorize | ~40ms | $0.00 (30M queried dim/mo free) |
| **Metadata Hydration** | Cloudflare D1 (Serverless SQLite) | ~12ms | $0.00 (5M read rows/mo free) |
| **Cross-Encoder Rerank** | Workers AI (`bge-reranker-base`) | ~80ms | $0.00 (Free Tier) |
| **LLM Generation** | Workers AI (`llama-3.1-8b-instruct-fp8`) | ~650ms | $0.00 (Free Tier) |
| **Total End-to-End** | Fully Cloudflare Serverless Stack | **~820ms** | **$0.00 / month** |

---

## Repository Structure

```
career-rag-assistant/
├── data/                       # Curated career guides & sample PDF playbooks
│   ├── 01_Resume_Writing_Best_Practices.pdf
│   ├── 02_How_to_Analyze_a_Job_Description.pdf
│   ├── 03_Behavioral_Interview_Framework.pdf
│   ├── ...
├── ingestion/                  # Offline indexing & semantic chunking engine
│   ├── ingest.py               # Section boundary detection, embedding & upserting
│   ├── requirements.txt        # Minimal dependencies (pypdf, requests, python-dotenv)
│   ├── .env.example            # Environment template for local ingestion
│   └── .env                    # (Git-ignored) Cloudflare API credentials
├── worker/                     # Cloudflare Worker RAG runtime
│   ├── src/
│   │   └── index.js            # Vector retrieval, cross-encoder rerank & LLM pipeline
│   ├── schema.sql              # D1 database schema (chunks & metadata)
│   ├── wrangler.jsonc          # Cloudflare resource bindings (AI, Vectorize, D1)
│   └── package.json            # Wrangler tooling
├── frontend/                   # Client interface deployed to Cloudflare Pages
│   ├── index.html              # Clean glassmorphism UI & persona controls
│   ├── style.css               # Design system & animations
│   ├── script.js               # Streaming chat client & state synchronization
│   └── assets/                 # 3D personas & emblem brand assets
├── RAG_ARCHITECTURE.md         # Technical whitepaper & design specifications
├── .gitignore                  # Security shielding (keys, env, wrangler)
├── LICENSE                     # MIT License
└── README.md                   # Repository documentation
```

---

## Getting Started

### Prerequisites
- Node.js 18+ and Python 3.10+
- Cloudflare Account (Workers, Vectorize, D1, Pages)

### Step 1: Cloudflare Edge Worker Setup
```powershell
cd worker
npm install

# 1. Login to Cloudflare
npx wrangler login

# 2. Create the D1 Database & Vectorize Index
npx wrangler d1 create rag-pdf-db
npx wrangler vectorize create rag-pdf-index --dimensions=768 --metric=cosine

# 3. Apply SQL schema
npx wrangler d1 execute rag-pdf-db --remote --file ./schema.sql

# 4. Deploy worker to the edge
npx wrangler deploy
```

### Step 2: Ingestion & Vector Indexing
```powershell
cd ../ingestion

# Set up virtual environment
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Configure Cloudflare API credentials
copy .env.example .env
# Fill in: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID

# Run semantic chunking & indexing
python ingest.py
```

Expected output:
```text
[1/7] Processing: 01_Resume_Writing_Best_Practices.pdf ... Generated 8 semantic chunks
...
Total semantic chunks generated: 46
Upserting 46 vectors to Cloudflare Vectorize (rag-pdf-index)... [OK]
Writing 46 records into Cloudflare D1 (rag-pdf-db)... [OK]
Indexing complete in 4.2s.
```

---

## Security and Secrets Management

This repository adheres to strict security practices:
- **Zero API Keys in Source Code**: All tokens are resolved via Cloudflare runtime environment bindings (`env.AI`, `env.VECTOR_INDEX`, `env.DB`) or via git-ignored local `.env` files.
- **Strict Gitignore Rules**: Excludes `.env`, `.wrangler/`, build caches, and private tokens.
- **Read-Only Public Surface**: The public client communicates only with the `/chat` endpoint of the Worker, with no direct access to D1 or Vectorize credentials.

---

## Author

**Yasmen Aiman**
- GitHub: [@yasmenaiman](https://github.com/yasmenaiman)
- Live Project: [masar-ai-app.pages.dev](https://masar-ai-app.pages.dev)

---

## License
This project is licensed under the [MIT License](LICENSE).
