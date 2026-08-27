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
