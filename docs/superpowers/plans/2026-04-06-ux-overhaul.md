# UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rearchitect Denim's frontend from a developer dashboard into a mobile-first product with 5-step onboarding, cross-topic case feed, and persistent bottom navigation.

**Architecture:** New route structure under `/onboarding/*`, `/feed`, `/settings`. Backend pipeline and Prisma schema untouched. Design system already updated to Digital Curator tokens (Noto Serif + Plus Jakarta Sans, caramel palette). All filtering is client-side for instant switching.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, Supabase Auth, Prisma, Material Symbols Outlined icons.

**Design Spec:** `docs/superpowers/specs/2026-04-06-ux-overhaul-design.md`
**Product Spec:** `docs/stitch-design-specs.md`
**GitHub Issues:** #8 (Wave 1), #9 (Wave 2), #10 (Wave 3), #11 (parent)

---

## Wave 1: Onboarding (GitHub Issue #8)

### Task 1: Onboarding SessionStorage Helper

**Files:**
- Create: `apps/web/src/lib/onboarding-storage.ts`

- [ ] **Step 1: Create onboarding storage module**

```typescript
// apps/web/src/lib/onboarding-storage.ts

const KEYS = {
  category: "denim_onboarding_category",
  names: "denim_onboarding_names",
  schemaId: "denim_onboarding_schemaId",
} as const;

export interface OnboardingCategory {
  role: string;
  domain: string;
  customDescription?: string;
}

export interface OnboardingNames {
  whats: string[];
  whos: string[];
}

function get<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

function set(key: string, value: unknown): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}

export const onboardingStorage = {
  getCategory: () => get<OnboardingCategory>(KEYS.category),
  setCategory: (data: OnboardingCategory) => set(KEYS.category, data),

  getNames: () => get<OnboardingNames>(KEYS.names),
  setNames: (data: OnboardingNames) => set(KEYS.names, data),

  getSchemaId: () => get<string>(KEYS.schemaId),
  setSchemaId: (id: string) => set(KEYS.schemaId, id),

  clearAll: () => {
    sessionStorage.removeItem(KEYS.category);
    sessionStorage.removeItem(KEYS.names);
    sessionStorage.removeItem(KEYS.schemaId);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/onboarding-storage.ts
git commit -m "feat(onboarding): add sessionStorage helper for multi-route state"
```

---

### Task 2: Onboarding Layout + Progress Component

**Files:**
- Create: `apps/web/src/app/onboarding/layout.tsx`
- Create: `apps/web/src/components/onboarding/progress.tsx`

- [ ] **Step 1: Create onboarding progress component**

```typescript
// apps/web/src/components/onboarding/progress.tsx
"use client";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export function OnboardingProgress({ currentStep, totalSteps }: OnboardingProgressProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={[
            "h-1.5 rounded-full transition-all",
            i === currentStep ? "w-8 bg-accent" : "w-2 bg-surface-highest",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create onboarding layout**

```typescript
// apps/web/src/app/onboarding/layout.tsx
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/onboarding/layout.tsx apps/web/src/components/onboarding/progress.tsx
git commit -m "feat(onboarding): add layout and progress indicator component"
```

---

### Task 3: O1 — Pick a Category Page

**Files:**
- Create: `apps/web/src/app/onboarding/category/page.tsx`
- Modify: `apps/web/src/components/interview/domain-config.ts` (already has materialIcon + description from earlier work)

- [ ] **Step 1: Create the category page**

```typescript
// apps/web/src/app/onboarding/category/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { ROLE_OPTIONS } from "@/components/interview/domain-config";
import { onboardingStorage } from "@/lib/onboarding-storage";

export default function CategoryPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [customDescription, setCustomDescription] = useState("");

  const selectedRole = selected
    ? ROLE_OPTIONS.find((r) => r.id === selected)
    : null;

  function handleContinue() {
    if (!selectedRole) return;
    onboardingStorage.setCategory({
      role: selectedRole.id,
      domain: selectedRole.domain,
      ...(selectedRole.id === "other" && customDescription.trim()
        ? { customDescription: customDescription.trim() }
        : {}),
    });
    router.push("/onboarding/names");
  }

  const canContinue =
    selected !== null &&
    (selected !== "other" || customDescription.trim().length > 0);

  return (
    <>
      <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
        <OnboardingProgress currentStep={0} totalSteps={5} />
      </div>

      <div className="flex-1 overflow-auto px-6 pb-8 max-w-2xl mx-auto w-full">
        <div className="mb-8 md:mb-10 mt-4">
          <h1 className="font-serif text-2xl md:text-[32px] md:leading-[40px] font-bold text-primary tracking-wide mb-3">
            What do you want to organize?
          </h1>
          <p className="text-base text-secondary leading-relaxed">
            Pick one area. You'll add more topics later.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {ROLE_OPTIONS.map((r) => {
            const isSelected = selected === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={[
                  "w-full p-5 rounded-lg text-left cursor-pointer transition-all",
                  isSelected
                    ? "bg-accent-soft ring-2 ring-accent"
                    : "bg-white hover:shadow-lg",
                ].join(" ")}
              >
                <span className="material-symbols-outlined text-accent text-[28px] mb-2 block">
                  {r.materialIcon}
                </span>
                <h3 className="text-md font-semibold text-primary mb-0.5">
                  {r.label}
                </h3>
                <p className="text-sm text-secondary">{r.description}</p>
              </button>
            );
          })}
        </div>

        {selected === "other" && (
          <div className="mt-4 animate-fadeIn">
            <Input
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Describe what you track in a sentence"
              className="w-full"
            />
          </div>
        )}

        <p className="text-center text-xs text-muted mt-8 tracking-widest uppercase">
          Step 1 of 5
        </p>
      </div>

      {canContinue && (
        <div className="px-6 py-4 max-w-2xl mx-auto w-full animate-fadeIn">
          <Button variant="primary" onClick={handleContinue}>
            Continue
            <span className="material-symbols-outlined text-[18px] ml-2 align-middle">
              arrow_forward
            </span>
          </Button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run: `pnpm --filter web dev`, navigate to `http://localhost:3000/onboarding/category`
Expected: See 6 category cards with Material icons, select one, see Continue button appear.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/onboarding/category/page.tsx
git commit -m "feat(onboarding): O1 Pick a Category page"
```

---

### Task 4: O2 — Things + People Page

**Files:**
- Create: `apps/web/src/app/onboarding/names/page.tsx`

- [ ] **Step 1: Create the names page**

```typescript
// apps/web/src/app/onboarding/names/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { DOMAIN_CONFIGS, type DomainId, ROLE_OPTIONS } from "@/components/interview/domain-config";
import { onboardingStorage } from "@/lib/onboarding-storage";

export default function NamesPage() {
  const router = useRouter();
  const [whats, setWhats] = useState<string[]>([]);
  const [whos, setWhos] = useState<string[]>([]);
  const [currentWhat, setCurrentWhat] = useState("");
  const [currentWho, setCurrentWho] = useState("");
  const whatRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLInputElement>(null);

  const category = onboardingStorage.getCategory();

  useEffect(() => {
    if (!category) {
      router.replace("/onboarding/category");
    }
  }, [category, router]);

  if (!category) return null;

  const role = ROLE_OPTIONS.find((r) => r.id === category.role);
  const dc = DOMAIN_CONFIGS[category.domain as DomainId];

  function addWhat() {
    const trimmed = currentWhat.trim();
    if (!trimmed || whats.includes(trimmed)) return;
    setWhats((prev) => [...prev, trimmed]);
    setCurrentWhat("");
    setTimeout(() => whatRef.current?.focus(), 50);
  }

  function addWho() {
    const trimmed = currentWho.trim();
    if (!trimmed || whos.includes(trimmed)) return;
    setWhos((prev) => [...prev, trimmed]);
    setCurrentWho("");
    setTimeout(() => whoRef.current?.focus(), 50);
  }

  function handleContinue() {
    onboardingStorage.setNames({ whats, whos });
    router.push("/onboarding/connect");
  }

  return (
    <>
      <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
        <OnboardingProgress currentStep={1} totalSteps={5} />
      </div>

      <div className="flex-1 overflow-auto px-6 pb-8 max-w-2xl mx-auto w-full">
        {/* Back badge */}
        <button
          type="button"
          onClick={() => router.push("/onboarding/category")}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium mb-6 mt-4 cursor-pointer transition-all hover:bg-accent-container"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span className="material-symbols-outlined text-[18px]">{role?.materialIcon}</span>
          {role?.label}
        </button>

        {/* Things section */}
        <div className="mb-6">
          <h1 className="font-serif text-xl md:text-2xl font-bold text-primary tracking-wide mb-2">
            Name the things you track
          </h1>
          <p className="text-base text-secondary leading-relaxed mb-4">
            {dc?.whatHint || "Each one becomes a separate organized group in your feed."}
          </p>

          {whats.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {whats.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => setWhats((prev) => prev.filter((w) => w !== name))}
                    className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              ref={whatRef}
              value={currentWhat}
              onChange={(e) => setCurrentWhat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addWhat(); }
              }}
              placeholder={dc?.whatPlaceholder || "e.g. Soccer, Dance"}
              className="flex-1"
            />
            <Button
              variant="primary"
              fullWidth={false}
              onClick={addWhat}
              disabled={!currentWhat.trim()}
              className="whitespace-nowrap px-5"
            >
              Add
            </Button>
          </div>
        </div>

        {/* People section */}
        {whats.length > 0 && (
          <div className="mb-6 animate-fadeIn">
            <h2 className="text-md font-semibold text-primary mb-1">
              Who emails you about these?
            </h2>
            <p className="text-sm text-secondary mb-3">
              Optional. Just a few names to help us find the rest.
            </p>

            {whos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {whos.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-upcoming-soft text-upcoming-text text-sm font-medium"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => setWhos((prev) => prev.filter((w) => w !== name))}
                      className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                ref={whoRef}
                value={currentWho}
                onChange={(e) => setCurrentWho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addWho(); }
                }}
                placeholder={dc?.whoPlaceholder || 'e.g. "Coach Martinez"'}
                className="flex-1"
              />
              <Button
                variant="primary"
                fullWidth={false}
                onClick={addWho}
                disabled={!currentWho.trim()}
                className="whitespace-nowrap px-5"
              >
                Add
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted mt-8 tracking-widest uppercase">
          Step 2 of 5
        </p>
      </div>

      {whats.length >= 1 && (
        <div className="px-6 py-4 max-w-2xl mx-auto w-full animate-fadeIn">
          <Button variant="primary" onClick={handleContinue}>
            Continue
            <span className="material-symbols-outlined text-[18px] ml-2 align-middle">
              arrow_forward
            </span>
          </Button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run: navigate to `/onboarding/category`, select a category, tap Continue, verify `/onboarding/names` loads with correct domain labels.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/onboarding/names/page.tsx
git commit -m "feat(onboarding): O2 Things + People page"
```

---

### Task 5: O3 — Connect Gmail Page

**Files:**
- Create: `apps/web/src/app/onboarding/connect/page.tsx`

- [ ] **Step 1: Create the connect page**

This page handles the OAuth flow. When the user returns from Google OAuth, the auth callback at `/auth/callback` redirects back. After connecting, this page triggers hypothesis generation and then navigates to `/onboarding/scanning`.

```typescript
// apps/web/src/app/onboarding/connect/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { onboardingStorage } from "@/lib/onboarding-storage";
import { createBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "connecting" | "connected" | "generating" | "error";

export default function ConnectPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const generatingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const category = onboardingStorage.getCategory();
  const names = onboardingStorage.getNames();

  useEffect(() => {
    if (!category || !names) {
      router.replace("/onboarding/category");
      return;
    }

    // Check if already connected (returning from OAuth callback)
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.provider_token) {
        setStatus("connected");
      }
    });
  }, [category, names, router]);

  async function handleConnect() {
    setStatus("connecting");
    const supabase = createBrowserClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/gmail.readonly",
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding/connect`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (oauthError) {
      setStatus("error");
      setError(oauthError.message);
    }
  }

  async function handleGenerateAndScan() {
    if (generatingRef.current || !category || !names) return;
    generatingRef.current = true;
    setStatus("generating");

    try {
      const supabase = createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No session");

      abortRef.current = new AbortController();

      const res = await fetch("/api/interview/hypothesis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          role: category.role,
          domain: category.domain,
          whats: names.whats,
          whos: names.whos,
          groups: [],
          goals: [],
          ...(category.customDescription ? { customDescription: category.customDescription } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Hypothesis generation failed");
      }

      const { data } = await res.json();
      onboardingStorage.setSchemaId(data.schemaId);
      router.push("/onboarding/scanning");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStatus("error");
      setError((err as Error).message);
      generatingRef.current = false;
    }
  }

  useEffect(() => {
    if (status === "connected") {
      const timer = setTimeout(() => handleGenerateAndScan(), 500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const trustSignals = [
    { icon: "visibility_off", text: "Read-only access. We never send, delete, or modify email." },
    { icon: "lock", text: "Your data is encrypted and never shared." },
    { icon: "filter_alt", text: "We only look at emails matching your topics." },
  ];

  return (
    <>
      <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
        <OnboardingProgress currentStep={2} totalSteps={5} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8 max-w-md mx-auto w-full text-center">
        <h1 className="font-serif text-2xl md:text-[32px] md:leading-[40px] font-bold text-primary tracking-wide mb-3">
          Connect your Gmail
        </h1>
        <p className="text-base text-secondary leading-relaxed mb-8">
          We'll scan for emails matching what you entered. Read-only access only.
        </p>

        {status === "generating" ? (
          <div className="text-center">
            <span className="material-symbols-outlined text-accent text-[32px] animate-spin block mb-3">
              progress_activity
            </span>
            <p className="text-sm text-secondary">Setting up your topic...</p>
          </div>
        ) : status === "connected" ? (
          <div className="text-center">
            <span className="material-symbols-outlined text-success text-[32px] block mb-3">
              check_circle
            </span>
            <p className="text-sm text-secondary">Gmail connected! Preparing scan...</p>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={status === "connecting"}
            className="text-lg px-8 py-4 mb-8"
          >
            {status === "connecting" ? "Connecting..." : "Connect Gmail"}
          </Button>
        )}

        {error && (
          <p className="text-sm text-error mb-4">{error}</p>
        )}

        <div className="space-y-4 mt-6 text-left w-full">
          {trustSignals.map((signal) => (
            <div key={signal.icon} className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] text-secondary shrink-0 mt-0.5">
                {signal.icon}
              </span>
              <p className="text-sm text-secondary leading-relaxed">{signal.text}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Update auth callback to support `/onboarding/connect` as next URL**

Read `apps/web/src/app/auth/callback/route.ts` and verify it respects `?next=/onboarding/connect`. The current code already uses the `next` query param, so this should work without changes. Verify by checking the redirect logic handles the new path.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/onboarding/connect/page.tsx
git commit -m "feat(onboarding): O3 Connect Gmail page with hypothesis trigger"
```

---

### Task 6: O4 — Scanning Your Inbox Page

**Files:**
- Create: `apps/web/src/app/onboarding/scanning/page.tsx`
- Create: `apps/web/src/components/onboarding/scan-stream.tsx`

- [ ] **Step 1: Create the scan stream component**

```typescript
// apps/web/src/components/onboarding/scan-stream.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface ScanStreamProps {
  schemaId: string;
  onComplete: () => void;
}

interface ScanStatus {
  phase: string;
  totalEmails: number;
  processedEmails: number;
  newEmails: number;
  excludedEmails: number;
  status: string;
  recentDiscoveries?: {
    entities: { name: string; emailCount: number }[];
    subjectPatterns: string[];
  };
}

const PHASE_LABELS: Record<string, string> = {
  IDLE: "Preparing...",
  DISCOVERING: "Finding emails...",
  EXTRACTING: "Reading content...",
  CLUSTERING: "Grouping into cases...",
  SYNTHESIZING: "Creating summaries...",
  COMPLETED: "Done!",
  FAILED: "Something went wrong",
};

export function ScanStream({ schemaId, onComplete }: ScanStreamProps) {
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [visibleEntities, setVisibleEntities] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      const supabase = createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`/api/schemas/${schemaId}/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const { data } = await res.json();
      setScanStatus(data);

      if (data.recentDiscoveries?.entities) {
        const newNames = data.recentDiscoveries.entities.map(
          (e: { name: string }) => e.name,
        );
        setVisibleEntities((prev) => {
          const combined = [...prev];
          for (const name of newNames) {
            if (!combined.includes(name)) combined.push(name);
          }
          return combined;
        });
      }

      if (data.status === "COMPLETED") {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setTimeout(onComplete, 1000);
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [schemaId, onComplete]);

  const progressPercent = scanStatus
    ? scanStatus.status === "COMPLETED"
      ? 100
      : scanStatus.totalEmails > 0
        ? Math.min(95, Math.round((scanStatus.processedEmails / scanStatus.totalEmails) * 100))
        : scanStatus.phase === "DISCOVERING" ? 20
        : scanStatus.phase === "EXTRACTING" ? 50
        : scanStatus.phase === "CLUSTERING" ? 75
        : scanStatus.phase === "SYNTHESIZING" ? 90
        : 10
    : 0;

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="w-full h-2 bg-surface-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Phase label */}
      <p className="text-sm text-secondary text-center">
        {PHASE_LABELS[scanStatus?.phase ?? "IDLE"] ?? "Processing..."}
      </p>

      {/* Email counter */}
      {scanStatus && scanStatus.newEmails > 0 && (
        <p className="text-2xl font-bold text-primary text-center">
          Found {scanStatus.newEmails} relevant emails
        </p>
      )}

      {/* Streaming discoveries */}
      {visibleEntities.length > 0 && (
        <div className="space-y-2">
          {visibleEntities.slice(0, 15).map((name, i) => (
            <div
              key={name}
              className="text-sm text-secondary animate-fadeIn"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <span className="text-accent mr-2">-></span>
              {name}
            </div>
          ))}
        </div>
      )}

      {/* Reassurance */}
      <p className="text-xs text-muted text-center">
        This usually takes about a minute
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create the scanning page**

```typescript
// apps/web/src/app/onboarding/scanning/page.tsx
"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { ScanStream } from "@/components/onboarding/scan-stream";
import { onboardingStorage } from "@/lib/onboarding-storage";

export default function ScanningPage() {
  const router = useRouter();
  const schemaId = onboardingStorage.getSchemaId();

  useEffect(() => {
    if (!schemaId) {
      router.replace("/onboarding/category");
    }
  }, [schemaId, router]);

  const handleComplete = useCallback(() => {
    router.push("/onboarding/review");
  }, [router]);

  if (!schemaId) return null;

  return (
    <>
      <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
        <OnboardingProgress currentStep={3} totalSteps={5} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8 max-w-md mx-auto w-full">
        <h1 className="font-serif text-2xl md:text-[32px] md:leading-[40px] font-bold text-primary tracking-wide mb-3 text-center">
          Scanning your inbox
        </h1>

        <ScanStream schemaId={schemaId} onComplete={handleComplete} />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/onboarding/scanning/page.tsx apps/web/src/components/onboarding/scan-stream.tsx
git commit -m "feat(onboarding): O4 Scanning page with polling progress"
```

---

### Task 7: Enhance Status API for Scan Discoveries

**Files:**
- Modify: `apps/web/src/app/api/schemas/[schemaId]/status/route.ts`

- [ ] **Step 1: Read the current status route**

Read `apps/web/src/app/api/schemas/[schemaId]/status/route.ts` to understand the current response shape.

- [ ] **Step 2: Add recentDiscoveries to the response**

After the existing scan job data is assembled, add a query for recently discovered entities:

```typescript
// Add after the existing scanJob query, before the response:
const recentDiscoveries = latestJob
  ? {
      entities: await prisma.entity.findMany({
        where: {
          schemaId,
          autoDetected: true,
          createdAt: { gte: latestJob.startedAt ?? latestJob.createdAt },
        },
        select: { name: true, emailCount: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      subjectPatterns: [], // Future: extract from email subjects
    }
  : undefined;

// Include in the response body alongside existing fields:
// recentDiscoveries,
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck`
Expected: passes

```bash
git add apps/web/src/app/api/schemas/\[schemaId\]/status/route.ts
git commit -m "feat(api): add recentDiscoveries to schema status poll"
```

---

### Task 8: O5 — Review What We Found Page

**Files:**
- Create: `apps/web/src/app/onboarding/review/page.tsx`
- Create: `apps/web/src/components/onboarding/review-entities.tsx`

- [ ] **Step 1: Create the review entities component**

```typescript
// apps/web/src/components/onboarding/review-entities.tsx
"use client";

interface EntityData {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  autoDetected: boolean;
  emailCount: number;
  aliases: string[];
  isActive: boolean;
}

interface ReviewEntitiesProps {
  userThings: string[];
  entities: EntityData[];
  onToggleEntity: (entityId: string, active: boolean) => void;
}

export function ReviewEntities({
  userThings,
  entities,
  onToggleEntity,
}: ReviewEntitiesProps) {
  const primaryEntities = entities.filter((e) => e.type === "PRIMARY");
  const discoveries = entities.filter(
    (e) => e.autoDetected && e.type === "PRIMARY" && !userThings.includes(e.name),
  );

  return (
    <div className="space-y-6">
      {/* Section 1: User-entered things with discovered aliases */}
      {userThings.map((thingName) => {
        const matchingEntities = primaryEntities.filter(
          (e) => e.name === thingName || e.aliases.includes(thingName),
        );
        const related = primaryEntities.filter(
          (e) =>
            e.name !== thingName &&
            !e.aliases.includes(thingName) &&
            matchingEntities.some((m) => e.aliases.some((a) => m.aliases.includes(a))),
        );

        return (
          <div key={thingName} className="bg-white rounded-lg p-5">
            <h3 className="text-md font-semibold text-primary mb-3">{thingName}</h3>
            {matchingEntities.length === 0 && related.length === 0 ? (
              <p className="text-sm text-muted">No additional items found</p>
            ) : (
              <div className="space-y-2">
                {[...matchingEntities.filter((e) => e.name !== thingName), ...related].map(
                  (entity) => (
                    <div
                      key={entity.id}
                      className="flex items-center justify-between py-2 pl-4"
                    >
                      <div>
                        <span className="text-sm text-primary">{entity.name}</span>
                        <span className="text-xs text-muted ml-2">
                          {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleEntity(entity.id, !entity.isActive)}
                        className="text-xs text-secondary hover:text-error cursor-pointer"
                      >
                        {entity.isActive ? "Not right? Separate" : "Re-merge"}
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Section 2: New discoveries */}
      {discoveries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-3">
            New Discoveries
          </h3>
          <div className="space-y-2">
            {discoveries.map((entity) => (
              <div
                key={entity.id}
                className="bg-white rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-sm font-medium text-primary">{entity.name}</span>
                  <span className="text-xs text-muted ml-2">
                    {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleEntity(entity.id, true)}
                    className="text-xs font-medium text-accent cursor-pointer"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleEntity(entity.id, false)}
                    className="text-xs text-muted cursor-pointer"
                  >
                    Not now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the review page**

```typescript
// apps/web/src/app/onboarding/review/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { ReviewEntities } from "@/components/onboarding/review-entities";
import { onboardingStorage } from "@/lib/onboarding-storage";
import { createBrowserClient } from "@/lib/supabase/client";

interface EntityData {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  autoDetected: boolean;
  emailCount: number;
  aliases: string[];
  isActive: boolean;
}

export default function ReviewPage() {
  const router = useRouter();
  const [entities, setEntities] = useState<EntityData[]>([]);
  const [topicName, setTopicName] = useState("");
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schemaId = onboardingStorage.getSchemaId();
  const names = onboardingStorage.getNames();

  useEffect(() => {
    if (!schemaId) {
      router.replace("/onboarding/category");
      return;
    }

    async function loadData() {
      const supabase = createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`/api/schemas/${schemaId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const { data } = await res.json();
      setEntities(
        data.entities.map((e: Record<string, unknown>) => ({
          id: e.id as string,
          name: e.name as string,
          type: e.type as string,
          autoDetected: e.autoDetected as boolean,
          emailCount: (e.emailCount as number) ?? 0,
          aliases: (e.aliases as string[]) ?? [],
          isActive: (e.isActive as boolean) ?? true,
        })),
      );
      setTopicName((data.name as string) || "");
      setLoading(false);
    }

    loadData();
  }, [schemaId, router]);

  function handleToggleEntity(entityId: string, active: boolean) {
    setEntities((prev) =>
      prev.map((e) => (e.id === entityId ? { ...e, isActive: active } : e)),
    );
  }

  async function handleFinalize() {
    if (finalizing || !schemaId) return;
    setFinalizing(true);

    try {
      const supabase = createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No session");

      const res = await fetch("/api/interview/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          schemaId,
          topicName: topicName.trim() || undefined,
          entityToggles: entities.map((e) => ({ id: e.id, isActive: e.isActive })),
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Finalization failed");
      }

      onboardingStorage.clearAll();
      router.push("/feed");
    } catch (err) {
      setError((err as Error).message);
      setFinalizing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="material-symbols-outlined text-accent text-[32px] animate-spin">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
        <OnboardingProgress currentStep={4} totalSteps={5} />
      </div>

      <div className="flex-1 overflow-auto px-6 pb-8 max-w-2xl mx-auto w-full">
        <div className="mb-6 mt-4">
          <h1 className="font-serif text-2xl md:text-[32px] md:leading-[40px] font-bold text-primary tracking-wide mb-2">
            Here's what we found
          </h1>
          <p className="text-base text-secondary leading-relaxed">
            Confirm what looks right. Tap to change.
          </p>
        </div>

        <ReviewEntities
          userThings={names?.whats ?? []}
          entities={entities}
          onToggleEntity={handleToggleEntity}
        />

        {/* Topic name */}
        <div className="mt-6">
          <label className="text-xs font-semibold uppercase tracking-widest text-secondary mb-2 block">
            Name this topic
          </label>
          <Input
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
            placeholder="e.g. Kids Activities"
          />
        </div>

        {error && (
          <p className="text-sm text-error mt-4">{error}</p>
        )}
      </div>

      <div className="px-6 py-4 max-w-2xl mx-auto w-full">
        <Button
          variant="primary"
          onClick={handleFinalize}
          disabled={finalizing}
        >
          {finalizing ? "Setting up..." : "Show me my cases!"}
        </Button>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/onboarding/review/page.tsx apps/web/src/components/onboarding/review-entities.tsx
git commit -m "feat(onboarding): O5 Review page with entity confirmation"
```

---

### Task 9: Update Auth Callback Routing

**Files:**
- Modify: `apps/web/src/app/auth/callback/route.ts`

- [ ] **Step 1: Update the dynamic routing fallback**

In the auth callback, when no `next` param is provided, the current code redirects to `/dashboard` or `/interview`. Update the fallback to use the new routes:

```typescript
// Change the dynamic routing section:
// Old:
//   return redirect(`${origin}${schemaCount > 0 ? "/dashboard" : "/interview"}`);
// New:
//   return redirect(`${origin}${schemaCount > 0 ? "/feed" : "/onboarding/category"}`);
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/auth/callback/route.ts
git commit -m "feat(auth): update callback routing to /feed and /onboarding"
```

---

### Task 10: Update Landing Page Redirects

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Update the auth redirect logic**

The landing page currently redirects authenticated users to `/dashboard` or `/interview`. Update:

```typescript
// Old:
//   if (schemas.length > 0) redirect("/dashboard");
//   else redirect("/interview");
// New:
//   if (schemas.length > 0) redirect("/feed");
//   else redirect("/onboarding/category");
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat: update landing page redirects to /feed and /onboarding"
```

---

### Task 11: Wave 1 Verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: all packages pass

- [ ] **Step 2: Run existing unit tests**

```bash
pnpm -r test
```

Expected: all 81 unit tests pass (unchanged)

- [ ] **Step 3: Run biome**

```bash
pnpm biome check --write apps/web/src/app/onboarding/ apps/web/src/components/onboarding/ apps/web/src/lib/onboarding-storage.ts
```

- [ ] **Step 4: Manual verification**

Navigate through the complete onboarding flow:
1. `/onboarding/category` - select a category
2. `/onboarding/names` - add things + people
3. `/onboarding/connect` - connect Gmail (or verify connected state)
4. `/onboarding/scanning` - watch scan progress
5. `/onboarding/review` - review entities, name topic, finalize
6. Redirects to `/feed`

- [ ] **Step 5: Commit Wave 1 complete**

```bash
git add -A
git commit -m "feat: Wave 1 complete - onboarding flow O1-O5"
```

---

## Wave 2: Feed + Case Detail (GitHub Issue #9)

### Task 12: Authenticated Layout + Bottom Navigation

**Files:**
- Create: `apps/web/src/components/nav/bottom-nav.tsx`
- Create: `apps/web/src/app/(authenticated)/layout.tsx`

- [ ] **Step 1: Create bottom nav component**

```typescript
// apps/web/src/components/nav/bottom-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Feed", icon: "dynamic_feed", href: "/feed" },
  { label: "Note", icon: "add_circle", href: "#note" },
  { label: "Settings", icon: "settings", href: "/settings" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-border/20 z-50">
      <div className="flex justify-around items-center h-14 max-w-lg mx-auto">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/feed"
              ? pathname === "/feed" || pathname.startsWith("/feed/")
              : pathname.startsWith(item.href);

          if (item.href === "#note") {
            return (
              <button
                key={item.label}
                type="button"
                className="flex flex-col items-center gap-0.5 text-secondary cursor-pointer"
                onClick={() => {
                  // Future: open note modal
                }}
              >
                <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={[
                "flex flex-col items-center gap-0.5",
                isActive ? "text-accent" : "text-secondary",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Create authenticated layout**

```typescript
// apps/web/src/app/(authenticated)/layout.tsx
import { BottomNav } from "@/components/nav/bottom-nav";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface pb-16">
      {children}
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/nav/bottom-nav.tsx apps/web/src/app/\(authenticated\)/layout.tsx
git commit -m "feat: authenticated layout with persistent bottom navigation"
```

---

### Task 13: Feed API Endpoint

**Files:**
- Create: `apps/web/src/app/(authenticated)/feed/page.tsx` (placeholder for route group)
- Create: `apps/web/src/app/api/feed/route.ts`

- [ ] **Step 1: Create the feed API route**

```typescript
// apps/web/src/app/api/feed/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/middleware/with-auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { computeCaseDecay } from "@denim/engine/actions/lifecycle";

const URGENCY_ORDER: Record<string, number> = {
  IMMINENT: 0,
  THIS_WEEK: 1,
  UPCOMING: 2,
  NO_ACTION: 3,
};

export const GET = withAuth(async ({ userId, request }) => {
  try {
    const url = new URL(request.url);
    const includeResolved = url.searchParams.get("includeResolved") === "true";

    // Get all schemas for this user
    const schemas = await prisma.caseSchema.findMany({
      where: { userId, status: { in: ["ACTIVE", "ONBOARDING"] } },
      select: {
        id: true,
        name: true,
        domain: true,
        summaryLabels: true,
        entities: {
          where: { isActive: true, type: "PRIMARY" },
          select: { id: true, name: true },
        },
      },
    });

    if (schemas.length === 0) {
      return NextResponse.json({
        data: { cases: [], schemas: [] },
      });
    }

    const schemaIds = schemas.map((s) => s.id);

    // Get all active cases across schemas
    const whereClause: Record<string, unknown> = {
      schemaId: { in: schemaIds },
      urgency: { not: "IRRELEVANT" },
    };

    if (!includeResolved) {
      whereClause.status = { in: ["OPEN", "IN_PROGRESS"] };
    }

    const cases = await prisma.case.findMany({
      where: whereClause,
      select: {
        id: true,
        schemaId: true,
        entityId: true,
        title: true,
        emoji: true,
        mood: true,
        summary: true,
        primaryActor: true,
        displayTags: true,
        anchorTags: true,
        status: true,
        urgency: true,
        aggregatedData: true,
        startDate: true,
        endDate: true,
        lastEmailDate: true,
        lastSenderName: true,
        lastSenderEntity: true,
        viewedAt: true,
        feedbackRating: true,
        nextActionDate: true,
        entity: { select: { id: true, name: true } },
        caseEmails: { select: { id: true } },
        actions: {
          where: { status: "PENDING" },
          select: {
            id: true,
            title: true,
            actionType: true,
            dueDate: true,
            eventStartTime: true,
            eventEndTime: true,
            eventLocation: true,
            amount: true,
            currency: true,
            status: true,
            reminderCount: true,
            confidence: true,
          },
          orderBy: [{ dueDate: "asc" }],
          take: 3,
        },
      },
      orderBy: { lastEmailDate: "desc" },
    });

    // Apply read-time freshness (decay check)
    const now = new Date();
    const feedCases = cases.map((c) => {
      const decayed = computeCaseDecay(
        {
          status: c.status,
          urgency: c.urgency,
          actions: c.actions.map((a) => ({
            status: a.status,
            dueDate: a.dueDate,
            eventStartTime: a.eventStartTime,
            actionType: a.actionType,
          })),
        },
        now,
      );

      const schema = schemas.find((s) => s.id === c.schemaId);

      return {
        id: c.id,
        schemaId: c.schemaId,
        schemaName: schema?.name ?? "",
        schemaDomain: schema?.domain ?? "general",
        entityId: c.entityId,
        entityName: c.entity?.name ?? "",
        title: c.title,
        emoji: c.emoji,
        mood: c.mood,
        summary: c.summary,
        primaryActor: c.primaryActor,
        displayTags: c.displayTags,
        anchorTags: c.anchorTags,
        status: decayed.status ?? c.status,
        urgency: decayed.urgency ?? c.urgency,
        aggregatedData: c.aggregatedData,
        startDate: c.startDate?.toISOString() ?? null,
        endDate: c.endDate?.toISOString() ?? null,
        lastEmailDate: c.lastEmailDate?.toISOString() ?? null,
        lastSenderName: c.lastSenderName,
        lastSenderEntity: c.lastSenderEntity,
        viewedAt: c.viewedAt?.toISOString() ?? null,
        feedbackRating: c.feedbackRating,
        emailCount: c.caseEmails.length,
        actions: c.actions.map((a) => ({
          ...a,
          dueDate: a.dueDate?.toISOString() ?? null,
          eventStartTime: a.eventStartTime?.toISOString() ?? null,
          eventEndTime: a.eventEndTime?.toISOString() ?? null,
        })),
      };
    });

    // Sort by urgency tier, then by lastEmailDate
    feedCases.sort((a, b) => {
      const aUrgency = URGENCY_ORDER[a.urgency ?? "UPCOMING"] ?? 2;
      const bUrgency = URGENCY_ORDER[b.urgency ?? "UPCOMING"] ?? 2;
      if (aUrgency !== bUrgency) return aUrgency - bUrgency;

      const aDate = a.lastEmailDate ? new Date(a.lastEmailDate).getTime() : 0;
      const bDate = b.lastEmailDate ? new Date(b.lastEmailDate).getTime() : 0;
      return bDate - aDate;
    });

    // Build schema metadata with case counts
    const schemaMetadata = schemas.map((s) => {
      const schemaCases = feedCases.filter((c) => c.schemaId === s.id);
      const entityCounts = s.entities.map((e) => ({
        id: e.id,
        name: e.name,
        caseCount: schemaCases.filter((c) => c.entityId === e.id).length,
      }));

      return {
        id: s.id,
        name: s.name,
        domain: s.domain,
        caseCount: schemaCases.length,
        entities: entityCounts,
      };
    });

    return NextResponse.json({
      data: { cases: feedCases, schemas: schemaMetadata },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "FeedAPI",
      operation: "listFeed",
      userId,
    });
  }
});
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Note: The `computeCaseDecay` import path may need adjustment based on the actual export. Read `packages/engine/src/actions/lifecycle.ts` to verify the exact function signature and import path.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/feed/route.ts
git commit -m "feat(api): cross-topic feed endpoint with urgency sorting"
```

---

### Task 14: Feed Page + Client Components

**Files:**
- Create: `apps/web/src/app/(authenticated)/feed/page.tsx`
- Create: `apps/web/src/components/feed/feed-header.tsx`
- Create: `apps/web/src/components/feed/topic-chips.tsx`
- Create: `apps/web/src/components/feed/urgency-section.tsx`
- Create: `apps/web/src/components/feed/empty-state.tsx`

This is a large task. The feed page server-fetches initial data and passes it to a client component that handles filtering.

- [ ] **Step 1: Create feed header**

```typescript
// apps/web/src/components/feed/feed-header.tsx
"use client";

export function FeedHeader({ avatarUrl }: { avatarUrl?: string | null }) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-6 py-4 flex items-center justify-between">
      <h1 className="font-serif text-xl font-bold text-primary tracking-wide">
        Denim
      </h1>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full" />
      ) : (
        <span className="material-symbols-outlined text-[24px] text-secondary">
          account_circle
        </span>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Create topic chips**

```typescript
// apps/web/src/components/feed/topic-chips.tsx
"use client";

interface SchemaChip {
  id: string;
  name: string;
  caseCount: number;
  entities: { id: string; name: string; caseCount: number }[];
}

interface TopicChipsProps {
  schemas: SchemaChip[];
  activeSchemaId: string | null;
  activeEntityId: string | null;
  onSchemaChange: (id: string | null) => void;
  onEntityChange: (id: string | null) => void;
}

export function TopicChips({
  schemas,
  activeSchemaId,
  activeEntityId,
  onSchemaChange,
  onEntityChange,
}: TopicChipsProps) {
  const activeSchema = activeSchemaId
    ? schemas.find((s) => s.id === activeSchemaId)
    : null;

  return (
    <div className="space-y-2 px-6">
      {/* Topic row */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => { onSchemaChange(null); onEntityChange(null); }}
          className={[
            "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all cursor-pointer shrink-0",
            activeSchemaId === null
              ? "bg-accent text-inverse"
              : "bg-surface-highest text-secondary",
          ].join(" ")}
        >
          All
        </button>
        {schemas.map((schema) => (
          <button
            key={schema.id}
            type="button"
            onClick={() => {
              onSchemaChange(activeSchemaId === schema.id ? null : schema.id);
              onEntityChange(null);
            }}
            className={[
              "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all cursor-pointer shrink-0",
              activeSchemaId === schema.id
                ? "bg-accent text-inverse"
                : "bg-surface-highest text-secondary",
            ].join(" ")}
          >
            {schema.name}
          </button>
        ))}
      </div>

      {/* Entity sub-chips */}
      {activeSchema && activeSchema.entities.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pl-2">
          {activeSchema.entities.map((entity) => (
            <button
              key={entity.id}
              type="button"
              onClick={() =>
                onEntityChange(activeEntityId === entity.id ? null : entity.id)
              }
              className={[
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer shrink-0",
                activeEntityId === entity.id
                  ? "bg-accent-soft text-accent-text"
                  : "bg-surface-high text-secondary",
              ].join(" ")}
            >
              {entity.name} ({entity.caseCount})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create urgency section**

```typescript
// apps/web/src/components/feed/urgency-section.tsx

interface UrgencySectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
}

export function UrgencySection({ title, icon, children }: UrgencySectionProps) {
  return (
    <section className="px-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[20px] text-secondary">
          {icon}
        </span>
        <h2 className="font-serif text-lg font-bold text-primary tracking-wide">
          {title}
        </h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Create empty state**

```typescript
// apps/web/src/components/feed/empty-state.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Variant = "processing" | "caught-up" | "no-topics";

export function FeedEmptyState({ variant }: { variant: Variant }) {
  if (variant === "processing") {
    return (
      <div className="text-center py-12 px-6">
        <span className="material-symbols-outlined text-[32px] text-accent animate-spin block mb-4">
          progress_activity
        </span>
        <p className="text-sm text-secondary">Your cases are being prepared...</p>
      </div>
    );
  }

  if (variant === "no-topics") {
    return (
      <div className="text-center py-12 px-6">
        <span className="material-symbols-outlined text-[48px] text-secondary block mb-4">
          mail
        </span>
        <h3 className="font-serif text-xl font-bold text-primary mb-2">
          Welcome to Denim
        </h3>
        <p className="text-sm text-secondary mb-6 max-w-sm mx-auto">
          Set up your first topic to get started.
        </p>
        <Link href="/onboarding/category">
          <Button variant="primary" fullWidth={false}>
            Get Started
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center py-12 px-6">
      <span className="material-symbols-outlined text-[48px] text-secondary block mb-4">
        auto_awesome
      </span>
      <h3 className="font-serif text-xl font-bold text-primary mb-2">
        All caught up!
      </h3>
      <p className="text-sm text-secondary max-w-sm mx-auto">
        Nothing needs your attention right now.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Create the feed page (server component that fetches data + client feed)**

The feed page is a server component that fetches initial data and passes it to a client component. Create the server page and a client `FeedClient` component.

```typescript
// apps/web/src/app/(authenticated)/feed/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { FeedClient } from "@/components/feed/feed-client";

export default async function FeedPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarUrl: true },
  });

  return <FeedClient avatarUrl={dbUser?.avatarUrl} />;
}
```

- [ ] **Step 6: Create the feed client component**

This is the main client component that loads data from `/api/feed` and handles all filtering client-side.

```typescript
// apps/web/src/components/feed/feed-client.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { CaseCard, type CaseCardData } from "@/components/cases/case-card";
import { FeedHeader } from "./feed-header";
import { TopicChips } from "./topic-chips";
import { UrgencySection } from "./urgency-section";
import { FeedEmptyState } from "./empty-state";

interface FeedSchema {
  id: string;
  name: string;
  domain: string;
  caseCount: number;
  entities: { id: string; name: string; caseCount: number }[];
}

interface FeedCaseData extends CaseCardData {
  schemaName: string;
  schemaDomain: string;
}

const URGENCY_TIERS = [
  { key: "IMMINENT", title: "Focus Now", icon: "priority_high" },
  { key: "THIS_WEEK", title: "This Week", icon: "date_range" },
  { key: "UPCOMING", title: "Upcoming", icon: "upcoming" },
  { key: "NO_ACTION", title: "No Action Needed", icon: "check_circle" },
] as const;

export function FeedClient({ avatarUrl }: { avatarUrl?: string | null }) {
  const [cases, setCases] = useState<FeedCaseData[]>([]);
  const [schemas, setSchemas] = useState<FeedSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSchemaId, setActiveSchemaId] = useState<string | null>(null);
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const res = await fetch("/api/feed", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return;

    const { data } = await res.json();
    setCases(data.cases);
    setSchemas(data.schemas);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Client-side filtering (instant)
  const filtered = cases.filter((c) => {
    if (activeSchemaId && c.schemaId !== activeSchemaId) return false;
    if (activeEntityId && c.entityId !== activeEntityId) return false;
    return true;
  });

  // Group by urgency
  const grouped: Record<string, FeedCaseData[]> = {};
  for (const c of filtered) {
    const tier = c.urgency ?? "UPCOMING";
    if (!grouped[tier]) grouped[tier] = [];
    grouped[tier].push(c);
  }

  if (loading) {
    return (
      <>
        <FeedHeader avatarUrl={avatarUrl} />
        <div className="space-y-4 px-6 animate-pulse mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg p-6 border-l-4 border-l-surface-highest">
              <div className="h-4 bg-surface-mid rounded w-3/4 mb-3" />
              <div className="h-3 bg-surface-mid rounded w-1/2 mb-2" />
              <div className="h-3 bg-surface-mid rounded w-full" />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (schemas.length === 0) {
    return (
      <>
        <FeedHeader avatarUrl={avatarUrl} />
        <FeedEmptyState variant="no-topics" />
      </>
    );
  }

  return (
    <>
      <FeedHeader avatarUrl={avatarUrl} />

      <div className="py-3">
        <TopicChips
          schemas={schemas}
          activeSchemaId={activeSchemaId}
          activeEntityId={activeEntityId}
          onSchemaChange={setActiveSchemaId}
          onEntityChange={setActiveEntityId}
        />
      </div>

      {filtered.length === 0 ? (
        <FeedEmptyState variant="caught-up" />
      ) : (
        <div className="space-y-8 mt-2">
          {URGENCY_TIERS.map(({ key, title, icon }) => {
            const tierCases = grouped[key];
            if (!tierCases?.length) return null;
            return (
              <UrgencySection key={key} title={title} icon={icon}>
                {tierCases.map((c) => (
                  <CaseCard
                    key={c.id}
                    caseData={c}
                    schemaId={c.schemaId}
                  />
                ))}
              </UrgencySection>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/feed/ apps/web/src/components/feed/
git commit -m "feat: cross-topic feed page with client-side filtering"
```

---

### Task 15: Case Detail Page

**Files:**
- Create: `apps/web/src/app/(authenticated)/feed/[caseId]/page.tsx`

- [ ] **Step 1: Create the case detail page**

This is a server component that loads the full case and renders it. Reuse the existing case detail data loading pattern from `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/page.tsx` but under the new route.

Read the existing case detail page first, then create a new version at the new path that uses the same data loading but with the new route structure (no schemaId in URL -- look up the case directly by caseId and verify ownership through the schema->user chain).

The detailed component code depends on the existing page structure. Read the existing page, adapt the data loading to work without schemaId in the URL, and render using the existing `CaseDetail` / `CaseSummary` components (restyled with Digital Curator tokens).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/feed/\[caseId\]/
git commit -m "feat: case detail page at /feed/[caseId]"
```

---

### Task 16: Update CaseCard for 5-Line Spec

**Files:**
- Modify: `apps/web/src/components/cases/case-card.tsx`
- Create: `apps/web/src/components/cases/domain-context-line.tsx`

- [ ] **Step 1: Create domain context line component**

```typescript
// apps/web/src/components/cases/domain-context-line.tsx

interface DomainContextLineProps {
  domain: string;
  actions: {
    actionType: string;
    eventStartTime?: string | null;
    eventLocation?: string | null;
    dueDate?: string | null;
    amount?: number | null;
    currency?: string | null;
  }[];
  lastSenderName?: string | null;
}

export function DomainContextLine({ domain, actions, lastSenderName }: DomainContextLineProps) {
  const parts: string[] = [];

  if (domain === "school_parent") {
    const event = actions.find((a) => a.actionType === "EVENT" && a.eventStartTime);
    if (event?.eventStartTime) {
      const d = new Date(event.eventStartTime);
      parts.push(d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
      parts.push(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      if (event.eventLocation) parts.push(event.eventLocation);
    }
  } else if (domain === "property") {
    if (lastSenderName) parts.push(lastSenderName);
    const payment = actions.find((a) => a.actionType === "PAYMENT" && a.amount);
    if (payment?.amount) {
      const formatted = payment.amount >= 1000
        ? `$${(payment.amount / 1000).toFixed(1)}k`
        : `$${payment.amount}`;
      parts.push(formatted);
    }
    const deadline = actions.find((a) => a.dueDate);
    if (deadline?.dueDate) {
      const d = new Date(deadline.dueDate);
      parts.push(d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
    }
  }

  // Fallback for any domain
  if (parts.length === 0) {
    const deadline = actions.find((a) => a.dueDate);
    if (deadline?.dueDate) {
      const d = new Date(deadline.dueDate);
      parts.push(`Due ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`);
    }
    const payment = actions.find((a) => a.actionType === "PAYMENT" && a.amount);
    if (payment?.amount) parts.push(`$${payment.amount}`);
  }

  if (parts.length === 0) return null;

  return (
    <p className="text-sm text-muted truncate">
      {parts.join(" \u00B7 ")}
    </p>
  );
}
```

- [ ] **Step 2: Update CaseCard to match the 5-line spec**

Read the current `apps/web/src/components/cases/case-card.tsx` (already restyled with Digital Curator tokens in the 2-screen test). Update it to follow the strict 5-line card format from the spec, integrating `DomainContextLine` and adding the `schemaDomain` prop.

The key changes:
- Line 1: emoji + entity name + mood indicator + unread dot
- Line 2: case title (1 line, truncated)
- Line 3: `DomainContextLine` component
- Line 4: top action with checkbox + "+N more"
- Line 5: date range right-aligned
- Accept `schemaDomain` prop (or read from context)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/cases/case-card.tsx apps/web/src/components/cases/domain-context-line.tsx
git commit -m "feat: 5-line case card with domain-aware context line"
```

---

### Task 17: Wave 2 Verification

- [ ] **Step 1: Run typecheck and tests**

```bash
pnpm typecheck && pnpm -r test
```

- [ ] **Step 2: Run biome**

```bash
pnpm biome check --write apps/web/src/app/\(authenticated\)/ apps/web/src/components/feed/ apps/web/src/components/nav/ apps/web/src/components/cases/ apps/web/src/app/api/feed/
```

- [ ] **Step 3: Manual verification**

1. Navigate to `/feed` - see cases from all topics
2. Tap topic chips - instant filtering, no network delay
3. Tap entity sub-chips - further filtering
4. Verify urgency sections render correctly
5. Tap a case card - navigates to `/feed/[caseId]`
6. Bottom nav visible on all pages
7. Empty states display correctly

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: Wave 2 complete - cross-topic feed with bottom nav"
```

---

## Wave 3: Settings + Cleanup (GitHub Issue #10)

### Task 18: Settings Hub

**Files:**
- Create: `apps/web/src/app/(authenticated)/settings/page.tsx`

- [ ] **Step 1: Create settings page**

```typescript
// apps/web/src/app/(authenticated)/settings/page.tsx
"use client";

import Link from "next/link";

const SETTINGS_ITEMS = [
  { icon: "list_alt", title: "My Topics", subtitle: "Manage what Denim tracks", href: "/settings/topics" },
  { icon: "add_circle", title: "Add a Topic", subtitle: "Set up a new category", href: "/onboarding/category" },
  { icon: "person", title: "Account", subtitle: "Email, sign out", href: "#account" },
] as const;

export default function SettingsPage() {
  return (
    <div className="px-6 py-6 max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl font-bold text-primary tracking-wide mb-6">
        Settings
      </h1>

      <div className="space-y-2">
        {SETTINGS_ITEMS.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="flex items-center gap-4 p-4 bg-white rounded-lg hover:shadow-md transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[24px] text-accent">
              {item.icon}
            </span>
            <div>
              <h3 className="text-md font-semibold text-primary">{item.title}</h3>
              <p className="text-sm text-secondary">{item.subtitle}</p>
            </div>
            <span className="material-symbols-outlined text-[20px] text-muted ml-auto">
              chevron_right
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/settings/page.tsx
git commit -m "feat: settings hub page"
```

---

### Task 19: Topic List Page

**Files:**
- Create: `apps/web/src/app/(authenticated)/settings/topics/page.tsx`

- [ ] **Step 1: Create topic list page**

```typescript
// apps/web/src/app/(authenticated)/settings/topics/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { TopicListClient } from "./topic-list-client";

export default async function TopicsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const schemas = await prisma.caseSchema.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      emailCount: true,
      caseCount: true,
      createdAt: true,
      _count: { select: { entities: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const serialized = schemas.map((s) => ({
    id: s.id,
    name: s.name,
    domain: s.domain,
    status: s.status,
    emailCount: s.emailCount,
    caseCount: s.caseCount,
    entityCount: s._count.entities,
    createdAt: s.createdAt.toISOString(),
  }));

  return <TopicListClient topics={serialized} />;
}
```

- [ ] **Step 2: Create the client component**

```typescript
// apps/web/src/app/(authenticated)/settings/topics/topic-list-client.tsx
"use client";

import Link from "next/link";

interface Topic {
  id: string;
  name: string;
  domain: string;
  status: string;
  emailCount: number;
  caseCount: number;
  entityCount: number;
  createdAt: string;
}

export function TopicListClient({ topics }: { topics: Topic[] }) {
  return (
    <div className="px-6 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl font-bold text-primary tracking-wide">
          My Topics
        </h1>
        <Link
          href="/onboarding/category"
          className="text-sm font-medium text-accent flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Topic
        </Link>
      </div>

      {topics.length === 0 ? (
        <p className="text-sm text-secondary text-center py-8">
          No topics set up yet.
        </p>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="bg-white rounded-lg p-5 flex items-start justify-between"
            >
              <div>
                <h3 className="text-md font-semibold text-primary mb-1">
                  {topic.name}
                </h3>
                <p className="text-sm text-secondary">
                  {topic.entityCount} entities &middot; {topic.caseCount} cases &middot; {topic.emailCount} emails
                </p>
                <p className="text-xs text-muted mt-1">
                  Active since {new Date(topic.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <span className={[
                "text-xs font-medium px-2 py-0.5 rounded-full",
                topic.status === "ACTIVE" ? "bg-success-soft text-success-text" : "bg-surface-mid text-secondary",
              ].join(" ")}>
                {topic.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/settings/topics/
git commit -m "feat: topic list page under settings"
```

---

### Task 20: Remove Old Routes + Components

**Files:**
- Delete: `apps/web/src/app/interview/` (entire directory)
- Delete: `apps/web/src/app/dashboard/` (entire directory)
- Delete: `apps/web/src/hooks/use-interview-flow.ts`
- Delete: `apps/web/src/hooks/use-interview-scan.ts`
- Delete: `apps/web/src/components/dashboard/` (entire directory)
- Delete: `apps/web/src/components/cases/metric-bar.tsx`
- Delete: `apps/web/src/components/cases/clustering-debug.tsx`

- [ ] **Step 1: Verify new routes work before deleting old ones**

Navigate through all new routes to confirm they work:
- `/onboarding/category` through `/onboarding/review`
- `/feed` and `/feed/[caseId]`
- `/settings` and `/settings/topics`

- [ ] **Step 2: Delete old routes and components**

```bash
rm -rf apps/web/src/app/interview/
rm -rf apps/web/src/app/dashboard/
rm -f apps/web/src/hooks/use-interview-flow.ts
rm -f apps/web/src/hooks/use-interview-scan.ts
rm -rf apps/web/src/components/dashboard/
rm -f apps/web/src/components/cases/metric-bar.tsx
rm -f apps/web/src/components/cases/clustering-debug.tsx
```

- [ ] **Step 3: Fix any import errors**

```bash
pnpm typecheck 2>&1 | head -50
```

If any remaining files import deleted modules, update or remove those imports.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old interview/dashboard routes and unused components"
```

---

### Task 21: Update Integration Test Fixtures

**Files:**
- Modify: `apps/web/tests/integration/flows/interview.test.ts`

- [ ] **Step 1: Read the current interview test**

Read `apps/web/tests/integration/flows/interview.test.ts` to understand the current fixture shape.

- [ ] **Step 2: Update test fixtures**

Update the `InterviewInput` fixtures to use the flat shape `{ role, domain, whats, whos, groups: [], goals: [] }`. The API still accepts groups and goals (backward compat) but they should be empty arrays in the new tests to match the simplified onboarding flow.

- [ ] **Step 3: Run integration tests**

```bash
pnpm --filter web test:integration 2>&1 | tail -30
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/integration/
git commit -m "test: update interview integration test fixtures for flat input"
```

---

### Task 22: Update E2E Test

**Files:**
- Modify: `apps/web/tests/e2e/home.test.ts`

- [ ] **Step 1: Update home E2E test**

```typescript
// apps/web/tests/e2e/home.test.ts
import { expect, test } from "@playwright/test";

test("landing page loads with Denim branding", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Denim|Case Engine/);
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/tests/e2e/home.test.ts
git commit -m "test: update E2E home test for new branding"
```

---

### Task 23: Final Wave 3 Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm typecheck && pnpm -r test
```

Expected: all unit tests pass

- [ ] **Step 2: Run biome on everything**

```bash
pnpm biome check --write .
```

- [ ] **Step 3: Verify old routes are gone**

Navigate to `/interview` - should 404.
Navigate to `/dashboard` - should 404.

- [ ] **Step 4: Full manual walkthrough**

1. New user: `/` redirects to `/onboarding/category`
2. Complete onboarding O1-O5
3. Redirected to `/feed` with cases
4. Filter by topic chips (instant)
5. Tap case card → detail page
6. Bottom nav: Feed / Settings
7. Settings → My Topics → see schemas
8. Settings → Add a Topic → goes to `/onboarding/category`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Wave 3 complete - settings, cleanup, UX overhaul done"
```
