"use client";

import Link from "next/link";

const SETTINGS_ITEMS = [
  {
    icon: "list_alt",
    title: "My Topics",
    subtitle: "Manage what Denim tracks",
    href: "/settings/topics",
  },
  {
    icon: "add_circle",
    title: "Add a Topic",
    subtitle: "Set up a new category",
    href: "/onboarding/category",
  },
  { icon: "person", title: "Account", subtitle: "Email, sign out", href: "#account" },
] as const;

export default function SettingsPage() {
  return (
    <div className="px-6 py-6 max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl font-bold text-primary tracking-wide mb-6">Settings</h1>

      <div className="space-y-2">
        {SETTINGS_ITEMS.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="flex items-center gap-4 p-4 bg-white rounded-lg hover:shadow-md transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[24px] text-accent">{item.icon}</span>
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
