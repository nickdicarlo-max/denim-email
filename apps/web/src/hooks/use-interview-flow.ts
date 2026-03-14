"use client";
import { checkAndIncrementCallCount } from "@/lib/api-call-guard";
import type { ScanDiscovery } from "@/lib/gmail/types";
import type { HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "denim_interview_input";
const HYPOTHESIS_KEY = "denim_interview_hypothesis";

export type InterviewStep =
  | "input"
  | "gmail_connect"
  | "generating"
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

function loadSavedInput(): InterviewInput | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveInput(input: InterviewInput) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  } catch {
    // Ignore storage errors
  }
}

function clearSavedInput() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function loadSavedHypothesis(): SchemaHypothesis | null {
  try {
    const saved = sessionStorage.getItem(HYPOTHESIS_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveHypothesis(hypothesis: SchemaHypothesis) {
  try {
    sessionStorage.setItem(HYPOTHESIS_KEY, JSON.stringify(hypothesis));
  } catch {
    // Ignore storage errors
  }
}

function clearSavedHypothesis() {
  try {
    sessionStorage.removeItem(HYPOTHESIS_KEY);
  } catch {
    // Ignore storage errors
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
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

  // Use refs to avoid stale closures and prevent duplicate calls
  const authTokenRef = useRef<string | null>(null);
  const inputRef = useRef<InterviewInput | null>(null);
  const generatingRef = useRef(false);
  const finalizingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup: abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // On mount: restore saved state from sessionStorage.
  // If we have a hypothesis, skip straight to scanning.
  // If we have input, resume at gmail_connect (Card2 will detect the session).
  useEffect(() => {
    const savedHypothesis = loadSavedHypothesis();
    const savedInput = loadSavedInput();
    if (savedHypothesis) {
      setState((prev) => ({
        ...prev,
        step: "scanning",
        input: savedInput,
        hypothesis: savedHypothesis,
      }));
    } else if (savedInput) {
      inputRef.current = savedInput;
      setState((prev) => ({ ...prev, step: "gmail_connect", input: savedInput }));
    }
  }, []);

  // Card 1 → Card 2 (save input to sessionStorage, move to Gmail connect)
  const submitInput = useCallback((input: InterviewInput) => {
    inputRef.current = input;
    saveInput(input);
    setState((prev) => ({ ...prev, step: "gmail_connect", input, error: null }));
  }, []);

  // Card 2 → Generate hypothesis → Card 3 (Gmail connected, now generate hypothesis)
  const onGmailConnected = useCallback(async (authToken: string) => {
    // Guard against duplicate calls (React strict mode, effect re-runs)
    if (generatingRef.current) return;
    generatingRef.current = true;

    if (!checkAndIncrementCallCount("/api/interview/hypothesis")) {
      generatingRef.current = false;
      setState((prev) => ({
        ...prev,
        error: "Too many hypothesis requests this session. Please refresh.",
      }));
      return;
    }

    // Abort any prior in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    authTokenRef.current = authToken;
    setState((prev) => ({ ...prev, step: "generating", error: null }));

    try {
      const response = await fetch("/api/interview/hypothesis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(inputRef.current),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to generate hypothesis (${response.status})`);
      }

      const { data } = await response.json();

      // Input is no longer needed; cache hypothesis for resume
      clearSavedInput();
      saveHypothesis(data);

      setState((prev) => ({
        ...prev,
        step: "scanning",
        hypothesis: data,
      }));
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return;
      generatingRef.current = false;
      setState((prev) => ({
        ...prev,
        step: "gmail_connect",
        error: err instanceof Error ? err.message : "Failed to generate hypothesis",
      }));
    }
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
      // Guard against duplicate finalize calls
      if (finalizingRef.current) return;
      finalizingRef.current = true;

      if (!checkAndIncrementCallCount("/api/interview/finalize")) {
        finalizingRef.current = false;
        setState((prev) => ({
          ...prev,
          error: "Too many finalize requests this session. Please refresh.",
        }));
        return;
      }

      // Abort any prior in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

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
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to finalize (${response.status})`);
        }

        const { data } = await response.json();

        clearSavedInput();
        clearSavedHypothesis();
        setState((prev) => ({ ...prev, step: "complete", schemaId: data.schemaId }));
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return;
        finalizingRef.current = false;
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
    // Abort any in-flight request
    abortControllerRef.current?.abort();

    setState((prev) => {
      switch (prev.step) {
        case "gmail_connect":
          clearSavedInput();
          return { ...prev, step: "input" as const, input: null };
        case "generating":
          generatingRef.current = false;
          return { ...prev, step: "gmail_connect" as const };
        case "scanning":
          clearSavedHypothesis();
          return { ...prev, step: "gmail_connect" as const, hypothesis: null };
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
