"use client";

import type { ScanDiscovery } from "@/lib/gmail/types";
import type { HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useCallback, useRef, useState } from "react";

type ScanStatus = "idle" | "scanning" | "validating" | "complete" | "error";

interface UseScanResult {
  status: ScanStatus;
  discoveries: ScanDiscovery[];
  validation: HypothesisValidation | null;
  error: string | null;
  startScan: (hypothesis: SchemaHypothesis, authToken: string) => Promise<void>;
}

export function useInterviewScan(): UseScanResult {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [discoveries, setDiscoveries] = useState<ScanDiscovery[]>([]);
  const [validation, setValidation] = useState<HypothesisValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const startScan = useCallback(async (hypothesis: SchemaHypothesis, authToken: string) => {
    abortRef.current = false;
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
        body: JSON.stringify({ hypothesis }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Scan failed (${response.status})`);
      }

      const { data } = await response.json();

      if (abortRef.current) return;

      // Show discoveries
      setDiscoveries(data.discoveries ?? []);
      setStatus("validating");

      // Brief pause to show "validating" state before completing
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (abortRef.current) return;

      setValidation(data.validation);
      setStatus("complete");
    } catch (err) {
      if (abortRef.current) return;
      setError(err instanceof Error ? err.message : "Scan failed");
      setStatus("error");
    }
  }, []);

  return { status, discoveries, validation, error, startScan };
}
