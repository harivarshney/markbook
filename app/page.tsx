"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { UploadSlot } from "@/components/UploadSlot";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
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
    <AppShell>
      <TopBar breadcrumb="Exams" />
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
                Start Mapping
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <p className="mt-3 text-center font-mono text-[11px] text-ink-soft">
                Once both files are uploaded, you&apos;ll be able to map answers with questions.
              </p>
            </>
          ) : (
            <div className="mt-10 rounded-sm border border-rule-strong bg-paper-raised px-8 py-12">
              <div className="flex flex-col items-center mb-8">
                <Sparkles className="sparkle h-6 w-6 text-highlighter" strokeWidth={1.5} />
                <p className="mt-4 font-display italic text-lg text-ink">Extracting&hellip;</p>
                <p className="mt-1 font-body text-sm text-ink-soft">This may take a while</p>
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
    </AppShell>
  );
}