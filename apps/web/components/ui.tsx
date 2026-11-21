"use client";
import { useState, type ReactNode } from "react";
import { EXPLORER_URL } from "@/lib/config";
import { short } from "@/lib/format";
import { IconAlert, IconCheck, IconClock, IconCopy, IconExternal, IconHelp, IconX } from "./icons";

export type BadgeStatus = "VERIFIED" | "PENDING" | "DIVERGENT" | "UNATTESTED" | "CONTESTED";

const BADGE: Record<BadgeStatus, { icon: ReactNode; cls: string; tip: string }> = {
  VERIFIED: { icon: <IconCheck size={12} strokeWidth={3} />, cls: "bg-ok-soft text-ok-ink border-ok/30", tip: "Attested and confirmed by a quorum of independent attesters" },
  PENDING: { icon: <IconClock size={12} strokeWidth={2.5} />, cls: "bg-warn-soft text-warn-ink border-warn/30", tip: "Attested, waiting for independent attesters to reach quorum" },
  DIVERGENT: { icon: <IconX size={12} strokeWidth={3} />, cls: "bg-bad text-white border-bad", tip: "An attester observed different bytes than were attested — quorum revoked" },
  CONTESTED: { icon: <IconAlert size={12} strokeWidth={2.5} />, cls: "bg-bad-soft text-bad-ink border-bad/40", tip: "Divergence reports exist for this version" },
  UNATTESTED: { icon: <span className="font-bold">?</span>, cls: "bg-code text-muted border-line-strong", tip: "No attestation exists for this exact version" }
};

/** Status is icon + text + colour — never colour alone. */
export function StatusBadge({ status, detail, size = "md" }: { status: BadgeStatus; detail?: string; size?: "sm" | "md" | "lg" }) {
  const b = BADGE[status];
  const sz = size === "lg" ? "px-3 py-1.5 text-sm" : size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span title={b.tip} className={`inline-flex items-center gap-1.5 rounded border font-mono font-semibold tracking-wide whitespace-nowrap ${b.cls} ${sz}`}>
      {b.icon}
      {status}
      {detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </span>
  );
}

/** Small "?" with a hover / focus tooltip — explanations live here, not in paragraphs. */
export function Tip({ children, className = "", align = "center" }: { children: ReactNode; className?: string; align?: "center" | "right" }) {
  const pos = align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <span className={`group/tip relative inline-flex align-middle ${className}`}>
      <button type="button" aria-label="More information" className="text-muted/70 hover:text-primary focus:text-primary">
        <IconHelp size={14} />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-50 mb-2 hidden w-64 rounded bg-nav px-3 py-2 text-left text-xs leading-relaxed font-normal tracking-normal text-white normal-case shadow-pop group-hover/tip:block group-focus-within/tip:block ${pos}`}
      >
        {children}
      </span>
    </span>
  );
}

function useCopy(): [boolean, (v: string) => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    (v: string) => {
      void navigator.clipboard?.writeText(v).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    }
  ];
}

export function CopyButton({ value, className = "", label }: { value: string; className?: string; label?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" onClick={() => copy(value)} title={copied ? "Copied" : "Copy"} className={`inline-flex items-center gap-1 text-muted hover:text-primary ${className}`}>
      {copied ? <IconCheck size={14} className="text-ok" /> : <IconCopy size={14} />}
      {label ? <span className="text-xs">{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

/** Monospace digest, truncated, full value on hover, click to copy. */
export function Digest({ value, full = false, className = "" }: { value: string | undefined | null; full?: boolean; className?: string }) {
  const [copied, copy] = useCopy();
  if (!value) return <span className="font-mono text-muted">—</span>;
  return (
    <button type="button" title={value} onClick={() => copy(value)} className={`inline-flex items-center gap-1.5 text-left font-mono break-all hover:text-primary ${className}`}>
      <span>{full ? value : short(value, 6, 4)}</span>
      {copied ? <IconCheck size={12} className="shrink-0 text-ok" /> : null}
    </button>
  );
}

/** A digest in a code-surface pill, as in the registry designs. */
export function HashPill({ value, tone = "default" }: { value: string | undefined | null; tone?: "default" | "ok" | "bad" }) {
  const t = tone === "bad" ? "bg-bad-soft text-bad-ink border-bad/30" : tone === "ok" ? "bg-ok-soft text-ok-ink border-ok/20" : "bg-code text-ink-2 border-line";
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs ${t}`}>
      <Digest value={value} />
    </span>
  );
}

export function TxRef({ hash, className = "" }: { hash: string; className?: string }) {
  if (EXPLORER_URL) {
    return (
      <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-mono text-primary hover:underline ${className}`} title={hash}>
        {short(hash)}
        <IconExternal size={11} />
      </a>
    );
  }
  return <Digest value={hash} className={className} />;
}

/** Code box: dark terminal or light inline surface, with copy. */
export function CodeBlock({ code, title, dark = true, prompt = false }: { code: string; title?: ReactNode; dark?: boolean; prompt?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-lg border ${dark ? "border-nav-line bg-nav text-slate-100" : "border-line bg-code text-ink"}`}>
      {title ? (
        <div className={`flex items-center justify-between border-b px-4 py-2 text-xs ${dark ? "border-nav-line text-slate-400" : "border-line text-muted"}`}>
          <span className="font-mono">{title}</span>
          <CopyButton value={code} label="Copy" className={dark ? "text-slate-400 hover:text-white" : ""} />
        </div>
      ) : null}
      <div className="relative">
        <pre className="overflow-x-auto p-4 pr-12 font-mono text-[13px] leading-relaxed">
          {prompt
            ? code.split("\n").map((l, i) => (
                <span key={i} className="block">
                  {l.startsWith("#") ? (
                    <span className={dark ? "text-slate-500" : "text-muted"}>{l}</span>
                  ) : (
                    <>
                      <span className={dark ? "text-teal" : "text-primary"}>$ </span>
                      {l}
                    </>
                  )}
                </span>
              ))
            : code}
        </pre>
        {title ? null : <CopyButton value={code} className={`absolute top-3 right-3 ${dark ? "text-slate-400 hover:text-white" : ""}`} />}
      </div>
    </div>
  );
}

export function Card({
  title,
  children,
  right,
  className = "",
  flush = false,
  icon
}: {
  title?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
  /** No body padding — for tables and lists that run edge to edge. */
  flush?: boolean;
  icon?: ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-line bg-card ${className}`}>
      {title || right ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title ? (
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              {icon ? <span className="text-primary">{icon}</span> : null}
              {title}
            </h2>
          ) : (
            <span />
          )}
          {right}
        </div>
      ) : null}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-1" aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-code" />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="m-4 rounded border border-dashed border-line-strong p-6 text-center text-muted">{children}</div>;
}

export function ErrorBox({ what, error, hint }: { what: string; error: string; hint?: ReactNode }) {
  return (
    <div className="m-1 rounded border border-bad/30 bg-bad-soft p-4 text-bad-ink">
      <p className="flex items-center gap-2 font-semibold">
        <IconAlert size={16} /> Could not load {what}
      </p>
      <p className="mt-1 font-mono text-xs break-all">{error}</p>
      {hint ? <p className="mt-2 text-sm text-ink-2">{hint}</p> : null}
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
    if (state.error) return <ErrorBox what={what} error={state.error} hint="The indexer may be waking up — this retries automatically." />;
    return <Skeleton rows={rows} />;
  }
  if (isEmpty?.(state.data)) return <Empty>{empty}</Empty>;
  return (
    <>
      {state.error ? (
        <p className="flex items-center gap-1.5 px-4 py-2 text-xs text-warn-ink" title={state.error}>
          <IconAlert size={12} /> Showing last good data — refresh failed
        </p>
      ) : null}
      {children(state.data)}
    </>
  );
}

/** Page title block used across pages (crumbs, title, optional right side). */
export function PageHeader({ crumbs, title, sub, right }: { crumbs?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs ? <div className="mb-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted">{crumbs}</div> : null}
        <h1 className="text-[28px] leading-9 font-bold tracking-tight text-ink md:text-[32px] md:leading-10">{title}</h1>
        {sub ? <p className="mt-1.5 max-w-3xl text-[15px] text-ink-2">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Underlined flat tabs (2px primary underline on the active one). */
export function Tabs<K extends string>({ tabs, active, onChange }: { tabs: { key: K; label: ReactNode; count?: number }[]; active: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="scrollbar-none flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap ${
            active === t.key ? "border-primary font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
          {t.count !== undefined ? <span className="rounded bg-primary-soft px-1.5 font-mono text-[11px] text-primary">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Label / value metric tile. */
export function Metric({ label, value, tone, tip, sub }: { label: string; value: ReactNode; tone?: string; tip?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <p className="label flex items-center gap-1.5">
        {label}
        {tip ? <Tip>{tip}</Tip> : null}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? "text-ink"}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}
