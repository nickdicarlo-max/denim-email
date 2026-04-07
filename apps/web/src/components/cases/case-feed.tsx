"use client";

import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import { CaseCard, type CaseCardData } from "./case-card";
import { FilterTabs } from "./filter-tabs";

import { ScopeHeaders } from "./scope-headers";

interface CaseFeedProps {
  schemaId: string;
  initialCases: CaseCardData[];
  initialNextCursor: string | null;
  entities: { id: string; name: string; emailCount: number }[];
  statusCounts: Record<string, number>;
  qualityPhase: string;
}

type StatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "RESOLVED";

const URGENCY_SECTIONS = [
  { key: "IMMINENT", title: "Focus Now", icon: "priority_high" },
  { key: "THIS_WEEK", title: "This Week", icon: "date_range" },
  { key: "UPCOMING", title: "Upcoming", icon: "upcoming" },
  { key: "NO_ACTION", title: "No Action Needed", icon: "check_circle" },
] as const;

function groupByUrgency(cases: CaseCardData[]): Record<string, CaseCardData[]> {
  const groups: Record<string, CaseCardData[]> = {};
  for (const c of cases) {
    const key = c.urgency ?? "UPCOMING";
    if (key === "IRRELEVANT") continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }
  return groups;
}

export function CaseFeed({
  schemaId,
  initialCases,
  initialNextCursor,
  entities,
  statusCounts,
  qualityPhase: _qualityPhase,
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
        if (statusFilter === "OPEN") params.set("status", "OPEN,IN_PROGRESS");
        else if (statusFilter !== "ALL") params.set("status", statusFilter);
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

  function handleFilterChange(params: { status?: StatusFilter; entityId?: string | null }) {
    const newStatus = params.status ?? statusFilter;
    const newEntity = params.entityId !== undefined ? params.entityId : entityFilter;

    if (params.status !== undefined) setStatusFilter(newStatus);
    if (params.entityId !== undefined) setEntityFilter(newEntity);
    setNextCursor(null);
    setCases([]);

    setTimeout(() => {
      const p = new URLSearchParams({ schemaId, limit: "20" });
      if (newStatus === "OPEN") p.set("status", "OPEN,IN_PROGRESS");
      else if (newStatus !== "ALL") p.set("status", newStatus);
      if (newEntity) p.set("entityId", newEntity);

      setLoading(true);
      import("@/lib/supabase/client").then(({ createBrowserClient }) => {
        const supabase = createBrowserClient();
        supabase.auth.getSession().then(({ data: { session } }) => {
          fetch(`/api/cases?${p}`, {
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

  const grouped = groupByUrgency(cases);
  const hasAnyCases = cases.length > 0;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="space-y-3">
        {entities.length > 1 && (
          <ScopeHeaders
            entities={entities}
            activeEntityId={entityFilter}
            onEntityChange={(id) => handleFilterChange({ entityId: id })}
          />
        )}

        <FilterTabs
          statusCounts={statusCounts}
          activeStatus={statusFilter}
          onStatusChange={(s) => handleFilterChange({ status: s })}
        />
      </div>

      {/* Content */}
      {loading && cases.length === 0 ? (
        <LoadingSkeleton />
      ) : !hasAnyCases ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {URGENCY_SECTIONS.map(({ key, title, icon }) => {
            const sectionCases = grouped[key];
            if (!sectionCases?.length) return null;
            return (
              <section key={key}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[20px] text-secondary">
                    {icon}
                  </span>
                  <h2 className="font-serif text-lg font-bold text-primary tracking-wide">
                    {title}
                  </h2>
                </div>
                <div className="space-y-3">
                  {sectionCases.map((c) => (
                    <CaseCard key={c.id} caseData={c} schemaId={schemaId} />
                  ))}
                </div>
              </section>
            );
          })}
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

function EmptyState() {
  return (
    <div className="text-center py-12 px-6">
      <span className="material-symbols-outlined text-[48px] text-secondary mb-4 block">
        auto_awesome
      </span>
      <h3 className="font-serif text-xl font-bold text-primary mb-2">All caught up!</h3>
      <p className="text-sm text-secondary max-w-sm mx-auto leading-relaxed">
        You've managed all your immediate tasks. Enjoy the quiet moments before the next big thing.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-lg p-6 border-l-4 border-l-surface-highest">
          <div className="h-4 bg-surface-mid rounded w-3/4 mb-3" />
          <div className="h-3 bg-surface-mid rounded w-1/2 mb-2" />
          <div className="h-3 bg-surface-mid rounded w-full" />
        </div>
      ))}
    </div>
  );
}
