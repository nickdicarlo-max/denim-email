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
        <h3 className="font-serif text-xl font-bold text-primary mb-2">Welcome to Denim</h3>
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
      <h3 className="font-serif text-xl font-bold text-primary mb-2">All caught up!</h3>
      <p className="text-sm text-secondary max-w-sm mx-auto">
        Nothing needs your attention right now.
      </p>
    </div>
  );
}
