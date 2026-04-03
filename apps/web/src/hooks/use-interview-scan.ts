"use client";

import { checkAndIncrementCallCount } from "@/lib/api-call-guard";
import type { ScanDiscovery } from "@/lib/gmail/types";
import type { EntityGroupContext } from "@denim/ai";
import type { HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useCallback, useState } from "react";

type ScanStatus = "idle" | "scanning" | "validating" | "complete" | "error";

// Module-level flag survives component remounts — prevents duplicate
// validate calls when the user navigates away and back to Card3.
let scanInFlight = false;
// Module-level abort controller so cleanup works across remounts.
let moduleAbortController: AbortController | null = null;

interface UseScanResult {
  status: ScanStatus;
  discoveries: ScanDiscovery[];
  validation: HypothesisValidation | null;
  error: string | null;
  startScan: (hypothesis: SchemaHypothesis, authToken: string, entityGroups?: EntityGroupContext[]) => Promise<void>;
  abort: () => void;
}

export function useInterviewScan(): UseScanResult {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [discoveries, setDiscoveries] = useState<ScanDiscovery[]>([]);
  const [validation, setValidation] = useState<HypothesisValidation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abort = useCallback(() => {
    moduleAbortController?.abort();
    scanInFlight = false;
  }, []);

  const startScan = useCallback(async (hypothesis: SchemaHypothesis, authToken: string, entityGroups?: EntityGroupContext[]) => {
    // Module-level guard: if a scan is already in flight (even from a
    // prior mount), skip. The server-side Claude call can't be cancelled
    // so firing a second request just wastes tokens.
    if (scanInFlight) return;
    scanInFlight = true;

    // Abort any prior fetch (belt-and-suspenders with the flag above)
    moduleAbortController?.abort();
    const controller = new AbortController();
    moduleAbortController = controller;

    if (!checkAndIncrementCallCount("/api/interview/validate")) {
      setError("Too many scan requests this session. Please refresh.");
      setStatus("error");
      scanInFlight = false;
      return;
    }

    setStatus("scanning");
    setDiscoveries([]);
    setValidation(null);
    setError(null);

    try {
      // Call the validate endpoint which does scan + validation in one call
      const response = await fetch("/api/interview/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ hypothesis, entityGroups }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Scan failed (${response.status})`);
      }

      const { data } = await response.json();

      // Show discoveries
      setDiscoveries(data.discoveries ?? []);
      setStatus("validating");

      // Brief pause to show "validating" state before completing
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (controller.signal.aborted) return;

      setValidation(data.validation);
      setStatus("complete");
      scanInFlight = false;
    } catch (err) {
      if ((err instanceof DOMException && err.name === "AbortError") || controller.signal.aborted) {
        scanInFlight = false;
        return;
      }
      setError(err instanceof Error ? err.message : "Scan failed");
      setStatus("error");
      scanInFlight = false;
    }
  }, []);

  return { status, discoveries, validation, error, startScan, abort };
}
