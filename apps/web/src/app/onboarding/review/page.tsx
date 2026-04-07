"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { type EntityData, ReviewEntities } from "@/components/onboarding/review-entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { onboardingStorage } from "@/lib/onboarding-storage";
import { createBrowserClient } from "@/lib/supabase/client";

type PageStatus = "loading" | "ready" | "finalizing" | "error";

export default function ReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fetchCalledRef = useRef(false);

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [entities, setEntities] = useState<EntityData[]>([]);
  const [topicName, setTopicName] = useState("");
  const [userThings, setUserThings] = useState<string[]>([]);
  const [schemaId, setSchemaId] = useState<string | null>(null);

  // On mount: validate prerequisites and fetch schema data.
  // Prefer ?schemaId=... from the URL (deep-linkable) and fall back to
  // sessionStorage so refreshes mid-flow still resolve. If neither exists,
  // bounce back to the start of onboarding.
  useEffect(() => {
    const urlId = searchParams.get("schemaId");
    const storedId = onboardingStorage.getSchemaId();
    const id = urlId ?? storedId;
    if (!id) {
      router.replace("/onboarding/category");
      return;
    }
    if (urlId && urlId !== storedId) {
      onboardingStorage.setSchemaId(urlId);
    }
    setSchemaId(id);

    const names = onboardingStorage.getNames();
    setUserThings(names?.whats ?? []);

    if (fetchCalledRef.current) return;
    fetchCalledRef.current = true;

    const supabase = createBrowserClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!session) throw new Error("No session found");

        return fetch(`/api/schemas/${id}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
      })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load schema (${res.status})`);
        return res.json();
      })
      .then((json: { data: { name: string; entities: Array<RawEntity> } }) => {
        setTopicName(json.data.name);

        const mapped: EntityData[] = json.data.entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type as "PRIMARY" | "SECONDARY",
          autoDetected: e.autoDetected,
          emailCount: e.emailCount,
          aliases: parseAliases(e.aliases),
          isActive: e.isActive,
        }));
        setEntities(mapped);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        fetchCalledRef.current = false;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to load data");
      });
  }, [router, searchParams]);

  const handleToggleEntity = useCallback((entityId: string, active: boolean) => {
    setEntities((prev) => prev.map((e) => (e.id === entityId ? { ...e, isActive: active } : e)));
  }, []);

  const handleFinalize = useCallback(async () => {
    if (!schemaId) return;
    setStatus("finalizing");
    setErrorMessage("");

    try {
      const supabase = createBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("No session found");

      const entityToggles = entities.map((e) => ({ id: e.id, isActive: e.isActive }));

      const res = await fetch("/api/interview/review-finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ schemaId, topicName, entityToggles }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Finalize failed (${res.status})`);
      }

      onboardingStorage.clearAll();
      // Land on the single-topic feed for the schema the user just confirmed.
      // FeedClient hydrates `activeSchemaId` from the `?schema=` query param.
      router.push(`/feed?schema=${schemaId}`);
    } catch (err: unknown) {
      setStatus("ready");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [schemaId, topicName, entities, router]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center px-4 py-8">
        <OnboardingProgress currentStep={4} totalSteps={5} />
        <div className="flex flex-1 flex-col items-center justify-center">
          <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
            progress_activity
          </span>
        </div>
      </div>
    );
  }

  // Error state (failed to load schema)
  if (status === "error" && entities.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center px-4 py-8">
        <OnboardingProgress currentStep={4} totalSteps={5} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <span className="material-symbols-outlined text-[40px] text-overdue">error</span>
          <p className="text-primary font-medium text-center">{errorMessage}</p>
          <Button
            onClick={() => {
              setStatus("loading");
              fetchCalledRef.current = false;
              // Re-trigger the useEffect by forcing a re-render
              setEntities([]);
            }}
            fullWidth={false}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={4} totalSteps={5} />

      <div className="w-full max-w-2xl mx-auto mt-8">
        <h1 className="font-serif text-2xl text-primary">Here&apos;s what we found</h1>
        <p className="text-muted text-sm mt-1">Confirm what looks right. Tap to change.</p>

        <div className="mt-6">
          <ReviewEntities
            userThings={userThings}
            entities={entities}
            onToggleEntity={handleToggleEntity}
          />
        </div>

        {/* Topic name */}
        <div className="mt-8">
          <label htmlFor="topic-name" className="block text-sm font-medium text-primary mb-2">
            Name this topic
          </label>
          <Input
            id="topic-name"
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
            placeholder="e.g. My Projects"
          />
        </div>

        {/* Error from finalize */}
        {errorMessage && status === "ready" && (
          <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
        )}

        {/* CTA */}
        <div className="mt-8">
          <Button onClick={handleFinalize} disabled={status === "finalizing" || !topicName.trim()}>
            {status === "finalizing" ? "Setting up..." : "Show me my cases!"}
          </Button>
        </div>

        <p className="text-sm text-muted text-center mt-8">Step 5 of 5</p>
      </div>
    </div>
  );
}

/** Parse aliases from DB JSON field (could be string or array). */
function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Shape of entity from the API response (before mapping). */
interface RawEntity {
  id: string;
  name: string;
  type: string;
  autoDetected: boolean;
  emailCount: number;
  aliases: unknown;
  isActive: boolean;
}
