-- ============================================================================
-- M8 · Build-78a — Resumable OCR checkpoints (PDF -> text)
--
-- WHY: a scanned PDF is OCR'd page-batch by page-batch through Gemini. On Vercel
-- the function is killed at the wall-clock limit, so a large book never finishes
-- OCR in one invocation and (pre-Build-78a) every batch extracted so far was held
-- only in memory and lost on the timeout — the book had to be re-OCR'd from page 1
-- every time, so it never completed. Build-77 made the text->graph step resumable;
-- this table makes the PDF->text step resumable the same way.
--
-- Each row stores ONE page-batch's extracted text. On re-run the already-OCR'd
-- batches are skipped and only the remaining pages are sent to Gemini. Idempotent:
-- safe to run more than once. DO NOT auto-apply — Muhammad applies this live.
-- ============================================================================

create table if not exists public.m8_ocr_checkpoints (
  id           bigint      generated always as identity primary key,
  doc_key      text        not null,                  -- stable key for the source PDF
  batch_start  int         not null,                  -- first page of this batch (1-indexed)
  batch_end    int,                                   -- last page of this batch
  page_text    text,                                  -- extracted text for this batch
  status       text        not null default 'done',   -- 'done' once the batch's text is saved
  total_pages  int,
  title        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (doc_key, batch_start)
);

comment on table public.m8_ocr_checkpoints is
  'Build-78a: per-(doc_key, batch_start) OCR progress. A done row holds that page-batch''s extracted text; a re-run skips done batches and OCRs only the rest, so PDF extraction survives Vercel timeouts.';

create index if not exists m8_ocr_checkpoints_doc_idx
  on public.m8_ocr_checkpoints (doc_key);
