-- D1 schema for the RAG PDF chatbot.
-- Run once during setup with:
--   wrangler d1 execute rag-pdf-db --remote --file ./schema.sql
--
-- Each row is one chunk produced by the ingestion pipeline. chunk_id matches
-- the vector ID used in Vectorize, so a Vectorize match can be resolved back
-- to its full text and citation metadata with a single lookup.

DROP TABLE IF EXISTS chunks;

CREATE TABLE chunks (
  chunk_id    TEXT PRIMARY KEY,
  document    TEXT NOT NULL,   -- original PDF filename, e.g. "machine_learning.pdf"
  page        INTEGER NOT NULL, -- 1-indexed page number within that PDF
  chunk_index INTEGER NOT NULL, -- position of this chunk within its page
  text        TEXT NOT NULL,   -- the actual chunk text sent to the LLM as context
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_chunks_document ON chunks(document);
