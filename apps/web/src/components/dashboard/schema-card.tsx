"use client";

import { formatRelativeTime } from "@/lib/utils/format-time";
import Link from "next/link";
import { useState } from "react";
import { Button } from "../ui/button";
import { CardShell } from "../ui/card-shell";
import { Tag } from "../ui/tag";

type SchemaStatus = "DRAFT" | "ONBOARDING" | "ACTIVE" | "PAUSED";

interface SchemaCardProps {
  schema: {
    id: string;
    name: string;
    domain: string | null;
    status: SchemaStatus;
    emailCount: number;
    caseCount: number;
    updatedAt: string;
  };
  onDeleted: (id: string) => void;
}

const STATUS_CONFIG: Record<SchemaStatus, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: "bg-amber-400" },
  ONBOARDING: { label: "Onboarding", color: "bg-amber-400" },
  ACTIVE: { label: "Active", color: "bg-green-500" },
  PAUSED: { label: "Paused", color: "bg-gray-400" },
};

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

export function SchemaCard({ schema, onDeleted }: SchemaCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const statusConfig = STATUS_CONFIG[schema.status] ?? STATUS_CONFIG.PAUSED;

  async function handleDelete() {
    setDeleting(true);
    try {
      const supabaseModule = await import("@/lib/supabase/client");
      const supabase = supabaseModule.createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`/api/schemas/${schema.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
      });

      if (res.ok) {
        onDeleted(schema.id);
      } else {
        setDeleting(false);
        setConfirming(false);
      }
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <CardShell className="flex flex-col gap-3 hover:shadow-md hover:border-accent/30 border border-transparent transition-all">
      <div className="flex items-start justify-between">
        <Link href={`/dashboard/${schema.id}`} className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-primary truncate">{schema.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            {schema.domain && <Tag label={schema.domain} size="sm" />}
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
              {statusConfig.label}
            </span>
          </div>
        </Link>

        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="p-1.5 text-muted hover:text-error transition rounded"
            aria-label={`Delete ${schema.name}`}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-secondary">
        <Link href={`/dashboard/${schema.id}`}>
          <span>{schema.emailCount} emails</span>
        </Link>
        {schema.caseCount > 0 ? (
          <Link
            href={`/dashboard/${schema.id}/cases`}
            className="text-accent-text hover:underline font-medium"
          >
            {schema.caseCount} cases
          </Link>
        ) : (
          <span>{schema.caseCount} cases</span>
        )}
        <span className="ml-auto">{formatRelativeTime(new Date(schema.updatedAt))}</span>
      </div>

      {confirming && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <p className="text-xs text-error flex-1">
            Delete {schema.name}? Cannot be undone.
          </p>
          <Button
            variant="ghost"
            fullWidth={false}
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="text-xs px-2 py-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            fullWidth={false}
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700"
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      )}
    </CardShell>
  );
}
