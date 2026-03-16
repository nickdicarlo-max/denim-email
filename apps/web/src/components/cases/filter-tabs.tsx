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

export function FilterTabs({
	statusCounts,
	activeStatus,
	onStatusChange,
}: FilterTabsProps) {
	const totalCount =
		(statusCounts.OPEN ?? 0) +
		(statusCounts.IN_PROGRESS ?? 0) +
		(statusCounts.RESOLVED ?? 0);

	function getCount(key: StatusFilter): number {
		if (key === "ALL") return totalCount;
		if (key === "OPEN")
			return (statusCounts.OPEN ?? 0) + (statusCounts.IN_PROGRESS ?? 0);
		return statusCounts[key] ?? 0;
	}

	return (
		<div className="flex gap-1 border-b border-border">
			{TABS.map((tab) => {
				const isActive = activeStatus === tab.key;
				return (
					<button
						key={tab.key}
						type="button"
						onClick={() => onStatusChange(tab.key)}
						className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
							isActive
								? "border-accent text-accent-text"
								: "border-transparent text-muted hover:text-secondary"
						}`}
					>
						{tab.label}
						<span className="ml-1.5 text-xs opacity-70">{getCount(tab.key)}</span>
					</button>
				);
			})}
		</div>
	);
}
