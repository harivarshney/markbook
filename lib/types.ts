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
