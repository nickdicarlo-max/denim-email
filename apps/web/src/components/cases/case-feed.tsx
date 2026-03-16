"use client";

import { useState, useCallback } from "react";
import { CaseCard, type CaseCardData } from "./case-card";
import { FilterTabs } from "./filter-tabs";
import { MetricBar } from "./metric-bar";
import { ScopeHeaders } from "./scope-headers";
import { Button } from "../ui/button";

interface CaseFeedProps {
	schemaId: string;
	initialCases: CaseCardData[];
	initialNextCursor: string | null;
	entities: { id: string; name: string; emailCount: number }[];
	statusCounts: Record<string, number>;
}

type StatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "RESOLVED";

export function CaseFeed({
	schemaId,
	initialCases,
	initialNextCursor,
	entities,
	statusCounts,
}: CaseFeedProps) {
	const [cases, setCases] = useState(initialCases);
	const [nextCursor, setNextCursor] = useState(initialNextCursor);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
	const [entityFilter, setEntityFilter] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const fetchCases = useCallback(
		async (cursor?: string) => {
			setLoading(true);
			try {
				const params = new URLSearchParams({ schemaId, limit: "20" });
				if (statusFilter !== "ALL") params.set("status", statusFilter);
				if (entityFilter) params.set("entityId", entityFilter);
				if (cursor) params.set("cursor", cursor);

				const { createBrowserClient } = await import("@/lib/supabase/client");
				const supabase = createBrowserClient();
				const {
					data: { session },
				} = await supabase.auth.getSession();

				const res = await fetch(`/api/cases?${params}`, {
					headers: {
						Authorization: `Bearer ${session?.access_token ?? ""}`,
					},
				});

				if (!res.ok) return;

				const body = await res.json();
				const newCases = body.data.cases as CaseCardData[];

				if (cursor) {
					setCases((prev) => [...prev, ...newCases]);
				} else {
					setCases(newCases);
				}
				setNextCursor(body.data.nextCursor);
			} finally {
				setLoading(false);
			}
		},
		[schemaId, statusFilter, entityFilter],
	);

	function handleStatusChange(status: StatusFilter) {
		setStatusFilter(status);
		setNextCursor(null);
		setCases([]);
		// Trigger fetch after state update
		setTimeout(() => {
			const params = new URLSearchParams({ schemaId, limit: "20" });
			if (status !== "ALL") params.set("status", status);
			if (entityFilter) params.set("entityId", entityFilter);

			setLoading(true);
			import("@/lib/supabase/client").then(({ createBrowserClient }) => {
				const supabase = createBrowserClient();
				supabase.auth.getSession().then(({ data: { session } }) => {
					fetch(`/api/cases?${params}`, {
						headers: {
							Authorization: `Bearer ${session?.access_token ?? ""}`,
						},
					})
						.then((res) => res.json())
						.then((body) => {
							setCases(body.data.cases);
							setNextCursor(body.data.nextCursor);
						})
						.finally(() => setLoading(false));
				});
			});
		}, 0);
	}

	function handleEntityChange(entityId: string | null) {
		setEntityFilter(entityId);
		setNextCursor(null);
		setCases([]);
		setTimeout(() => {
			const params = new URLSearchParams({ schemaId, limit: "20" });
			if (statusFilter !== "ALL") params.set("status", statusFilter);
			if (entityId) params.set("entityId", entityId);

			setLoading(true);
			import("@/lib/supabase/client").then(({ createBrowserClient }) => {
				const supabase = createBrowserClient();
				supabase.auth.getSession().then(({ data: { session } }) => {
					fetch(`/api/cases?${params}`, {
						headers: {
							Authorization: `Bearer ${session?.access_token ?? ""}`,
						},
					})
						.then((res) => res.json())
						.then((body) => {
							setCases(body.data.cases);
							setNextCursor(body.data.nextCursor);
						})
						.finally(() => setLoading(false));
				});
			});
		}, 0);
	}

	const filteredCases = cases;

	return (
		<div className="space-y-4">
			<MetricBar phase="CALIBRATING" />

			{entities.length > 1 && (
				<ScopeHeaders
					entities={entities}
					activeEntityId={entityFilter}
					onEntityChange={handleEntityChange}
				/>
			)}

			<FilterTabs
				statusCounts={statusCounts}
				activeStatus={statusFilter}
				onStatusChange={handleStatusChange}
			/>

			{loading && cases.length === 0 ? (
				<p className="text-sm text-muted text-center py-8">Loading cases...</p>
			) : filteredCases.length === 0 ? (
				<p className="text-sm text-muted text-center py-8">No cases found.</p>
			) : (
				<div className="space-y-3">
					{filteredCases.map((c) => (
						<CaseCard key={c.id} caseData={c} schemaId={schemaId} />
					))}
				</div>
			)}

			{nextCursor && (
				<div className="flex justify-center pt-4">
					<Button
						variant="secondary"
						fullWidth={false}
						onClick={() => fetchCases(nextCursor)}
						disabled={loading}
					>
						{loading ? "Loading..." : "Load more"}
					</Button>
				</div>
			)}
		</div>
	);
}
