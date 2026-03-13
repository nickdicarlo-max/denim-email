"use client";

interface TagProps {
  label: string;
  active?: boolean;
  actionable?: boolean;
  size?: "sm" | "md";
  onToggle?: () => void;
  onRemove?: () => void;
}

const sizeClasses = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1.5 text-sm",
};

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6L18 18" />
    </svg>
  );
}

export function Tag({
  label,
  active = true,
  actionable = false,
  size = "md",
  onToggle,
  onRemove,
}: TagProps) {
  let colorClasses: string;
  if (active && actionable) {
    colorClasses = "bg-warning-soft text-warning-text";
  } else if (active) {
    colorClasses = "bg-accent-soft text-accent-text";
  } else {
    colorClasses = "bg-subtle text-muted line-through opacity-60";
  }

  const classes = [
    "inline-flex items-center gap-1 rounded-full font-medium transition",
    sizeClasses[size],
    colorClasses,
    onToggle ? "cursor-pointer" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      onClick={onToggle}
      onKeyDown={
        onToggle
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onToggle();
            }
          : undefined
      }
      role={onToggle ? "button" : undefined}
      tabIndex={onToggle ? 0 : undefined}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 hover:opacity-70"
          aria-label={`Remove ${label}`}
        >
          <CloseIcon />
        </button>
      )}
    </span>
  );
}
