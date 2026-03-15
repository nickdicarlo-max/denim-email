"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "../ui/button";

interface ScanTriggerProps {
  schemaId: string;
}

type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; emailCount: number; scanJobId: string }
  | { status: "error"; message: string };

export function ScanTrigger({ schemaId }: ScanTriggerProps) {
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const triggerRef = useRef(false);

  const handleTrigger = useCallback(async () => {
    if (triggerRef.current) return;
    triggerRef.current = true;
    setState({ status: "loading" });

    try {
      const supabaseModule = await import("@/lib/supabase/client");
      const supabase = supabaseModule.createBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setState({ status: "error", message: "Not authenticated. Please sign in again." });
        return;
      }

      const res = await fetch("/api/extraction/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ schemaId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data?.error ?? `Scan failed (${res.status})`;
        setState({ status: "error", message });
        return;
      }

      const data = await res.json();
      setState({
        status: "success",
        emailCount: data.emailCount,
        scanJobId: data.scanJobId,
      });

      // Notify polling component to start
      window.dispatchEvent(new CustomEvent("scan-started"));
    } catch {
      setState({ status: "error", message: "Network error. Please try again." });
      triggerRef.current = false; // Only reset on error so user can retry
    }
  }, [schemaId]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        fullWidth={false}
        onClick={handleTrigger}
        disabled={state.status === "loading" || state.status === "success"}
        className="px-6"
      >
        {state.status === "loading" ? "Scanning..." : "Scan Emails"}
      </Button>

      {state.status === "success" && (
        <p className="text-sm text-green-600">
          Scan started: {state.emailCount} emails found
        </p>
      )}

      {state.status === "error" && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
    </div>
  );
}
