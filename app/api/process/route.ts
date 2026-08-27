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
