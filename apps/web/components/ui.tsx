"use client";
import { useState, type ReactNode } from "react";
import { EXPLORER_URL } from "@/lib/config";
import { short } from "@/lib/format";

type BadgeStatus = "VERIFIED" | "PENDING" | "DIVERGENT" | "UNATTESTED" | "CONTESTED";

const BADGE: Record<BadgeStatus, { glyph: string; cls: string; label: string }> = {
  VERIFIED: { glyph: "✓", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40", label: "VERIFIED" },
  PENDING: { glyph: "◷", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/40", label: "PENDING" },
  DIVERGENT: { glyph: "✗", cls: "bg-red-600/25 text-red-200 ring-red-500/70", label: "DIVERGENT" },
  CONTESTED: { glyph: "✗", cls: "bg-red-600/25 text-red-200 ring-red-500/70", label: "CONTESTED" },
  UNATTESTED: { glyph: "?", cls: "bg-neutral-500/15 text-neutral-300 ring-neutral-500/40", label: "UNATTESTED" }
};

/** Status is glyph + text + colour — never colour alone (projector, colour-blind judges). */
export function StatusBadge({ status, detail, size = "md" }: { status: BadgeStatus; detail?: string; size?: "md" | "lg" }) {
  const b = BADGE[status];
  const sz = size === "lg" ? "px-4 py-2 text-2xl" : "px-2.5 py-1 text-sm";
  return (
    <span className={`inline-flex items-center gap-2 rounded-md font-semibold tracking-wide ring-1 ${b.cls} ${sz}`}>
      <span aria-hidden>{b.glyph}</span>
      {b.label}
      {detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </span>
  );
}

/** Monospace digest, truncated, full value on hover, click to copy. */
export function Digest({ value, full = false, className = "" }: { value: string | undefined | null; full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="font-mono text-neutral-500">—</span>;
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={`font-mono break-all text-left hover:text-white ${className}`}
    >
      {full ? value : short(value, 6, 4)}
      {copied ? <span className="ml-2 text-xs text-emerald-400">copied</span> : null}
    </button>
  );
}

export function TxRef({ hash }: { hash: string }) {
  if (EXPLORER_URL) {
    return (
      <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" className="font-mono text-sky-300 hover:underline" title={hash}>
        {short(hash)}
      </a>
    );
  }
  return <Digest value={hash} />;
}

export function Card({ title, children, right, className = "" }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 ${className}`}>
      {title || right ? (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title ? <h2 className="text-lg font-semibold text-neutral-200">{title}</h2> : <span />}
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-800/70" />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-neutral-700 p-6 text-center text-neutral-400">{children}</div>;
}

export function ErrorBox({ what, error, hint }: { what: string; error: string; hint?: ReactNode }) {
  return (
    <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-200">
      <p className="font-semibold">Could not load {what}</p>
      <p className="mt-1 text-sm text-red-300/90">{error}</p>
      {hint ? <p className="mt-2 text-sm text-neutral-300">{hint}</p> : null}
    </div>
  );
}

/** Render one of loading / error / empty / populated for a polled source. */
export function States<T>({
  state,
  what,
  isEmpty,
  empty,
  children,
  rows
}: {
  state: { data: T | undefined; error: string | undefined; loading: boolean };
  what: string;
  isEmpty?: (d: T) => boolean;
  empty?: ReactNode;
  children: (d: T) => ReactNode;
  rows?: number;
}) {
  if (state.data === undefined) {
    if (state.error) return <ErrorBox what={what} error={state.error} hint="Is the indexer running? Start the stack with the commands in docs/DEMO-RUNBOOK.md." />;
    return <Skeleton rows={rows} />;
  }
  if (isEmpty?.(state.data)) return <Empty>{empty}</Empty>;
  return (
    <>
      {state.error ? <p className="mb-2 text-sm text-amber-300">⚠ showing last good data — latest refresh failed: {state.error}</p> : null}
      {children(state.data)}
    </>
  );
}
