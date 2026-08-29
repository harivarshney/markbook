"use client";

import {
  Sparkles,
  LayoutGrid,
  Users,
  ClipboardList,
  FileCheck2,
  BookOpen,
  Settings,
  School,
  PanelLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Home", icon: LayoutGrid },
  { label: "My Classroom", icon: Users },
  { label: "Assignments", icon: ClipboardList },
  { label: "Exams", icon: FileCheck2, active: true },
  { label: "My Library", icon: BookOpen },
];

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-rule-strong bg-paper-raised h-screen sticky top-0 no-ruled-bg">
      <div className="flex items-center justify-between gap-2 px-5 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-paper font-display italic text-sm">
            V
          </span>
          <span className="font-display italic text-lg text-ink">VedaAI</span>
        </div>
        <button
          type="button"
          aria-label="Toggle sidebar"
          className="text-ink-soft hover:text-ink transition-colors cursor-pointer"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          className="w-full flex items-center gap-2 rounded-full border border-pen-red/40 bg-pen-red-soft px-3.5 py-2 text-pen-red font-body text-sm font-medium"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          AI Teacher&apos;s Toolkit
        </button>
      </div>

      <nav className="flex-1 px-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-sm transition-colors cursor-pointer ${
                    item.active
                      ? "bg-highlighter-soft text-ink font-medium"
                      : "text-ink-soft hover:bg-paper hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 pb-4 space-y-2">
        <button
          type="button"
          className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 font-body text-sm text-ink-soft hover:bg-paper hover:text-ink transition-colors cursor-pointer"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
          Settings
        </button>
        <div className="flex items-center gap-2.5 rounded-md border border-rule-strong bg-paper px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-highlighter-soft">
            <School className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="font-body text-xs text-ink truncate">Demo Academy</p>
            <p className="font-mono text-[10px] text-ink-soft truncate">Assessment Workspace</p>
          </div>
        </div>
      </div>
    </aside>
  );
}