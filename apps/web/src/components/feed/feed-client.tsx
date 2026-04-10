"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CaseCard, type CaseCardData } from "@/components/cases/case-card";
import { createBrowserClient } from "@/lib/supabase/client";
import { FeedEmptyState } from "./empty-state";
import { FeedHeader } from "./feed-header";
import { TopicChips } from "./topic-chips";

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

export function FeedClient({ avatarUrl }: { avatarUrl?: string | null }) {
  const searchParams = useSearchParams();
  const [cases, setCases] = useState<FeedCaseData[]>([]);
  const [schemas, setSchemas] = useState<FeedSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSchemaId, setActiveSchemaId] = useState<string | null>(() =>
    searchParams.get("schema"),
  );
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
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
        <div className="space-y-3 mt-2 pb-4 px-6">
          {filtered.map((c) => (
            <CaseCard key={c.id} caseData={c} schemaId={c.schemaId} schemaDomain={c.schemaDomain} />
          ))}
        </div>
      )}
    </>
  );
}
