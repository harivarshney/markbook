"use client";

import { ArrowLeft, FileText, CircleHelp, Bell, Sparkles, ChevronDown } from "lucide-react";

export function TopBar({
  breadcrumb,
  onBack,
}: {
  breadcrumb: string;
  onBack?: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-rule-strong bg-paper-raised no-ruled-bg">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 font-body text-sm text-ink-soft hover:text-ink transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        {breadcrumb}
      </button>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Help"
          className="text-ink-soft hover:text-ink transition-colors cursor-pointer"
        >
          <CircleHelp className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Notifications"
          className="relative text-ink-soft hover:text-ink transition-colors cursor-pointer"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-pen-red" />
        </button>
        <button
          type="button"
          aria-label="AI actions"
          className="text-highlighter hover:text-pen-red transition-colors cursor-pointer"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="flex items-center gap-2 pl-3 border-l border-rule-strong">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-highlighter-soft font-mono text-xs text-ink">
            DT
          </span>
          <span className="font-body text-sm text-ink hidden sm:inline">Demo Teacher</span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.75} />
        </div>
      </div>
    </header>
  );
}