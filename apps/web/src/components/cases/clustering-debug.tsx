"use client";

import { useState } from "react";
import type { EmailWithAssignment } from "./email-list";

interface ClusteringDebugProps {
  emails: EmailWithAssignment[];
  clusterRecords?: ClusterRecord[];
}

interface ClusterRecord {
  action: "MERGE" | "CREATE";
  emailIds: string[];
  score: number | null;
  primaryTag: string | null;
  scoreBreakdown: {
    threadScore?: number;
    tagScore?: number;
    subjectScore?: number;
    actorScore?: number;
    caseSizeBonus?: number;
    timeDecayMultiplier?: number;
    rawScore?: number;
    finalScore?: number;
  } | null;
}

export function ClusteringDebug({ emails, clusterRecords }: ClusteringDebugProps) {
  const [open, setOpen] = useState(false);

  const emailsWithScores = emails.filter((e) => e.clusteringScore != null || e.assignedBy);

  if (emailsWithScores.length === 0) return null;

  // Build lookup of cluster info per email
  const emailClusterMap = new Map<string, ClusterRecord>();
  if (clusterRecords) {
    for (const cluster of clusterRecords) {
      const emailIds = Array.isArray(cluster.emailIds) ? (cluster.emailIds as string[]) : [];
      for (const eid of emailIds) {
        emailClusterMap.set(eid, cluster);
      }
    }
  }

  return (
    <section className="bg-white rounded-lg shadow p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-semibold text-secondary uppercase tracking-wide w-full"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        Clustering Debug
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {emailsWithScores.map((email) => {
            const cluster = emailClusterMap.get(email.id);
            const breakdown = cluster?.scoreBreakdown;
            const routingDecision = (email as any).routingDecision as {
              method?: string;
              detail?: string;
              relevanceScore?: number;
            } | null;

            return (
              <div
                key={email.id}
                className="text-xs text-secondary border-b border-border pb-2 last:border-0"
              >
                <div className="flex items-center gap-2">
                  {/* MERGE/CREATE badge */}
                  {cluster && (
                    <span
                      className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                        cluster.action === "MERGE"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {cluster.action}
                    </span>
                  )}
                  <span className="truncate flex-1 min-w-0">{email.subject}</span>
                  {email.clusteringScore != null && (
                    <span className="font-mono text-muted whitespace-nowrap">
                      score: {email.clusteringScore.toFixed(1)}
                    </span>
                  )}
                </div>

                {/* Route method + relevance */}
                {routingDecision && (
                  <div className="mt-1 ml-12 text-[11px] text-muted">
                    {routingDecision.method && <span>route: {routingDecision.method}</span>}
                    {routingDecision.relevanceScore != null && (
                      <span className="ml-2">
                        relevance: {routingDecision.relevanceScore.toFixed(2)}
                      </span>
                    )}
                    {routingDecision.detail && (
                      <div className="text-[10px] italic truncate">{routingDecision.detail}</div>
                    )}
                  </div>
                )}

                {/* Score breakdown for MERGE */}
                {breakdown && cluster?.action === "MERGE" && (
                  <div className="mt-1 ml-12 font-mono text-[10px] text-muted flex flex-wrap gap-x-3">
                    {breakdown.threadScore != null && <span>thread:{breakdown.threadScore}</span>}
                    {breakdown.tagScore != null && <span>tag:{breakdown.tagScore}</span>}
                    {breakdown.subjectScore != null && <span>subj:{breakdown.subjectScore}</span>}
                    {breakdown.actorScore != null && <span>actor:{breakdown.actorScore}</span>}
                    {breakdown.caseSizeBonus != null && <span>size:{breakdown.caseSizeBonus}</span>}
                    {breakdown.timeDecayMultiplier != null && (
                      <span>decay:{breakdown.timeDecayMultiplier.toFixed(2)}</span>
                    )}
                  </div>
                )}

                {/* CREATE explanation */}
                {cluster?.action === "CREATE" && (
                  <div className="mt-1 ml-12 text-[10px] text-muted italic">
                    Created new case — no merge target above threshold
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
