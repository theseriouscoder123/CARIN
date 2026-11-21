"use client";
import Link from "next/link";
import { useState } from "react";
import { IconServer, IconShield } from "@/components/icons";
import { EVENT_META, useAttesters, useFresh, type ActivityItem } from "@/components/lists";
import { CodeBlock, CopyButton, Card, States, Tabs, Tip, TxRef } from "@/components/ui";
import { REPO_URL } from "@/lib/config";
import { ago, short } from "@/lib/format";
import { releaseHref } from "@/lib/links";
import { indexer, usePoll } from "@/lib/use-poll";

type Filter = "all" | "AttesterCorroborated" | "DivergenceReported";

export default function AttestersPage() {
  const a = useAttesters();
  const events = usePoll<{ items: ActivityItem[] }>(() => indexer("/events?limit=100"), "attester-events", 4000);
  const [filter, setFilter] = useState<Filter>("all");
  const attesterEvents = (events.data?.items ?? []).filter((e) => e.type !== "AttestationSubmitted");
  const shown = attesterEvents.filter((e) => filter === "all" || e.type === filter);
  const fresh = useFresh(events.data?.items.map((e) => e.id));
  const d = a.data;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-nav-line bg-nav px-6 py-7 text-white md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="mb-3 inline-flex items-center gap-2 rounded border border-teal/40 bg-teal/10 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-teal uppercase">
              Quorum infrastructure
            </p>
            <h1 className="text-[28px] leading-9 font-bold tracking-tight md:text-[32px]">Independent attester nodes</h1>
            <p className="mt-2 max-w-2xl text-[15px] text-slate-300">
              Each node re-downloads every attested release from the registry, recomputes its digest and reports what it saw. The contract — not the node —
              decides whether that is a corroboration or a divergence.
            </p>
          </div>
          <div className="rounded border border-nav-line bg-nav-2 px-5 py-3 text-right">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Contract quorum rule</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-teal">{d ? `${d.threshold} of ${d.attesters.length}` : "—"}</p>
          </div>
        </div>
      </section>

      <States state={a} what="attesters" rows={3} isEmpty={(x) => x.attesters.length === 0} empty="No attesters registered in the quorum policy yet.">
        {(x) => (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {x.attesters.map((t, i) => (
              <Card key={t.address} className="overflow-hidden">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-mono text-[15px] font-semibold">
                    {t.label ?? "unlabelled"}
                    <span className="rounded bg-primary-soft px-1.5 font-mono text-[11px] font-normal text-primary">#{String(i + 1).padStart(2, "0")}</span>
                  </p>
                  {t.online ? (
                    <span className="flex items-center gap-1.5 rounded border border-ok/30 bg-ok-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ok-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-ok" /> ONLINE
                    </span>
                  ) : x.healthConfigured ? (
                    <span className="rounded border border-line-strong bg-code px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">OFFLINE</span>
                  ) : (
                    <span
                      className="rounded border border-teal/40 bg-teal/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-ink"
                      title="This node runs on a private machine and does not expose /health publicly — its on-chain activity is the evidence."
                    >
                      {t.active ? "ACTIVE ON-CHAIN" : "INACTIVE"}
                    </span>
                  )}
                </div>
                <p className="label mt-4 mb-1">Signer address</p>
                <div className="flex items-center gap-2 rounded border border-line bg-code px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={t.address}>
                    {t.address}
                  </span>
                  <CopyButton value={t.address} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded border border-line px-3 py-2">
                    <p className="text-xs text-muted">Corroborated</p>
                    <p className="text-lg font-semibold text-primary tabular-nums">
                      {t.corroborationCount} <span className="text-sm font-normal">releases</span>
                    </p>
                  </div>
                  <div className="rounded border border-line px-3 py-2">
                    <p className="text-xs text-muted">Divergences</p>
                    <p className={`text-lg font-semibold tabular-nums ${t.divergenceCount > 0 ? "text-bad" : "text-ink"}`}>
                      {t.divergenceCount} <span className="text-sm font-normal">caught</span>
                    </p>
                  </div>
                </div>
                <dl className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted">Last on-chain action</dt>
                    <dd className="font-mono">{ago(t.lastSeenAt)}</dd>
                  </div>
                  {t.health ? (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-muted">Synced to block</dt>
                        <dd className="font-mono">#{t.health.lastProcessedBlock}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted">Registry · chain</dt>
                        <dd className="font-mono">
                          {t.health.registryReachable ? "✓" : "✗"} · {t.health.chainReachable ? "✓" : "✗"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted">Uptime</dt>
                        <dd className="font-mono">{Math.round(t.health.uptimeSeconds / 60)} min</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </Card>
            ))}
          </div>
        )}
      </States>

      <Card
        flush
        title="Attester activity"
        icon={<IconServer size={16} />}
        right={
          <Tabs<Filter>
            active={filter}
            onChange={setFilter}
            tabs={[
              { key: "all", label: "All" },
              { key: "AttesterCorroborated", label: "Corroborations" },
              { key: "DivergenceReported", label: "Divergences" }
            ]}
          />
        }
      >
        <States state={events} what="activity" rows={5} isEmpty={() => shown.length === 0} empty="No attester activity in the recent window.">
          {() => (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-line bg-code/60">
                  <tr>
                    <th className="th">When</th>
                    <th className="th">Node</th>
                    <th className="th">Event</th>
                    <th className="th">Package</th>
                    <th className="th">Reported digest</th>
                    <th className="th">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((e) => {
                    const m = EVENT_META[e.type];
                    const bad = e.type === "DivergenceReported";
                    const digest = typeof e.data.observedDigest === "string" ? e.data.observedDigest : typeof e.data.artifactDigest === "string" ? e.data.artifactDigest : undefined;
                    return (
                      <tr key={e.id} className={`${bad ? "bg-bad-soft/50" : "hover:bg-hover"} ${fresh.has(e.id) ? (bad ? "flash-bad" : "flash") : ""}`}>
                        <td className="td text-xs whitespace-nowrap text-muted" title={new Date(e.timestamp).toUTCString()}>
                          {ago(e.timestamp)}
                        </td>
                        <td className="td font-mono whitespace-nowrap">
                          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${bad ? "bg-bad" : "bg-ok"}`} />
                          {e.actorLabel ?? short(e.actor)}
                        </td>
                        <td className="td">
                          <span className={`rounded border px-1.5 py-px font-mono text-[10px] font-semibold whitespace-nowrap ${m.cls}`}>{m.label}</span>
                        </td>
                        <td className="td font-mono">
                          {e.packageId ? (
                            <Link href={releaseHref(e)} className={`hover:underline ${bad ? "text-bad-ink" : "text-primary"}`}>
                              {e.name ? `${e.name}@${e.version}` : short(e.packageId)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`td font-mono text-xs ${bad ? "text-bad-ink" : "text-muted"}`}>
                          {digest ? short(digest, 6, 4) : e.type === "AttesterCorroborated" ? (e.data.quorumReached === true ? "matches · quorum" : "matches") : "—"}
                        </td>
                        <td className="td text-xs">
                          <TxRef hash={e.txHash} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </States>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="label mb-2 flex items-center gap-1.5 !text-primary">
              <IconShield size={13} /> Operators
            </p>
            <h2 className="text-xl font-semibold">Run an attester node</h2>
            <p className="mt-2 text-[14px] text-ink-2">
              A node needs an Ethereum key registered in the QuorumPolicy contract, an RPC endpoint and outbound access to the npm registry. It holds no
              state worth protecting — the chain is its memory.
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
              Attester set is admin-managed in this deployment
              <Tip>The admin can add or remove attesters but cannot alter or delete any recorded attestation. Permissionless, staked attesters are roadmap work.</Tip>
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/docs#attester" className="btn-primary">
                Node setup guide
              </Link>
              <a href={`${REPO_URL}/tree/main/apps/attester`} target="_blank" rel="noreferrer" className="btn-outline">
                Source
              </a>
            </div>
          </div>
          <CodeBlock
            title="run an attester"
            prompt
            code={`git clone ${REPO_URL}\ncd CARIN && corepack enable && pnpm install && pnpm build\n# key must be registered in QuorumPolicy\nCAIRN_ATTESTER_KEY=0x… CAIRN_RPC_URL=https://sepolia.base.org node apps/attester/dist/index.js`}
          />
        </div>
      </Card>
    </div>
  );
}
