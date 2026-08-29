"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Check, X } from "lucide-react";
import { estimatePdfPageCount } from "@/lib/pdf-page-count";

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
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the displayed page count as soon as the file identity changes,
  // during render rather than in an effect (avoids an extra render pass).
  if (file !== lastFile) {
    setLastFile(file);
    setPageCount(null);
  }

  useEffect(() => {
    let cancelled = false;
    if (file && file.type === "application/pdf") {
      file.arrayBuffer().then((buf) => {
        if (!cancelled) setPageCount(estimatePdfPageCount(buf));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [file]);

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
            <p className="font-mono text-[11px] text-ink-soft">
              {(file.size / 1024).toFixed(0)} KB
              {pageCount !== null ? ` · ${pageCount} page${pageCount === 1 ? "" : "s"}` : ""}
            </p>
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