"use client";

import { useState } from "react";
import { signInWithGmail } from "@/lib/gmail/client/oauth-config";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "../ui/button";

type Status = "idle" | "connecting" | "error";

export function GetStartedButton() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick() {
    setStatus("connecting");
    try {
      const supabase = createBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data, error } = await signInWithGmail(supabase, redirectTo);

      if (error) {
        setStatus("error");
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <Button
      variant="primary"
      fullWidth={false}
      onClick={handleClick}
      disabled={status === "connecting"}
      className="px-8"
    >
      {status === "connecting" ? "Connecting..." : "Get Started"}
    </Button>
  );
}
