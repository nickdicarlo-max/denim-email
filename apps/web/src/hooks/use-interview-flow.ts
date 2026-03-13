"use client";
import type { ScanDiscovery } from "@/lib/gmail/types";
import type { HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useCallback, useRef, useState } from "react";

export type InterviewStep =
  | "input"
  | "generating"
  | "gmail_connect"
  | "scanning"
  | "review"
  | "finalizing"
  | "complete";

interface InterviewInput {
  role: string;
  domain: string;
  whats: string[];
  whos: string[];
  goals: string[];
}

interface InterviewState {
  step: InterviewStep;
  input: InterviewInput | null;
  hypothesis: SchemaHypothesis | null;
  validation: HypothesisValidation | null;
  discoveries: ScanDiscovery[];
  schemaId: string | null;
  error: string | null;
}

export function useInterviewFlow() {
  const [state, setState] = useState<InterviewState>({
    step: "input",
    input: null,
    hypothesis: null,
    validation: null,
    discoveries: [],
    schemaId: null,
    error: null,
  });

  // Use a ref for authToken to avoid stale closure issues in onFinalize
  const authTokenRef = useRef<string | null>(null);

  // Card 1 → Generate hypothesis → Card 2
  const submitInput = useCallback(async (input: InterviewInput, authToken: string) => {
    authTokenRef.current = authToken;
    setState((prev) => ({ ...prev, step: "generating", input, error: null }));

    try {
      const response = await fetch("/api/interview/hypothesis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to generate hypothesis (${response.status})`);
      }

      const { data } = await response.json();

      setState((prev) => ({
        ...prev,
        step: "gmail_connect",
        hypothesis: data,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        step: "input",
        error: err instanceof Error ? err.message : "Failed to generate hypothesis",
      }));
    }
  }, []);

  // Card 2 → Card 3 (Gmail connected)
  const onGmailConnected = useCallback(() => {
    setState((prev) => ({ ...prev, step: "scanning" }));
  }, []);

  // Card 3 → Card 4 (Scan complete)
  const onScanComplete = useCallback(
    (validation: HypothesisValidation, discoveries: ScanDiscovery[]) => {
      setState((prev) => ({ ...prev, step: "review", validation, discoveries }));
    },
    [],
  );

  // Card 4 → Finalize
  const onFinalize = useCallback(
    async (confirmations: Record<string, unknown>) => {
      setState((prev) => ({ ...prev, step: "finalizing", error: null }));

      try {
        const currentAuthToken = authTokenRef.current;
        const response = await fetch("/api/interview/finalize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(currentAuthToken ? { Authorization: `Bearer ${currentAuthToken}` } : {}),
          },
          body: JSON.stringify({
            hypothesis: state.hypothesis,
            validation: state.validation,
            confirmations,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to finalize (${response.status})`);
        }

        const { data } = await response.json();

        setState((prev) => ({ ...prev, step: "complete", schemaId: data.schemaId }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          step: "review",
          error: err instanceof Error ? err.message : "Failed to finalize schema",
        }));
      }
    },
    [state.hypothesis, state.validation],
  );

  // Go back one step
  const goBack = useCallback(() => {
    setState((prev) => {
      switch (prev.step) {
        case "gmail_connect":
          return { ...prev, step: "input" as const, hypothesis: null };
        case "scanning":
          return { ...prev, step: "gmail_connect" as const };
        case "review":
          return { ...prev, step: "scanning" as const, validation: null, discoveries: [] };
        default:
          return prev;
      }
    });
  }, []);

  return {
    ...state,
    submitInput,
    onGmailConnected,
    onScanComplete,
    onFinalize,
    goBack,
  };
}
