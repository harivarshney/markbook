# Markbook — Full Source (single-file overview)

This file inlines every core source file so it can be reviewed without cloning the repo or navigating folders. The actual runnable project (with `npm install`-able structure) is in the project folder / zip — this is a read-only convenience copy.

## Contents

- [`lib/types.ts`](#libtypests) — Shared types for the whole pipeline
- [`lib/pdf-to-images.ts`](#libpdf-to-imagests) — PDF/image -> per-page PNG rendering (server-side)
- [`lib/gemini.ts`](#libgeminits) — Gemini calls: question extraction, answer extraction, mapping & grading
- [`app/api/process/route.ts`](#appapiprocessroutets) — Main API route - orchestrates the pipeline, streams progress via SSE
- [`app/page.tsx`](#apppagetsx) — Upload page (entry point, route: /)
- [`app/review/page.tsx`](#appreviewpagetsx) — Review page - question list + highlighted answer viewer (route: /review)
- [`components/UploadSlot.tsx`](#componentsuploadslottsx) — Drag-and-drop upload slot component
- [`app/layout.tsx`](#applayouttsx) — Root layout - fonts, metadata
- [`app/globals.css`](#appglobalscss) — Design tokens / theme (paper, ink, highlighter palette)

## `lib/types.ts`

_Shared types for the whole pipeline_

```typescript
// Shared types for the assessment extraction & mapping pipeline.

export type PageImage = {
  page: number; // 1-indexed
  width: number;
  height: number;
  dataUrl: string; // data:image/png;base64,...
};

export type ExtractedQuestion = {
  id: string;
  number: string; // printed number, e.g. "11"
  subpart?: string; // e.g. "a" for 11(a)
  label: string; // full display label, e.g. "11 (a)"
  text: string;
  page: number;
  order: number; // printed order index, 0-based
};

// A contiguous handwritten region on one page of the answer sheet that the
// model has identified as (part of) an answer.
export type AnswerSegment = {
  id: string;
  page: number;
  // normalized 0-1000 box, Gemini spatial convention: [ymin, xmin, ymax, xmax]
  box: [number, number, number, number];
  text: string; // best-effort transcription
  detectedLabel?: string; // question number the student wrote, if any (e.g. "Q11 a")
};

export type MappingStatus = "answered" | "unanswered";
export type Verdict = "correct" | "partial" | "incorrect" | "ungraded";

export type QuestionMapping = {
  questionId: string;
  status: MappingStatus;
  answerSegmentIds: string[];
  score?: number;
  maxScore?: number;
  verdict?: Verdict;
  feedback?: string;
};

export type ProcessResult = {
  questions: ExtractedQuestion[];
  answerSegments: AnswerSegment[];
  answerPages: PageImage[];
  mappings: QuestionMapping[];
  unmatchedAnswerSegmentIds: string[];
  overall?: {
    totalScore: number;
    maxScore: number;
    summary: string;
  };
};
```

## `lib/pdf-to-images.ts`

_PDF/image -> per-page PNG rendering (server-side)_

```typescript
import "server-only";
import { createCanvas } from "@napi-rs/canvas";

// pdfjs-dist v6 legacy build - works in plain Node (no DOM) when given an
// explicit canvas factory. We patch the canvas creation with @napi-rs/canvas,
// which ships prebuilt native binaries (no system cairo/pango needed), so it
// works both locally and on serverless platforms like Vercel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsLib;
}

export type RenderedPage = {
  page: number;
  width: number;
  height: number;
  dataUrl: string;
  pngBuffer: Buffer;
};

const RENDER_SCALE = 2.0; // ~144 DPI equivalent for a 72dpi PDF unit page - good balance of clarity vs payload size
const MAX_PAGES = 30;

/**
 * Converts a PDF (as bytes) into an array of rendered page PNGs, in printed order.
 */
export async function renderPdfToImages(bytes: Uint8Array): Promise<RenderedPage[]> {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const numPages = Math.min(pdf.numPages, MAX_PAGES);

  const pages: RenderedPage[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    // @napi-rs/canvas's context is close enough to the DOM CanvasRenderingContext2D
    // surface that pdf.js's renderer works against it directly.
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;

    const pngBuffer = canvas.toBuffer("image/png");
    pages.push({
      page: i,
      width: canvas.width,
      height: canvas.height,
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      pngBuffer,
    });
  }
  return pages;
}

/**
 * Normalizes a raw image upload (jpg/png/webp) into the same RenderedPage shape,
 * as a single "page 1". Re-encodes through @napi-rs/canvas so downstream code
 * can rely on PNG + known pixel dimensions uniformly.
 */
export async function imageToRenderedPage(bytes: Uint8Array): Promise<RenderedPage> {
  const { Image } = await import("@napi-rs/canvas");
  const img = new Image();
  img.src = Buffer.from(bytes);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const pngBuffer = canvas.toBuffer("image/png");
  return {
    page: 1,
    width: canvas.width,
    height: canvas.height,
    dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
    pngBuffer,
  };
}

export async function fileToRenderedPages(bytes: Uint8Array, mimeType: string): Promise<RenderedPage[]> {
  if (mimeType === "application/pdf") {
    return renderPdfToImages(bytes);
  }
  if (mimeType.startsWith("image/")) {
    return [await imageToRenderedPage(bytes)];
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
```

## `lib/gemini.ts`

_Gemini calls: question extraction, answer extraction, mapping & grading_

```typescript
import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import type { RenderedPage } from "./pdf-to-images";
import type { AnswerSegment, ExtractedQuestion, QuestionMapping } from "./types";

const MODEL = "gemini-2.5-flash";

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your environment (see .env.example)."
    );
  }
  return new GoogleGenAI({ apiKey });
}

function pageToPart(p: RenderedPage) {
  return {
    inlineData: {
      mimeType: "image/png",
      data: p.pngBuffer.toString("base64"),
    },
  };
}

// ---------- Question extraction ----------

const questionSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          number: { type: Type.STRING, description: "Printed main question number, e.g. '11'" },
          subpart: { type: Type.STRING, description: "Sub-part label if present, e.g. 'a'. Empty string if none." },
          text: { type: Type.STRING, description: "Full text of the question or sub-question." },
          page: { type: Type.INTEGER, description: "1-indexed page number this question appears on." },
        },
        required: ["number", "subpart", "text", "page"],
      },
    },
  },
  required: ["questions"],
};

export async function extractQuestions(pages: RenderedPage[]): Promise<ExtractedQuestion[]> {
  const ai = client();
  const parts = pages.flatMap((p, i) => [
    { text: `--- Question paper, page ${i + 1} ---` },
    pageToPart(p),
  ]);

  const prompt = `You are analyzing a scanned/printed exam question paper (${pages.length} page(s), images attached in printed order).

Extract every question in the exact order they are printed, top to bottom, page by page.

Rules:
- Treat labelled sub-parts as SEPARATE entries. Example: "11 (a)" and "11 (b)" are two entries, each with number="11" and subpart="a" / "b" respectively.
- If a question has no sub-part, leave subpart as an empty string "".
- Preserve the original numbering exactly as printed (do not renumber).
- Include the full question text (instructions, marks in brackets if present, etc. can be included as part of the text).
- Do not include section headers, instructions, or the paper title as questions.
- record which page each question starts on.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: questionSchema,
      temperature: 0,
    },
  });

  const parsed = JSON.parse(response.text ?? "{}") as {
    questions: { number: string; subpart: string; text: string; page: number }[];
  };

  return (parsed.questions ?? []).map((q, idx) => ({
    id: `q_${idx}`,
    number: q.number,
    subpart: q.subpart || undefined,
    label: q.subpart ? `${q.number} (${q.subpart})` : q.number,
    text: q.text,
    page: q.page,
    order: idx,
  }));
}

// ---------- Answer extraction (per page, so bboxes stay relative to a single image) ----------

const answerSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          box_2d: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] normalized 0-1000 bounding box tightly around this answer region.",
          },
          detected_label: {
            type: Type.STRING,
            description: "Question number/label the student wrote next to this answer, if legible (e.g. 'Q11(a)', '3'). Empty string if none written or illegible.",
          },
          text: {
            type: Type.STRING,
            description: "Best-effort transcription of the handwritten content in this region.",
          },
        },
        required: ["box_2d", "detected_label", "text"],
      },
    },
  },
  required: ["segments"],
};

export async function extractAnswerSegmentsForPage(
  page: RenderedPage
): Promise<Omit<AnswerSegment, "id" | "page">[]> {
  const ai = client();
  const prompt = `This image is one page of a student's handwritten exam answer sheet.

Identify every distinct answer region on this page: each contiguous block of handwriting that answers one question (or one sub-part of a question). A single page may contain answers to multiple questions, or a continuation of an answer that started on a previous page.

For each region:
- Give a tight bounding box in box_2d as [ymin, xmin, ymax, xmax], normalized to a 0-1000 scale relative to this image's width/height.
- detected_label: transcribe the question number the student wrote (e.g. "Q11(a)", "Ans 3", "5 b") if legible near the region. Leave empty if the student did not label it or it's illegible.
- text: transcribe the handwritten answer content as accurately as possible.

If the page is blank or has no legible handwriting, return an empty segments array. If there is rough/scratch work that isn't a real answer attempt, you may still include it but you don't have to.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }, pageToPart(page)] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: answerSchema,
      temperature: 0,
    },
  });

  const parsed = JSON.parse(response.text ?? "{}") as {
    segments: { box_2d: number[]; detected_label: string; text: string }[];
  };

  return (parsed.segments ?? [])
    .filter((s) => Array.isArray(s.box_2d) && s.box_2d.length === 4)
    .map((s) => ({
      box: [s.box_2d[0], s.box_2d[1], s.box_2d[2], s.box_2d[3]] as [number, number, number, number],
      detectedLabel: s.detected_label || undefined,
      text: s.text,
    }));
}

export async function extractAllAnswerSegments(pages: RenderedPage[]): Promise<AnswerSegment[]> {
  const results = await Promise.all(pages.map((p) => extractAnswerSegmentsForPage(p)));
  const segments: AnswerSegment[] = [];
  results.forEach((segs, pageIdx) => {
    segs.forEach((s, i) => {
      segments.push({
        id: `a_${pageIdx}_${i}`,
        page: pages[pageIdx].page,
        ...s,
      });
    });
  });
  return segments;
}

// ---------- Mapping + grading ----------

const mappingSchema = {
  type: Type.OBJECT,
  properties: {
    mappings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionId: { type: Type.STRING },
          status: { type: Type.STRING, description: "'answered' or 'unanswered'" },
          answerSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          score: { type: Type.NUMBER, description: "Awarded marks. 0 if unanswered." },
          maxScore: { type: Type.NUMBER, description: "Suggested max marks for this question (estimate from question text/marks if stated, else default 5)." },
          verdict: { type: Type.STRING, description: "'correct' | 'partial' | 'incorrect' | 'ungraded'" },
          feedback: { type: Type.STRING, description: "1-2 sentence feedback for the student." },
        },
        required: ["questionId", "status", "answerSegmentIds", "score", "maxScore", "verdict", "feedback"],
      },
    },
    unmatchedAnswerSegmentIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Answer segment ids that don't correspond to any known question.",
    },
    overallSummary: { type: Type.STRING, description: "2-3 sentence overall grading summary for the teacher." },
  },
  required: ["mappings", "unmatchedAnswerSegmentIds", "overallSummary"],
};

export async function mapAndGrade(
  questions: ExtractedQuestion[],
  segments: AnswerSegment[]
): Promise<{ mappings: QuestionMapping[]; unmatchedAnswerSegmentIds: string[]; overallSummary: string }> {
  const ai = client();

  const questionsPayload = questions.map((q) => ({
    id: q.id,
    label: q.label,
    text: q.text,
  }));
  const segmentsPayload = segments.map((s) => ({
    id: s.id,
    page: s.page,
    detectedLabel: s.detectedLabel ?? "",
    text: s.text,
  }));

  const prompt = `You are mapping a student's handwritten answers to the correct questions from an exam paper, then grading each answer.

QUESTIONS (in printed order):
${JSON.stringify(questionsPayload, null, 2)}

ANSWER SEGMENTS (extracted from the answer sheet, may be out of order, may span multiple pages, may include content that doesn't belong to any question):
${JSON.stringify(segmentsPayload, null, 2)}

Task:
1. For each question, determine which answer segment(s) belong to it (an answer may span multiple segments/pages - group them). Match primarily using detectedLabel when present and consistent with the question numbering, otherwise use semantic content matching between the question text and the segment text.
2. Mark a question "unanswered" if no segment reasonably matches it - do not force a weak match.
3. Any answer segment that doesn't clearly belong to any question should be listed in unmatchedAnswerSegmentIds instead of forced onto a question.
4. Grade each answered question: award a score out of a reasonable maxScore (infer from marks stated in the question text if present, otherwise use 5), give a verdict, and 1-2 sentences of constructive feedback. For unanswered questions, score=0, verdict="ungraded", feedback should note it was not attempted.
5. Write a short overall summary for the teacher (attempted vs unanswered, general performance).

Every question id from the input must appear exactly once in mappings.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: mappingSchema,
      temperature: 0,
    },
  });

  const parsed = JSON.parse(response.text ?? "{}") as {
    mappings: {
      questionId: string;
      status: string;
      answerSegmentIds: string[];
      score: number;
      maxScore: number;
      verdict: string;
      feedback: string;
    }[];
    unmatchedAnswerSegmentIds: string[];
    overallSummary: string;
  };

  const mappings: QuestionMapping[] = (parsed.mappings ?? []).map((m) => ({
    questionId: m.questionId,
    status: m.status === "answered" ? "answered" : "unanswered",
    answerSegmentIds: m.answerSegmentIds ?? [],
    score: m.score,
    maxScore: m.maxScore,
    verdict: (["correct", "partial", "incorrect", "ungraded"].includes(m.verdict)
      ? m.verdict
      : "ungraded") as QuestionMapping["verdict"],
    feedback: m.feedback,
  }));

  return {
    mappings,
    unmatchedAnswerSegmentIds: parsed.unmatchedAnswerSegmentIds ?? [],
    overallSummary: parsed.overallSummary ?? "",
  };
}
```

## `app/api/process/route.ts`

_Main API route - orchestrates the pipeline, streams progress via SSE_

```typescript
import { NextRequest } from "next/server";
import { fileToRenderedPages } from "@/lib/pdf-to-images";
import { extractAllAnswerSegments, extractQuestions, mapAndGrade } from "@/lib/gemini";
import type { ProcessResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 20 * 1024 * 1024; // 20MB per file

export type ProgressEvent =
  | { type: "progress"; stage: string; status: "start" | "done"; detail?: string }
  | { type: "result"; payload: ProcessResult }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const form = await req.formData();
        const questionFile = form.get("questionPaper");
        const answerFile = form.get("answerSheet");

        if (!(questionFile instanceof File) || !(answerFile instanceof File)) {
          send({ type: "error", message: "Both questionPaper and answerSheet files are required." });
          controller.close();
          return;
        }
        for (const [label, f] of [
          ["Question paper", questionFile],
          ["Answer sheet", answerFile],
        ] as const) {
          if (!ALLOWED_TYPES.has(f.type)) {
            send({ type: "error", message: `${label}: unsupported file type "${f.type}". Upload a PDF, PNG, JPEG, or WEBP.` });
            controller.close();
            return;
          }
          if (f.size > MAX_BYTES) {
            send({ type: "error", message: `${label}: file too large (max 20MB).` });
            controller.close();
            return;
          }
        }

        send({ type: "progress", stage: "upload", status: "done" });

        send({ type: "progress", stage: "render", status: "start" });
        const [questionBytes, answerBytes] = await Promise.all([
          questionFile.arrayBuffer().then((b) => new Uint8Array(b)),
          answerFile.arrayBuffer().then((b) => new Uint8Array(b)),
        ]);
        const [questionPages, answerPages] = await Promise.all([
          fileToRenderedPages(questionBytes, questionFile.type),
          fileToRenderedPages(answerBytes, answerFile.type),
        ]);
        if (questionPages.length === 0) {
          send({ type: "error", message: "Could not read any pages from the question paper." });
          controller.close();
          return;
        }
        if (answerPages.length === 0) {
          send({ type: "error", message: "Could not read any pages from the answer sheet." });
          controller.close();
          return;
        }
        send({
          type: "progress",
          stage: "render",
          status: "done",
          detail: `${questionPages.length} question page(s), ${answerPages.length} answer page(s)`,
        });

        send({ type: "progress", stage: "questions", status: "start" });
        send({ type: "progress", stage: "answers", status: "start" });
        const [questions, answerSegments] = await Promise.all([
          extractQuestions(questionPages),
          extractAllAnswerSegments(answerPages),
        ]);
        send({ type: "progress", stage: "questions", status: "done", detail: `${questions.length} question(s) found` });
        send({ type: "progress", stage: "answers", status: "done", detail: `${answerSegments.length} answer region(s) found` });

        if (questions.length === 0) {
          send({ type: "error", message: "No questions could be extracted from the question paper. Try a clearer scan." });
          controller.close();
          return;
        }

        send({ type: "progress", stage: "mapping", status: "start" });
        const { mappings, unmatchedAnswerSegmentIds, overallSummary } = await mapAndGrade(questions, answerSegments);
        send({ type: "progress", stage: "mapping", status: "done" });

        const totalScore = mappings.reduce((sum, m) => sum + (m.score ?? 0), 0);
        const maxScore = mappings.reduce((sum, m) => sum + (m.maxScore ?? 0), 0);

        const result: ProcessResult = {
          questions,
          answerSegments,
          answerPages: answerPages.map((p) => ({
            page: p.page,
            width: p.width,
            height: p.height,
            dataUrl: p.dataUrl,
          })),
          mappings,
          unmatchedAnswerSegmentIds,
          overall: { totalScore, maxScore, summary: overallSummary },
        };

        send({ type: "result", payload: result });
        controller.close();
      } catch (err) {
        console.error("processing error:", err);
        const message = err instanceof Error ? err.message : "Unknown error while processing files.";
        try {
          send({ type: "error", message });
        } catch {
          /* controller may already be closing */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

## `app/page.tsx`

_Upload page (entry point, route: /)_

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { UploadSlot } from "@/components/UploadSlot";
import type { ProcessResult } from "@/lib/types";
import { Sparkles, ArrowRight, CircleAlert } from "lucide-react";

type StageKey = "upload" | "render" | "questions" | "answers" | "mapping";

const STAGES: { key: StageKey; label: string }[] = [
  { key: "upload", label: "Receiving files" },
  { key: "render", label: "Reading pages" },
  { key: "questions", label: "Extracting questions" },
  { key: "answers", label: "Extracting answers" },
  { key: "mapping", label: "Mapping & grading" },
];

export default function Home() {
  const router = useRouter();
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stageStatus, setStageStatus] = useState<Record<string, "pending" | "active" | "done">>({});
  const [stageDetail, setStageDetail] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<ProcessResult | null>(null);

  const canProcess = !!questionPaper && !!answerSheet && !processing;

  const handleProcess = useCallback(async () => {
    if (!questionPaper || !answerSheet) return;
    setProcessing(true);
    setError(null);
    resultRef.current = null;
    setStageStatus(Object.fromEntries(STAGES.map((s) => [s.key, "pending"])));
    setStageDetail({});

    try {
      const form = new FormData();
      form.append("questionPaper", questionPaper);
      form.append("answerSheet", answerSheet);

      const res = await fetch("/api/process", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          const event = JSON.parse(json);

          if (event.type === "progress") {
            setStageStatus((prev) => ({ ...prev, [event.stage]: event.status === "start" ? "active" : "done" }));
            if (event.detail) setStageDetail((prev) => ({ ...prev, [event.stage]: event.detail }));
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "result") {
            resultRef.current = event.payload as ProcessResult;
          }
        }
      }

      if (!resultRef.current) throw new Error("Processing finished without a result. Please try again.");

      sessionStorage.setItem("markbook:result", JSON.stringify(resultRef.current));
      router.push("/review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setProcessing(false);
    }
  }, [questionPaper, answerSheet, router]);

  return (
    <main className="flex-1 flex flex-col items-center px-6 py-16 sm:py-24">
      <div className="w-full max-w-2xl">
        <header className="mb-12 text-center">
          <p className="font-mono text-xs tracking-[0.2em] uppercase text-pen-red mb-3">
            Assessment extraction &amp; grading
          </p>
          <h1 className="font-display text-4xl sm:text-5xl text-ink italic">Markbook</h1>
          <p className="mt-4 font-body text-ink-soft max-w-md mx-auto text-[15px] leading-relaxed">
            Upload a question paper and a student&apos;s handwritten answer sheet. Markbook extracts every
            question, finds the matching answer, highlights exactly where it is, and grades it.
          </p>
        </header>

        {!processing ? (
          <>
            <div className="flex flex-col sm:flex-row gap-6 mt-10">
              <UploadSlot
                label="Question paper"
                hint="PDF, PNG, or JPG"
                file={questionPaper}
                onChange={setQuestionPaper}
                tabColor="red"
              />
              <UploadSlot
                label="Answer sheet"
                hint="PDF, PNG, or JPG"
                file={answerSheet}
                onChange={setAnswerSheet}
                tabColor="amber"
              />
            </div>

            {error && (
              <div className="mt-6 flex items-start gap-2.5 rounded-sm border border-pen-red/30 bg-pen-red-soft px-4 py-3">
                <CircleAlert className="h-4 w-4 text-pen-red mt-0.5 shrink-0" strokeWidth={1.5} />
                <p className="font-body text-sm text-pen-red">{error}</p>
              </div>
            )}

            <button
              type="button"
              disabled={!canProcess}
              onClick={handleProcess}
              className="mt-10 w-full flex items-center justify-center gap-2 rounded-sm bg-ink text-paper py-4 font-body text-sm tracking-wide uppercase disabled:opacity-30 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors cursor-pointer"
            >
              Process assessment
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </>
        ) : (
          <div className="mt-10 rounded-sm border border-rule-strong bg-paper-raised px-8 py-12">
            <div className="flex justify-center mb-8">
              <Sparkles className="sparkle h-6 w-6 text-highlighter" strokeWidth={1.5} />
            </div>
            <ol className="space-y-5 max-w-sm mx-auto">
              {STAGES.map((stage) => {
                const status = stageStatus[stage.key] ?? "pending";
                return (
                  <li key={stage.key} className="flex items-center gap-3.5">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                        status === "done"
                          ? "bg-pen-green"
                          : status === "active"
                          ? "bg-highlighter animate-pulse"
                          : "bg-rule-strong"
                      }`}
                    />
                    <span
                      className={`font-body text-sm ${
                        status === "pending" ? "text-ink-soft/50" : "text-ink"
                      }`}
                    >
                      {stage.label}
                      {stageDetail[stage.key] ? (
                        <span className="text-ink-soft font-mono text-xs"> — {stageDetail[stage.key]}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </main>
  );
}
```

## `app/review/page.tsx`

_Review page - question list + highlighted answer viewer (route: /review)_

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnswerSegment, ExtractedQuestion, ProcessResult, QuestionMapping } from "@/lib/types";
import { CircleCheck, CircleX, CircleDashed, CircleMinus, ArrowLeft, FileWarning } from "lucide-react";

type Selection = { type: "question" | "unmatched"; id: string };

const VERDICT_STYLE: Record<string, { label: string; classes: string; icon: React.ElementType }> = {
  correct: { label: "Correct", classes: "text-pen-green bg-pen-green-soft", icon: CircleCheck },
  partial: { label: "Partial", classes: "text-highlighter bg-highlighter-soft", icon: CircleMinus },
  incorrect: { label: "Incorrect", classes: "text-pen-red bg-pen-red-soft", icon: CircleX },
  ungraded: { label: "Not attempted", classes: "text-ink-soft bg-rule/60", icon: CircleDashed },
};

function loadResult(): ProcessResult | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem("markbook:result");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProcessResult;
  } catch {
    return null;
  }
}

export default function ReviewPage() {
  const router = useRouter();
  const [result] = useState<ProcessResult | null>(() => loadResult());
  const [selection, setSelection] = useState<Selection | null>(() => {
    const r = loadResult();
    return r && r.questions.length > 0 ? { type: "question", id: r.questions[0].id } : null;
  });
  const [showUnmatched, setShowUnmatched] = useState(false);

  useEffect(() => {
    if (!result) router.replace("/");
  }, [result, router]);

  if (!result) return null;

  return <ReviewBody result={result} selection={selection} setSelection={setSelection} showUnmatched={showUnmatched} setShowUnmatched={setShowUnmatched} />;
}

function ReviewBody({
  result,
  selection,
  setSelection,
  showUnmatched,
  setShowUnmatched,
}: {
  result: ProcessResult;
  selection: Selection | null;
  setSelection: (s: Selection) => void;
  showUnmatched: boolean;
  setShowUnmatched: (b: boolean) => void;
}) {
  const router = useRouter();
  const mappingByQuestion = useMemo(() => {
    const m = new Map<string, QuestionMapping>();
    result.mappings.forEach((mp) => m.set(mp.questionId, mp));
    return m;
  }, [result.mappings]);

  const segmentById = useMemo(() => {
    const m = new Map<string, AnswerSegment>();
    result.answerSegments.forEach((s) => m.set(s.id, s));
    return m;
  }, [result.answerSegments]);

  const pageByNumber = useMemo(() => {
    const m = new Map<number, ProcessResult["answerPages"][number]>();
    result.answerPages.forEach((p) => m.set(p.page, p));
    return m;
  }, [result.answerPages]);

  const relevantSegments: AnswerSegment[] = useMemo(() => {
    if (!selection) return [];
    if (selection.type === "unmatched") {
      const s = segmentById.get(selection.id);
      return s ? [s] : [];
    }
    const mapping = mappingByQuestion.get(selection.id);
    if (!mapping) return [];
    return mapping.answerSegmentIds.map((id) => segmentById.get(id)).filter((s): s is AnswerSegment => !!s);
  }, [selection, mappingByQuestion, segmentById]);

  const relevantPages = useMemo(() => {
    const pages = Array.from(new Set(relevantSegments.map((s) => s.page))).sort((a, b) => a - b);
    return pages.map((p) => pageByNumber.get(p)).filter((p): p is ProcessResult["answerPages"][number] => !!p);
  }, [relevantSegments, pageByNumber]);

  const selectedQuestion = selection?.type === "question" ? result.questions.find((q) => q.id === selection.id) : undefined;
  const selectedMapping = selectedQuestion ? mappingByQuestion.get(selectedQuestion.id) : undefined;

  const scorePercent = result.overall && result.overall.maxScore > 0 ? Math.round((result.overall.totalScore / result.overall.maxScore) * 100) : null;

  return (
    <div className="flex-1 flex flex-col no-ruled-bg">
      {/* Header */}
      <header className="border-b border-rule-strong bg-paper-raised px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => {
              sessionStorage.removeItem("markbook:result");
              router.push("/");
            }}
            className="flex items-center gap-1.5 font-mono text-xs text-ink-soft hover:text-ink transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            New
          </button>
          <div className="h-6 w-px bg-rule-strong shrink-0" />
          <h1 className="font-display italic text-xl text-ink truncate">Markbook</h1>
        </div>
        {result.overall && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-mono text-[11px] text-ink-soft uppercase tracking-wide">Score</p>
              <p className="font-display text-lg text-ink">
                {result.overall.totalScore} / {result.overall.maxScore}
                {scorePercent !== null && <span className="text-ink-soft text-sm font-body"> ({scorePercent}%)</span>}
              </p>
            </div>
          </div>
        )}
      </header>

      {result.overall?.summary && (
        <div className="px-6 py-3 bg-highlighter-soft/50 border-b border-rule">
          <p className="font-body text-sm text-ink-soft max-w-4xl">{result.overall.summary}</p>
        </div>
      )}

      <div className="flex-1 flex min-h-0 flex-col lg:flex-row">
        {/* Question list */}
        <aside className="lg:w-[380px] shrink-0 border-r border-rule-strong bg-paper-raised overflow-y-auto">
          <ul className="divide-y divide-rule">
            {result.questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                mapping={mappingByQuestion.get(q.id)}
                active={selection?.type === "question" && selection.id === q.id}
                onClick={() => setSelection({ type: "question", id: q.id })}
              />
            ))}
          </ul>

          {result.unmatchedAnswerSegmentIds.length > 0 && (
            <div className="border-t border-rule-strong">
              <button
                onClick={() => setShowUnmatched(!showUnmatched)}
                className="w-full flex items-center gap-2 px-5 py-3.5 font-body text-sm text-pen-red cursor-pointer hover:bg-pen-red-soft/40 transition-colors"
              >
                <FileWarning className="h-4 w-4" strokeWidth={1.5} />
                {result.unmatchedAnswerSegmentIds.length} unmatched answer{result.unmatchedAnswerSegmentIds.length > 1 ? "s" : ""}
              </button>
              {showUnmatched && (
                <ul className="divide-y divide-rule bg-paper">
                  {result.unmatchedAnswerSegmentIds.map((id) => {
                    const seg = segmentById.get(id);
                    if (!seg) return null;
                    const active = selection?.type === "unmatched" && selection.id === id;
                    return (
                      <li key={id}>
                        <button
                          onClick={() => setSelection({ type: "unmatched", id })}
                          className={`w-full text-left px-5 py-3 font-body text-xs ${active ? "bg-highlighter-soft" : "hover:bg-paper-raised"}`}
                        >
                          <span className="font-mono text-ink-soft">p.{seg.page}</span>{" "}
                          <span className="text-ink-soft">{seg.text.slice(0, 80) || "(no legible text)"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </aside>

        {/* Answer viewer */}
        <section className="flex-1 min-w-0 overflow-y-auto bg-paper px-6 py-8">
          {selection?.type === "question" && selectedQuestion && (
            <div className="max-w-3xl mx-auto mb-6">
              <p className="font-mono text-xs text-pen-red uppercase tracking-wide mb-1">Question {selectedQuestion.label}</p>
              <p className="font-body text-ink text-[15px] leading-relaxed">{selectedQuestion.text}</p>
              {selectedMapping && (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <VerdictPill verdict={selectedMapping.verdict ?? "ungraded"} />
                  {selectedMapping.status === "answered" && (
                    <span className="font-mono text-xs text-ink-soft">
                      {selectedMapping.score ?? 0} / {selectedMapping.maxScore ?? 0} marks
                    </span>
                  )}
                  {selectedMapping.feedback && (
                    <span className="font-body text-xs text-ink-soft italic">{selectedMapping.feedback}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {relevantPages.length === 0 ? (
            <div className="max-w-3xl mx-auto rounded-sm border border-dashed border-rule-strong bg-paper-raised py-16 text-center">
              <p className="font-display italic text-lg text-ink-soft">Not answered</p>
              <p className="font-body text-sm text-ink-soft mt-1">No matching region was found on the answer sheet.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-8">
              {relevantPages.map((page) => (
                <div key={page.page}>
                  <p className="font-mono text-[11px] text-ink-soft mb-2 uppercase tracking-wide">
                    Answer sheet — page {page.page}
                  </p>
                  <div
                    className="relative w-full rounded-sm overflow-hidden border border-rule-strong bg-white shadow-sm"
                    style={{ aspectRatio: `${page.width} / ${page.height}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={page.dataUrl} alt={`Answer sheet page ${page.page}`} className="w-full h-full block select-none" draggable={false} />
                    {relevantSegments
                      .filter((s) => s.page === page.page)
                      .map((s) => {
                        const [ymin, xmin, ymax, xmax] = s.box;
                        return (
                          <span
                            key={s.id}
                            className="highlight-swipe absolute rounded-[2px] mix-blend-multiply"
                            style={{
                              left: `${xmin / 10}%`,
                              top: `${ymin / 10}%`,
                              width: `${(xmax - xmin) / 10}%`,
                              height: `${(ymax - ymin) / 10}%`,
                              background: "rgba(246, 185, 61, 0.55)",
                              outline: "2px solid rgba(182, 65, 44, 0.6)",
                            }}
                            title={s.text}
                          />
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  const cfg = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.ungraded;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ${cfg.classes}`}>
      <Icon className="h-3 w-3" strokeWidth={2} />
      {cfg.label}
    </span>
  );
}

function QuestionRow({
  question,
  mapping,
  active,
  onClick,
}: {
  question: ExtractedQuestion;
  mapping: QuestionMapping | undefined;
  active: boolean;
  onClick: () => void;
}) {
  const answered = mapping?.status === "answered";
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left px-5 py-4 flex items-start gap-3 transition-colors cursor-pointer ${
          active ? "bg-highlighter-soft" : "hover:bg-paper"
        }`}
      >
        <span
          className={`font-mono text-xs shrink-0 h-6 min-w-6 px-1.5 flex items-center justify-center rounded-full border ${
            answered ? "border-pen-green text-pen-green" : "border-pen-red text-pen-red"
          }`}
        >
          {question.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-body text-sm text-ink line-clamp-2">{question.text}</span>
          <span className="mt-1 flex items-center gap-2">
            {mapping && <VerdictPill verdict={answered ? mapping.verdict ?? "ungraded" : "ungraded"} />}
            {answered && (
              <span className="font-mono text-[11px] text-ink-soft">
                {mapping?.score ?? 0}/{mapping?.maxScore ?? 0}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
```

## `components/UploadSlot.tsx`

_Drag-and-drop upload slot component_

```tsx
"use client";

import { useRef, useState } from "react";
import { FileText, Image as ImageIcon, Check, X } from "lucide-react";

const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.webp";

export function UploadSlot({
  label,
  hint,
  file,
  onChange,
  tabColor,
}: {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  tabColor: "red" | "amber";
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tabClass = tabColor === "red" ? "bg-pen-red" : "bg-highlighter";

  return (
    <div
      className={`relative flex-1 min-w-0 rounded-sm border-2 border-dashed transition-colors ${
        dragOver ? "border-ink bg-highlighter-soft/40" : file ? "border-ink-soft/40 border-solid" : "border-rule-strong"
      } bg-paper-raised p-6 sm:p-8`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
    >
      <span
        className={`absolute -top-3 left-6 px-2.5 py-0.5 text-xs tracking-wide uppercase font-medium text-white rounded-sm ${tabClass}`}
      >
        {label}
      </span>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-3 py-6 text-center cursor-pointer group"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper border border-rule-strong group-hover:border-ink transition-colors">
            <FileText className="h-5 w-5 text-ink-soft" strokeWidth={1.5} />
          </span>
          <span className="font-body text-sm text-ink">
            Drop a file, or <span className="underline underline-offset-2">browse</span>
          </span>
          <span className="font-mono text-[11px] text-ink-soft">{hint}</span>
        </button>
      ) : (
        <div className="flex items-center gap-3 py-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pen-green-soft">
            {file.type.startsWith("image/") ? (
              <ImageIcon className="h-5 w-5 text-pen-green" strokeWidth={1.5} />
            ) : (
              <Check className="h-5 w-5 text-pen-green" strokeWidth={1.5} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-sm text-ink" title={file.name}>
              {file.name}
            </p>
            <p className="font-mono text-[11px] text-ink-soft">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Remove ${label}`}
            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full hover:bg-paper transition-colors"
          >
            <X className="h-4 w-4 text-ink-soft" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
```

## `app/layout.tsx`

_Root layout - fonts, metadata_

```tsx
import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Markbook — AI Assessment Extraction",
  description:
    "Upload a question paper and an answer sheet, and see every answer mapped, highlighted, and graded.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

## `app/globals.css`

_Design tokens / theme (paper, ink, highlighter palette)_

```css
@import "tailwindcss";

:root {
  --paper: #faf7f0;
  --paper-raised: #ffffff;
  --ink: #201c16;
  --ink-soft: #635c4f;
  --rule: #e5ddcc;
  --rule-strong: #d3c8ad;
  --highlighter: #f6b93d;
  --highlighter-soft: #fce3ab;
  --pen-red: #b6412c;
  --pen-red-soft: #f3ddd6;
  --pen-green: #2f6a4f;
  --pen-green-soft: #dbe9df;
  /* --font-display / --font-body / --font-mono are injected on <html> by next/font in layout.tsx */
}

@theme inline {
  --color-paper: var(--paper);
  --color-paper-raised: var(--paper-raised);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-rule: var(--rule);
  --color-rule-strong: var(--rule-strong);
  --color-highlighter: var(--highlighter);
  --color-highlighter-soft: var(--highlighter-soft);
  --color-pen-red: var(--pen-red);
  --color-pen-red-soft: var(--pen-red-soft);
  --color-pen-green: var(--pen-green);
  --color-pen-green-soft: var(--pen-green-soft);
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);
}

body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
  background-image:
    linear-gradient(var(--rule) 1px, transparent 1px);
  background-size: 100% 42px;
  background-attachment: local;
}

::selection {
  background: var(--highlighter-soft);
}

.no-ruled-bg {
  background-image: none;
}

@keyframes swipe-in {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}

.highlight-swipe {
  animation: swipe-in 0.35s ease-out;
}

@keyframes sparkle-float {
  0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.6; }
  50% { transform: translateY(-6px) rotate(12deg); opacity: 1; }
}

.sparkle {
  animation: sparkle-float 2.2s ease-in-out infinite;
}
```
