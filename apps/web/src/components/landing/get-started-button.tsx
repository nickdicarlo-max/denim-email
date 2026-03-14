"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Button } from "../ui/button";

type Status = "idle" | "connecting" | "error";

export function GetStartedButton() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick() {
    setStatus("connecting");
    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "https://www.googleapis.com/auth/gmail.readonly",
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

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
