"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ScanJob {
  id: string;
  status: string;
  phase: string;
  statusMessage: string | null;
  totalEmails: number;
  processedEmails: number;
  excludedEmails: number;
  failedEmails: number;
  casesCreated: number;
  casesMerged: number;
  clustersCreated: number;
  completedAt: string | null;
}

interface StatusResponse {
  schemaStatus: string;
  emailCount: number;
  caseCount: number;
  actionCount: number;
  scanJob: ScanJob | null;
}

const PHASE_LABELS: Record<string, string> = {
  IDLE: "Idle",
  DISCOVERING: "Discovering emails...",
  EXTRACTING: "Extracting data from emails...",
  CLUSTERING: "Clustering emails into cases...",
  SYNTHESIZING: "Generating case summaries...",
  COMPLETED: "Pipeline complete",
  FAILED: "Pipeline failed",
};

const POLL_INTERVAL = 3000;

interface ScanProgressProps {
  schemaId: string;
  initialEmailCount: number;
  initialCaseCount: number;
}

export function ScanProgress({
  schemaId,
  initialEmailCount,
  initialCaseCount,
}: ScanProgressProps) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const supabaseModule = await import("@/lib/supabase/client");
      const supabase = supabaseModule.createBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const res = await fetch(`/api/schemas/${schemaId}/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: abortRef.current.signal,
      });

      if (!res.ok) return;

      const result: StatusResponse = await res.json();
      setData(result);

      // Stop polling if scan is done or no active job
      const phase = result.scanJob?.phase;
      if (!result.scanJob || phase === "COMPLETED" || phase === "FAILED" || result.scanJob.status === "COMPLETED" || result.scanJob.status === "FAILED") {
        setPolling(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, [schemaId]);

  // Start polling on mount, stop when done
  useEffect(() => {
    // Do an initial fetch to check if there's an active scan
    fetchStatus().then(() => setPolling(true));

    return () => {
      abortRef.current?.abort();
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (polling) {
      intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [polling, fetchStatus]);

  // Listen for scan-started custom event from ScanTrigger
  useEffect(() => {
    const handler = () => setPolling(true);
    window.addEventListener("scan-started", handler);
    return () => window.removeEventListener("scan-started", handler);
  }, []);

  const scanJob = data?.scanJob;
  const emailCount = data?.emailCount ?? initialEmailCount;
  const caseCount = data?.caseCount ?? initialCaseCount;
  const isActive = scanJob && scanJob.status === "RUNNING";
  const phase = scanJob?.phase ?? "IDLE";

  return (
    <>
      {/* Live stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Emails" value={emailCount} />
        <StatCard label="Cases" value={caseCount} highlight={caseCount > initialCaseCount} />
        <StatCard label="Clusters" value={scanJob?.clustersCreated ?? 0} />
        <StatCard label="Actions" value={data?.actionCount ?? 0} />
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="bg-white rounded-lg shadow-xs px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-primary">
              {PHASE_LABELS[phase] ?? phase}
            </span>
            {phase === "EXTRACTING" && scanJob.totalEmails > 0 && (
              <span className="text-xs text-muted">
                {scanJob.processedEmails + scanJob.excludedEmails + scanJob.failedEmails}/{scanJob.totalEmails}
              </span>
            )}
            {phase === "SYNTHESIZING" && (
              <span className="text-xs text-muted">
                {scanJob.casesCreated} cases created, {scanJob.casesMerged} merged
              </span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${getProgress(phase, scanJob)}%` }}
            />
          </div>
          {scanJob.statusMessage && (
            <p className="text-xs text-secondary">{scanJob.statusMessage}</p>
          )}
        </div>
      )}

      {/* Completed banner */}
      {scanJob?.status === "COMPLETED" && scanJob.phase === "COMPLETED" && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <p className="text-sm text-green-700 font-medium">
            Pipeline complete: {scanJob.casesCreated} cases created, {scanJob.casesMerged} merged
          </p>
          {scanJob.statusMessage && (
            <p className="text-xs text-green-600 mt-1">{scanJob.statusMessage}</p>
          )}
        </div>
      )}

      {/* Failed banner */}
      {scanJob?.status === "FAILED" && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-700 font-medium">Pipeline failed</p>
          {scanJob.statusMessage && (
            <p className="text-xs text-red-600 mt-1">{scanJob.statusMessage}</p>
          )}
        </div>
      )}
    </>
  );
}

function getProgress(phase: string, job: ScanJob): number {
  // Map pipeline phases to rough progress percentages
  switch (phase) {
    case "DISCOVERING":
      return 5;
    case "EXTRACTING": {
      const total = job.totalEmails || 1;
      const done = job.processedEmails + job.excludedEmails + job.failedEmails;
      // Extraction is 10-60% of overall progress
      return 10 + (done / total) * 50;
    }
    case "CLUSTERING":
      return 70;
    case "SYNTHESIZING":
      return 85;
    case "COMPLETED":
      return 100;
    default:
      return 0;
  }
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-xs px-4 py-3 text-center">
      <div
        className={`text-2xl font-bold ${highlight ? "text-green-600" : "text-primary"}`}
      >
        {value}
      </div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
