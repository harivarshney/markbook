# Markbook — AI Assessment Extraction & Answer Mapping

A teacher uploads a question paper and a student's handwritten answer sheet.
Markbook extracts every question, finds the matching handwritten answer for
each one, highlights exactly where that answer is on the sheet, and grades
it.

## How it works

1. **Upload** — question paper + answer sheet, each a PDF or image, with
   live processing progress.
2. **Render** — PDFs are rasterized server-side to per-page PNGs
   (`pdfjs-dist` + `@napi-rs/canvas`, prebuilt native binaries, no headless
   browser or system Cairo needed — works on serverless platforms like
   Vercel).
3. **Extract questions** — all question-paper pages go to Gemini in one call
   so it can reason about numbering and multi-page questions together.
   Labelled sub-parts (e.g. `11 (a)`, `11 (b)`) are split into separate
   entries, with the original numbering preserved exactly.
4. **Extract answers** — each answer-sheet page is sent to Gemini
   individually, so returned bounding boxes stay unambiguous relative to a
   single image. For every handwritten region the model returns a tight
   box, a transcription, and the question label the student wrote (if
   legible).
5. **Map & grade** — a third Gemini call matches answer segments to
   questions (by detected label first, then content), groups multi-page
   answers, flags unanswered questions and answers that don't match any
   question, and grades each answered question with a score and short
   feedback.
6. **Review** — question list on the left; clicking a question renders the
   relevant answer-sheet page(s) on the right with the matched region
   highlighted (a percentage-based overlay, so it stays pixel-accurate at
   any screen size).

Progress shown during processing is streamed live from the server as each
pipeline stage actually starts/finishes — not a simulated progress bar.

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS
- Gemini 2.5 Flash (`@google/genai`) for extraction, mapping, and grading
- `pdfjs-dist` + `@napi-rs/canvas` for PDF → image rendering
- No database — everything is processed in memory per request; the result
  is held client-side for the review page

## Running locally

\`\`\`bash
npm install
cp .env.example .env.local   # then paste in your Gemini API key
npm run dev
\`\`\`

Get a free Gemini API key at https://aistudio.google.com/apikey.

## Assumptions & limitations

- Bounding-box accuracy on handwriting depends on scan quality; messy or
  faint handwriting produces looser highlight boxes.
- Grading is AI-generated and meant as a first-pass aid for a teacher, not
  a final authoritative mark.
- PDFs are capped at 30 pages and 20MB per file to keep processing within a
  single serverless request.
- No authentication or database — state lives for the duration of one
  session.

## License

MIT — see `LICENSE`.