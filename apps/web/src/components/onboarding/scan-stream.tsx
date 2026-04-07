"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const PHASE_LABELS: Record<string, string> = {
  IDLE: "Preparing...",
  DISCOVERING: "Finding emails...",
  EXTRACTING: "Reading content...",
  CLUSTERING: "Grouping into cases...",
  SYNTHESIZING: "Creating summaries...",
  COMPLETED: "Done!",
  FAILED: "Something went wrong",
};

const PHASE_FALLBACK_PROGRESS: Record<string, number> = {
  IDLE: 5,
  DISCOVERING: 20,
  EXTRACTING: 50,
  CLUSTERING: 75,
  SYNTHESIZING: 90,
};

interface StatusResponse {
  phase: string;
  totalEmails: number;
  processedEmails: number;
  newEmails: number;
  status: string;
  recentDiscoveries?: {
    entities?: string[];
  };
}

interface ScanStreamProps {
  schemaId: string;
  onComplete: () => void;
}

export function ScanStream({ schemaId, onComplete }: ScanStreamProps) {
  const [phase, setPhase] = useState("IDLE");
  const [totalEmails, setTotalEmails] = useState(0);
  const [processedEmails, setProcessedEmails] = useState(0);
  const [newEmails, setNewEmails] = useState(0);
  const [entities, setEntities] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const supabase = createBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/schemas/${schemaId}/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const data: StatusResponse = await res.json();
      setPhase(data.phase ?? data.status ?? "IDLE");
      setTotalEmails(data.totalEmails ?? 0);
      setProcessedEmails(data.processedEmails ?? 0);
      setNewEmails(data.newEmails ?? 0);

      if (data.recentDiscoveries?.entities) {
        setEntities((prev) => {
          const combined = [...prev];
          for (const e of data.recentDiscoveries?.entities ?? []) {
            if (!combined.includes(e)) combined.push(e);
          }
          return combined;
        });
      }

      const status = data.status ?? data.phase;
      if (status === "COMPLETED" && !completedRef.current) {
        completedRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setTimeout(onComplete, 1000);
      }
    } catch {
      // Silently retry on next interval
    }
  }, [schemaId, onComplete]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [poll]);

  const progressPercent = (() => {
    if (phase === "COMPLETED") return 100;
    if (totalEmails > 0 && processedEmails > 0) {
      return Math.min(95, Math.round((processedEmails / totalEmails) * 100));
    }
    return PHASE_FALLBACK_PROGRESS[phase] ?? 5;
  })();

  const visibleEntities = entities.slice(0, 15);

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {/* Progress bar */}
      <div className="w-full h-2 bg-surface-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Phase label */}
      <p className="text-sm text-secondary">{PHASE_LABELS[phase] ?? "Working..."}</p>

      {/* Email counter */}
      {newEmails > 0 && (
        <p className="text-2xl font-bold text-primary">
          Found {newEmails} relevant email{newEmails !== 1 ? "s" : ""}
        </p>
      )}

      {/* Streaming entity discoveries */}
      {visibleEntities.length > 0 && (
        <div className="flex w-full flex-col gap-1">
          {visibleEntities.map((entity, i) => (
            <p
              key={entity}
              className="animate-fadeIn text-sm text-secondary"
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }}
            >
              <span className="text-accent mr-2">&rarr;</span>
              {entity}
            </p>
          ))}
        </div>
      )}

      {/* Bottom hint */}
      <p className="text-xs text-muted mt-4">This usually takes about a minute</p>
    </div>
  );
}
