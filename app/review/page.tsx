"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import type { AnswerSegment, ExtractedQuestion, ProcessResult, QuestionMapping } from "@/lib/types";
import {
  CircleCheck,
  CircleX,
  CircleDashed,
  CircleMinus,
  FileWarning,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type Selection = { type: "question" | "unmatched"; id: string };

const VERDICT_STYLE: Record<string, { label: string; classes: string; icon: React.ElementType }> = {
  correct: { label: "Correct", classes: "text-pen-green bg-pen-green-soft", icon: CircleCheck },
  partial: { label: "Partial", classes: "text-highlighter bg-highlighter-soft", icon: CircleMinus },
  incorrect: { label: "Incorrect", classes: "text-pen-red bg-pen-red-soft", icon: CircleX },
  ungraded: { label: "Not attempted", classes: "text-ink-soft bg-rule/60", icon: CircleDashed },
};

// Compact score-ratio badge, colored by percentage rather than verdict alone -
// gives a quicker at-a-glance read down a long question list.
function scoreBadgeClasses(score: number, maxScore: number): string {
  if (maxScore <= 0) return "text-ink-soft bg-rule/60";
  const pct = score / maxScore;
  if (pct >= 0.8) return "text-pen-green bg-pen-green-soft";
  if (pct >= 0.4) return "text-highlighter bg-highlighter-soft";
  return "text-pen-red bg-pen-red-soft";
}

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

  return (
    <ReviewBody
      result={result}
      selection={selection}
      setSelection={setSelection}
      showUnmatched={showUnmatched}
      setShowUnmatched={setShowUnmatched}
    />
  );
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
  const [pageIndex, setPageIndex] = useState(0);

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

  // Reset the page pager whenever the selection changes, so switching
  // questions always starts back at the first relevant page. Done during
  // render (not in an effect) per React's "adjust state during render"
  // pattern, to avoid an extra render pass.
  const selectionKey = selection ? `${selection.type}:${selection.id}` : null;
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    setPageIndex(0);
  }

  const currentPage = relevantPages[Math.min(pageIndex, relevantPages.length - 1)];

  const selectedQuestion = selection?.type === "question" ? result.questions.find((q) => q.id === selection.id) : undefined;
  const selectedMapping = selectedQuestion ? mappingByQuestion.get(selectedQuestion.id) : undefined;

  const scorePercent =
    result.overall && result.overall.maxScore > 0
      ? Math.round((result.overall.totalScore / result.overall.maxScore) * 100)
      : null;

  return (
    <AppShell>
      <TopBar
        breadcrumb="Exams"
        onBack={() => {
          sessionStorage.removeItem("markbook:result");
          router.push("/");
        }}
      />
      <div className="flex-1 flex flex-col no-ruled-bg">
        {/* Header */}
        <header className="border-b border-rule-strong bg-paper-raised px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="font-display italic text-xl text-ink truncate">Markbook</h1>
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
          <aside className="lg:w-[400px] shrink-0 border-r border-rule-strong bg-paper-raised overflow-y-auto">
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
              <div className="max-w-3xl mx-auto">
                {relevantPages.length > 1 && (
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-mono text-[11px] text-ink-soft uppercase tracking-wide">
                      Answer sheet — page {currentPage?.page}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                        disabled={pageIndex === 0}
                        aria-label="Previous page"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-rule-strong text-ink-soft disabled:opacity-30 hover:border-ink hover:text-ink transition-colors cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                      <span className="font-mono text-[11px] text-ink-soft">
                        Page {pageIndex + 1} of {relevantPages.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPageIndex((i) => Math.min(relevantPages.length - 1, i + 1))}
                        disabled={pageIndex === relevantPages.length - 1}
                        aria-label="Next page"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-rule-strong text-ink-soft disabled:opacity-30 hover:border-ink hover:text-ink transition-colors cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                )}
                {relevantPages.length === 1 && (
                  <p className="font-mono text-[11px] text-ink-soft mb-2 uppercase tracking-wide">
                    Answer sheet — page {currentPage?.page}
                  </p>
                )}

                {currentPage && (
                  <div
                    className="relative w-full rounded-sm overflow-hidden border border-rule-strong bg-white shadow-sm"
                    style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentPage.dataUrl}
                      alt={`Answer sheet page ${currentPage.page}`}
                      className="w-full h-full block select-none"
                      draggable={false}
                    />
                    {relevantSegments
                      .filter((s) => s.page === currentPage.page)
                      .map((s) => {
                        const [ymin, xmin, ymax, xmax] = s.box;
                        const leftPct = xmin / 10;
                        const topPct = ymin / 10;
                        const widthPct = (xmax - xmin) / 10;
                        const heightPct = (ymax - ymin) / 10;
                        return (
                          <div key={s.id}>
                            <span
                              className="highlight-swipe absolute rounded-[2px] mix-blend-multiply"
                              style={{
                                left: `${leftPct}%`,
                                top: `${topPct}%`,
                                width: `${widthPct}%`,
                                height: `${heightPct}%`,
                                background: "rgba(246, 185, 61, 0.55)",
                                outline: "2px solid rgba(182, 65, 44, 0.6)",
                              }}
                              title={s.text}
                            />
                            {selectedQuestion && (
                              <span
                                className="absolute z-10 rounded-sm bg-pen-red px-1.5 py-0.5 font-mono text-[10px] leading-none text-white shadow-sm"
                                style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: "translateY(-100%)" }}
                              >
                                {selectedQuestion.label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
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
  const [expanded, setExpanded] = useState(false);
  const answered = mapping?.status === "answered";
  const hasFeedback = !!mapping?.feedback;

  return (
    <li>
      <div className={`transition-colors ${active ? "bg-highlighter-soft" : "hover:bg-paper"}`}>
        <button onClick={onClick} className="w-full text-left px-5 py-4 flex items-start gap-3 cursor-pointer">
          <span
            className={`font-mono text-xs shrink-0 h-6 min-w-6 px-1.5 flex items-center justify-center rounded-full border ${
              answered ? "border-pen-green text-pen-green" : "border-pen-red text-pen-red"
            }`}
          >
            {question.label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className="block font-body text-sm text-ink line-clamp-2">{question.text}</span>
              {answered && mapping && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] ${scoreBadgeClasses(
                    mapping.score ?? 0,
                    mapping.maxScore ?? 0
                  )}`}
                >
                  {mapping.score ?? 0}/{mapping.maxScore ?? 0}
                </span>
              )}
            </span>
            <span className="mt-1.5 flex items-center gap-2">
              <VerdictPill verdict={answered ? mapping?.verdict ?? "ungraded" : "ungraded"} />
            </span>
          </span>
        </button>

        {hasFeedback && (
          <div className="px-5 pb-3 pl-14">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex items-center gap-1 font-mono text-[11px] text-ink-soft hover:text-ink transition-colors cursor-pointer"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
              AI Feedback
            </button>
            {expanded && (
              <p className="mt-2 font-body text-xs text-ink-soft leading-relaxed bg-paper rounded-sm px-3 py-2 border border-rule">
                {mapping?.feedback}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}