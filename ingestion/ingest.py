"""
Masar AI (مسار) — High-Quality Ingestion Pipeline for Multi-PDF Career Dataset.

Pipeline:
    PDFs in ./data/*.pdf
      -> per-page text extraction (pypdf)
      -> comprehensive text cleaning (ligatures, hyphenation fixes, bullet normalization)
      -> sliding-window chunking with overlap (preserves context and sentence flow)
      -> rich metadata tagging (cleaned document title, topic, page number)
      -> vector embeddings via Cloudflare Workers AI (@cf/baai/bge-base-en-v1.5)
      -> upsert into Cloudflare Vectorize
      -> insert text + rich metadata into Cloudflare D1
"""

import os
import re
import sys
import json
import time
import unicodedata
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure') and sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

import requests
from pypdf import PdfReader
from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_FILE)

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

VECTORIZE_INDEX_NAME = os.environ.get("VECTORIZE_INDEX_NAME", "rag-pdf-index")
D1_DATABASE_ID = os.environ.get("D1_DATABASE_ID")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"
EMBED_BATCH_SIZE = 50          # texts per embedding API call
TARGET_CHUNK_WORDS = 220       # ideal semantic chunk size in words
MAX_CHUNK_WORDS = 290          # maximum words before semantic sub-chunking
MIN_CHUNK_WORDS = 40           # minimum words for standalone semantic chunk
D1_INSERT_BATCH_SIZE = 25      # rows per D1 batch insert



# ---------------------------------------------------------------------------
# Text Cleaning & Normalization
# ---------------------------------------------------------------------------

def clean_extracted_text(raw_text: str) -> str:
    """Clean PDF text artifacts, broken characters, ligatures, and formatting."""
    if not raw_text:
        return ""

    # Normalize unicode characters
    text = unicodedata.normalize("NFKC", raw_text)

    # Replace replacement characters (often bullets or em-dashes in pypdf)
    text = text.replace("\ufffd", " - ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")


    # Fix broken hyphenated words at line breaks (e.g., 'engi-\nneer' -> 'engineer')
    text = re.sub(r"(\b[a-zA-Z]{2,})-\s*\n\s*([a-zA-Z]{2,}\b)", r"\1\2", text)

    # Standardize bullet points and list markers
    text = re.sub(r"[\u2022\u2023\u25E6\u2043\u2219]", " • ", text)

    # Fix spacing around punctuation and bullets
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)

    # Remove non-informative standalone page numbering (e.g. 'Page 3 of 10')
    text = re.sub(r"(?i)\bPage\s+\d+\s+of\s+\d+\b", "", text)

    return text.strip()


# ---------------------------------------------------------------------------
# Semantic Chunking Engine (Section, Hierarchy & Paragraph Coherence)
# ---------------------------------------------------------------------------

def split_into_paragraphs(text: str) -> list[str]:
    """Split text into distinct semantic paragraphs."""
    paras = re.split(r"\n\s*\n+", text)
    return [p.strip() for p in paras if p.strip()]


def split_section_into_semantic_chunks(
    section_title: str, text: str, pages: list[int], max_words: int = MAX_CHUNK_WORDS
) -> list[dict]:
    """
    Ensures that coherent semantic sections (frameworks, checklists, scripts)
    remain intact as atomic units whenever possible. Only splits very long
    sections across natural paragraph boundaries.
    """
    words = text.split()
    if len(words) <= max_words:
        return [
            {
                "sub_title": section_title,
                "text": text,
                "pages": pages,
                "word_count": len(words),
            }
        ]

    # Split into coherent paragraph-level chunks
    paragraphs = split_into_paragraphs(text)
    chunks = []
    current_paras = []
    current_words = 0

    for para in paragraphs:
        p_words = len(para.split())
        if current_words + p_words <= max_words:
            current_paras.append(para)
            current_words += p_words
        else:
            if current_paras:
                chunks.append(
                    {
                        "sub_title": f"{section_title} (Part {len(chunks) + 1})",
                        "text": "\n\n".join(current_paras),
                        "pages": pages,
                        "word_count": current_words,
                    }
                )
            current_paras = [para]
            current_words = p_words

    if current_paras:
        # Merge trailing small paragraph with previous chunk to avoid micro-chunks
        if chunks and current_words < MIN_CHUNK_WORDS:
            chunks[-1]["text"] += "\n\n" + "\n\n".join(current_paras)
            chunks[-1]["word_count"] += current_words
        else:
            chunks.append(
                {
                    "sub_title": (
                        f"{section_title} (Part {len(chunks) + 1})"
                        if chunks
                        else section_title
                    ),
                    "text": "\n\n".join(current_paras),
                    "pages": pages,
                    "word_count": current_words,
                }
            )

    return chunks


def extract_semantic_chunks_from_pdf(pdf_path: Path) -> list[dict]:
    """
    Parses a PDF across all pages into clean, hierarchical semantic sections
    without breaking sentences or scripts across artificial page boundaries.
    """
    reader = PdfReader(str(pdf_path))
    doc_lines = []
    for page_num, page in enumerate(reader.pages, start=1):
        cleaned = clean_extracted_text(page.extract_text() or "")
        for line in cleaned.split("\n"):
            line_str = line.strip()
            if line_str:
                doc_lines.append((page_num, line_str))

    # Parse sections following top-level numbered headings: "1. ", "2. ", etc.
    raw_sections = []
    current_section_title = "Overview & Core Concept"
    current_lines = []
    current_pages = set()
    current_section_num = 0

    for page_num, line in doc_lines:
        match = re.match(r"^([1-9])\.\s+([^.\n]{3,65})$", line)
        if match:
            num = int(match.group(1))
            title = match.group(2).strip()
            if num == current_section_num + 1:
                if current_lines:
                    raw_sections.append(
                        {
                            "section_title": current_section_title,
                            "pages": sorted(list(current_pages)),
                            "text": "\n".join(current_lines).strip(),
                        }
                    )
                current_section_num = num
                current_section_title = f"{num}. {title}"
                current_lines = [line]
                current_pages = {page_num}
                continue

        current_lines.append(line)
        current_pages.add(page_num)

    if current_lines:
        raw_sections.append(
            {
                "section_title": current_section_title,
                "pages": sorted(list(current_pages)),
                "text": "\n".join(current_lines).strip(),
            }
        )

    # If first overview section is very short (< MIN_CHUNK_WORDS), merge into section 1
    if len(raw_sections) >= 2 and len(raw_sections[0]["text"].split()) < MIN_CHUNK_WORDS:
        intro = raw_sections.pop(0)
        raw_sections[0]["text"] = intro["text"] + "\n\n" + raw_sections[0]["text"]
        raw_sections[0]["pages"] = sorted(
            list(set(intro["pages"] + raw_sections[0]["pages"]))
        )

    # Process all sections through semantic chunker
    final_chunks = []
    for s_idx, sec in enumerate(raw_sections):
        sub_chunks = split_section_into_semantic_chunks(
            sec["section_title"], sec["text"], sec["pages"]
        )
        for c_idx, sc in enumerate(sub_chunks):
            final_chunks.append(
                {
                    "section_index": s_idx + 1,
                    "chunk_index": c_idx,
                    "section_title": sc["sub_title"],
                    "pages": sc["pages"],
                    "text": sc["text"],
                    "word_count": sc["word_count"],
                }
            )

    return final_chunks



# ---------------------------------------------------------------------------
# Cloudflare API Helpers
# ---------------------------------------------------------------------------

def require_config():
    missing = [
        name
        for name, val in [
            ("CLOUDFLARE_ACCOUNT_ID", ACCOUNT_ID),
            ("CLOUDFLARE_API_TOKEN", API_TOKEN),
            ("D1_DATABASE_ID", D1_DATABASE_ID),
        ]
        if not val
    ]
    if missing:
        print(f"Missing required environment variables: {', '.join(missing)}")
        print("Please configure ingestion/.env with your Cloudflare credentials.")
        sys.exit(1)


def cf_ai_run(model: str, payload: dict) -> dict:
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success", False):
        raise RuntimeError(f"Workers AI call to {model} failed: {data}")
    return data["result"]


def embed_texts(texts: list[str]) -> list[list[float]]:
    all_vectors: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        result = cf_ai_run(EMBEDDING_MODEL, {"text": batch})
        all_vectors.extend(result["data"])
    return all_vectors


def vectorize_upsert(records: list[dict]):
    if not records:
        return
    ndjson_lines = "\n".join(json.dumps(r) for r in records)
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
        f"/vectorize/v2/indexes/{VECTORIZE_INDEX_NAME}/upsert"
    )
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        files={"vectors": ("vectors.ndjson", ndjson_lines.encode("utf-8"), "application/x-ndjson")},
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success", False):
        raise RuntimeError(f"Vectorize upsert failed: {data}")


def d1_execute(sql: str, params: list | None = None):
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
        f"/d1/database/{D1_DATABASE_ID}/query"
    )
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        json={"sql": sql, "params": params or []},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success", False):
        raise RuntimeError(f"D1 query failed: {data}")
    return data["result"]


# ---------------------------------------------------------------------------
# PDF Extraction & Ingestion Flow
# ---------------------------------------------------------------------------

def safe_id_component(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)


def clean_title(filename: str) -> str:
    title = re.sub(r"^\d+[\s_-]*", "", filename)
    title = re.sub(r"\.pdf$", "", title, flags=re.I)
    return title.replace("_", " ").replace("-", " ").title()


def ingest_pdf(pdf_path: Path):
    print(f"\n📄 Processing: {pdf_path.name}")
    doc_id = safe_id_component(pdf_path.stem)
    doc_title = clean_title(pdf_path.name)

    semantic_chunks = extract_semantic_chunks_from_pdf(pdf_path)
    if not semantic_chunks:
        print(f"  ⚠️ No extractable text found in {pdf_path.name}, skipping.")
        return 0

    all_chunk_texts: list[str] = []
    all_chunk_meta: list[dict] = []

    for global_idx, c in enumerate(semantic_chunks):
        chunk_id = f"{doc_id}_s{c['section_index']}_c{c['chunk_index']}"
        pages_display = (
            f"Page {c['pages'][0]}"
            if len(c['pages']) == 1
            else f"Pages {c['pages'][0]}-{c['pages'][-1]}"
        )

        # Context-enriched semantic chunk: Document title, section header, and page range
        searchable_text = (
            f"Document: {doc_title} | Section: {c['section_title']} ({pages_display})\n\n"
            f"{c['text']}"
        )

        all_chunk_texts.append(searchable_text)
        all_chunk_meta.append(
            {
                "chunk_id": chunk_id,
                "document": pdf_path.name,
                "title": doc_title,
                "section": c["section_title"],
                "page": c["pages"][0],
                "chunk_index": global_idx,
            }
        )

    print(f"  Extracted {len(semantic_chunks)} high-precision semantic chunks.")

    # Embed chunks
    print("  Generating vector embeddings...")
    chunk_vectors = embed_texts(all_chunk_texts)


    # Upsert into Vectorize
    print("  Upserting vectors into Vectorize...")
    vector_records = [
        {
            "id": meta["chunk_id"],
            "values": vector,
            "metadata": {
                "document": meta["document"],
                "title": meta["title"],
                "section": meta["section"],
                "page": meta["page"],
            },

        }
        for meta, vector in zip(all_chunk_meta, chunk_vectors)
    ]
    for i in range(0, len(vector_records), 200):
        vectorize_upsert(vector_records[i : i + 200])

    # Insert into D1
    print("  Saving text & metadata in D1...")
    for i in range(0, len(all_chunk_meta), D1_INSERT_BATCH_SIZE):
        batch_meta = all_chunk_meta[i : i + D1_INSERT_BATCH_SIZE]
        batch_text = all_chunk_texts[i : i + D1_INSERT_BATCH_SIZE]
        for meta, text in zip(batch_meta, batch_text):
            d1_execute(
                "INSERT OR REPLACE INTO chunks (chunk_id, document, page, chunk_index, text) "
                "VALUES (?, ?, ?, ?, ?)",
                [meta["chunk_id"], meta["document"], meta["page"], meta["chunk_index"], text],
            )
        time.sleep(0.08)

    print(f"  ✅ Successfully indexed {len(all_chunk_texts)} chunks for {pdf_path.name}.")
    return len(all_chunk_texts)


def main():
    require_config()

    pdf_paths = sorted(DATA_DIR.glob("*.pdf"))
    if not pdf_paths:
        print(f"No PDF files found in {DATA_DIR}.")
        sys.exit(1)

    print(f"🚀 Starting Masar AI Ingestion for {len(pdf_paths)} documents:")
    for p in pdf_paths:
        print(f"  - {p.name}")

    total_chunks = 0
    for pdf_path in pdf_paths:
        total_chunks += ingest_pdf(pdf_path)

    print(f"\n🎉 Ingestion complete! Total {total_chunks} chunks indexed across {len(pdf_paths)} documents.")


if __name__ == "__main__":
    main()
