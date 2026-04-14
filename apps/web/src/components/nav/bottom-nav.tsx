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
