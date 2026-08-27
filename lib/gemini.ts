import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import type { RenderedPage } from "./pdf-to-images";
import type { AnswerSegment, ExtractedQuestion, QuestionMapping } from "./types";

const MODEL = "gemini-3.6-flash";

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
