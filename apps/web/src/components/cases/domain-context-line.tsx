interface DomainContextLineProps {
  domain: string;
  actions: {
    actionType: string;
    eventStartTime?: string | null;
    eventLocation?: string | null;
    dueDate?: string | null;
    amount?: number | null;
    currency?: string | null;
  }[];
  lastSenderName?: string | null;
}

export function DomainContextLine({ domain, actions, lastSenderName }: DomainContextLineProps) {
  const parts: string[] = [];

  if (domain === "school_parent") {
    const event = actions.find((a) => a.actionType === "EVENT" && a.eventStartTime);
    if (event?.eventStartTime) {
      const d = new Date(event.eventStartTime);
      parts.push(
        d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      );
      parts.push(
        d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
      if (event.eventLocation) parts.push(event.eventLocation);
    }
  } else if (domain === "property") {
    if (lastSenderName) parts.push(lastSenderName);
    const payment = actions.find((a) => a.actionType === "PAYMENT" && a.amount);
    if (payment?.amount) {
      const formatted =
        payment.amount >= 1000 ? `$${(payment.amount / 1000).toFixed(1)}k` : `$${payment.amount}`;
      parts.push(formatted);
    }
    const deadline = actions.find((a) => a.dueDate);
    if (deadline?.dueDate) {
      const d = new Date(deadline.dueDate);
      parts.push(
        d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      );
    }
  }

  // Fallback for any domain
  if (parts.length === 0) {
    const deadline = actions.find((a) => a.dueDate);
    if (deadline?.dueDate) {
      const d = new Date(deadline.dueDate);
      parts.push(
        `Due ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
      );
    }
    const payment = actions.find((a) => a.actionType === "PAYMENT" && a.amount);
    if (payment?.amount) parts.push(`$${payment.amount}`);
  }

  if (parts.length === 0) return null;

  return <p className="text-sm text-muted truncate">{parts.join(" \u00B7 ")}</p>;
}
