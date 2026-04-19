"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { onboardingStorage } from "@/lib/onboarding-storage";

type Variant = "processing" | "caught-up" | "no-topics";

export function FeedEmptyState({ variant }: { variant: Variant }) {
  const router = useRouter();
  // Issue #113: Get Started must not inherit prior schema's sessionStorage
  // draft (e.g. if a user had a completed schema that was deleted).
  const startNewTopic = () => {
    onboardingStorage.clearAll();
    router.push("/onboarding/category");
  };

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
        <h3 className="font-serif text-xl font-bold text-primary mb-2">Welcome to Denim</h3>
        <p className="text-sm text-secondary mb-6 max-w-sm mx-auto">
          Set up your first topic to get started.
        </p>
        <Button variant="primary" fullWidth={false} onClick={startNewTopic}>
          Get Started
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center py-12 px-6">
      <span className="material-symbols-outlined text-[48px] text-secondary block mb-4">
        auto_awesome
      </span>
      <h3 className="font-serif text-xl font-bold text-primary mb-2">All caught up!</h3>
      <p className="text-sm text-secondary max-w-sm mx-auto">
        Nothing needs your attention right now.
      </p>
    </div>
  );
}
