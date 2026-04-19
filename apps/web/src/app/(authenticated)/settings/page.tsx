"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { onboardingStorage } from "@/lib/onboarding-storage";

type SettingsItem = {
  icon: string;
  title: string;
  subtitle: string;
  href: string;
  kind: "link" | "new-topic";
};

const SETTINGS_ITEMS: readonly SettingsItem[] = [
  {
    icon: "list_alt",
    title: "My Topics",
    subtitle: "Manage what Denim tracks",
    href: "/settings/topics",
    kind: "link",
  },
  {
    icon: "add_circle",
    title: "Add a Topic",
    subtitle: "Set up a new category",
    href: "/onboarding/category",
    kind: "new-topic",
  },
  {
    icon: "person",
    title: "Account",
    subtitle: "Email, sign out",
    href: "#account",
    kind: "link",
  },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  // Issue #113: starting a new topic must not inherit prior schema's
  // sessionStorage draft. Clear it before navigating.
  const startNewTopic = () => {
    onboardingStorage.clearAll();
    router.push("/onboarding/category");
  };

  const rowClass =
    "flex items-center gap-4 p-4 bg-white rounded-lg hover:shadow-md transition-all cursor-pointer w-full text-left";
  const renderBody = (item: SettingsItem) => (
    <>
      <span className="material-symbols-outlined text-[24px] text-accent">{item.icon}</span>
      <div>
        <h3 className="text-md font-semibold text-primary">{item.title}</h3>
        <p className="text-sm text-secondary">{item.subtitle}</p>
      </div>
      <span className="material-symbols-outlined text-[20px] text-muted ml-auto">
        chevron_right
      </span>
    </>
  );

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl font-bold text-primary tracking-wide mb-6">Settings</h1>

      <div className="space-y-2">
        {SETTINGS_ITEMS.map((item) =>
          item.kind === "new-topic" ? (
            <button key={item.title} type="button" onClick={startNewTopic} className={rowClass}>
              {renderBody(item)}
            </button>
          ) : (
            <Link key={item.title} href={item.href} className={rowClass}>
              {renderBody(item)}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
