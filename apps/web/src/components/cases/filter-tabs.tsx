"use client";

type StatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "RESOLVED";

interface FilterTabsProps {
  statusCounts: Record<string, number>;
  activeStatus: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
}

const TABS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Active" },
  { key: "RESOLVED", label: "Resolved" },
];

export function FilterTabs({ statusCounts, activeStatus, onStatusChange }: FilterTabsProps) {
  const totalCount =
    (statusCounts.OPEN ?? 0) + (statusCounts.IN_PROGRESS ?? 0) + (statusCounts.RESOLVED ?? 0);

  function getCount(key: StatusFilter): number {
    if (key === "ALL") return totalCount;
    if (key === "OPEN") return (statusCounts.OPEN ?? 0) + (statusCounts.IN_PROGRESS ?? 0);
    return statusCounts[key] ?? 0;
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {TABS.map((tab) => {
        const isActive = activeStatus === tab.key;
        const count = getCount(tab.key);
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onStatusChange(tab.key)}
            className={[
              "px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer",
              isActive
                ? "bg-accent text-inverse shadow-sm"
                : "bg-surface-highest text-secondary hover:bg-surface-high",
            ].join(" ")}
          >
            {tab.label}
            {count > 0 && (
              <span
                className={["ml-1.5 text-xs", isActive ? "opacity-80" : "opacity-60"].join(" ")}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
