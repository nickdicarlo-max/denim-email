"use client";

import { useCallback, useState } from "react";
import { formatRelativeTime } from "@/lib/utils/format-time";

interface Action {
  id: string;
  caseId: string;
  title: string;
  description: string | null;
  actionType: "TASK" | "EVENT" | "PAYMENT" | "DEADLINE" | "RESPONSE";
  dueDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  eventLocation: string | null;
  status: "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED";
  reminderCount: number;
  confidence: number;
  amount: number | null;
  currency: string | null;
}

interface ActionListProps {
  actions: Action[];
  schemaId: string;
}

const TYPE_ICONS: Record<string, string> = {
  TASK: "\u2610",
  EVENT: "\uD83D\uDCC5",
  PAYMENT: "\uD83D\uDCB0",
  DEADLINE: "\u23F0",
  RESPONSE: "\u2709\uFE0F",
};

const STATUS_STYLE: Record<string, { classes: string; icon: string }> = {
  PENDING: { classes: "text-primary", icon: "\u25CB" },
  DONE: { classes: "text-muted line-through", icon: "\u2713" },
  EXPIRED: { classes: "text-error opacity-70", icon: "\u2717" },
  SUPERSEDED: { classes: "text-muted opacity-50 line-through", icon: "\u2192" },
  DISMISSED: { classes: "text-muted opacity-50", icon: "\u2212" },
};

export function ActionList({ actions, schemaId }: ActionListProps) {
  const [items, setItems] = useState(actions);

  const toggleAction = useCallback(async (actionId: string, currentStatus: string) => {
    if (currentStatus !== "PENDING" && currentStatus !== "DONE") return;
    const newStatus = currentStatus === "PENDING" ? "DONE" : "PENDING";

    // Optimistic update
    setItems((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, status: newStatus as Action["status"] } : a)),
    );

    try {
      const { authenticatedFetch } = await import("@/lib/supabase/authenticated-fetch");

      const res = await authenticatedFetch(`/api/actions/${actionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        // Revert on failure
        setItems((prev) =>
          prev.map((a) =>
            a.id === actionId ? { ...a, status: currentStatus as Action["status"] } : a,
          ),
        );
      }
    } catch {
      // Revert on error
      setItems((prev) =>
        prev.map((a) =>
          a.id === actionId ? { ...a, status: currentStatus as Action["status"] } : a,
        ),
      );
    }
  }, []);

  const pending = items.filter((a) => a.status === "PENDING");
  const done = items.filter((a) => a.status === "DONE");
  const other = items.filter((a) => a.status !== "PENDING" && a.status !== "DONE");

  return (
    <section className="bg-white rounded-lg shadow p-4 space-y-3">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Actions ({items.length})
      </h2>

      {pending.length > 0 && (
        <ActionGroup label="Pending" actions={pending} onToggle={toggleAction} />
      )}
      {done.length > 0 && <ActionGroup label="Done" actions={done} onToggle={toggleAction} />}
      {other.length > 0 && <ActionGroup label="Other" actions={other} onToggle={toggleAction} />}
    </section>
  );
}

function ActionGroup({
  label,
  actions,
  onToggle,
}: {
  label: string;
  actions: Action[];
  onToggle: (id: string, status: string) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{label}</h3>
      <div className="space-y-2">
        {actions.map((action) => (
          <ActionItem key={action.id} action={action} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

function ActionItem({
  action,
  onToggle,
}: {
  action: Action;
  onToggle: (id: string, status: string) => void;
}) {
  const style = STATUS_STYLE[action.status] ?? STATUS_STYLE.PENDING;
  const isToggleable = action.status === "PENDING" || action.status === "DONE";

  return (
    <div className={`flex items-start gap-2 text-sm ${style.classes}`}>
      <button
        type="button"
        onClick={() => isToggleable && onToggle(action.id, action.status)}
        className={`flex-shrink-0 mt-0.5 ${isToggleable ? "cursor-pointer hover:opacity-70" : "cursor-default"}`}
        disabled={!isToggleable}
        title={
          isToggleable ? (action.status === "PENDING" ? "Mark done" : "Mark pending") : undefined
        }
      >
        {style.icon}
      </button>
      <span className="flex-shrink-0">{TYPE_ICONS[action.actionType] ?? ""}</span>
      <div className="flex-1 min-w-0">
        <span className="font-medium">{action.title}</span>
        {action.description && <p className="text-xs text-muted mt-0.5">{action.description}</p>}
        <div className="flex items-center gap-2 mt-0.5">
          {action.dueDate && (
            <span className="text-xs text-muted">
              Due {formatRelativeTime(new Date(action.dueDate))}
            </span>
          )}
          {action.eventLocation && (
            <span className="text-xs text-muted">{action.eventLocation}</span>
          )}
          {action.amount != null && (
            <span className="text-xs font-medium">
              ${action.amount.toLocaleString()} {action.currency ?? "USD"}
            </span>
          )}
          {action.reminderCount > 0 && (
            <span className="text-xs text-muted">({action.reminderCount} reminders)</span>
          )}
          {action.confidence < 0.7 && <span className="text-xs text-amber-600">?</span>}
        </div>
      </div>
    </div>
  );
}
