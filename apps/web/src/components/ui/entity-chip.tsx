"use client";

interface EntityChipProps {
  name: string;
  entityType: "PRIMARY" | "SECONDARY";
  onRemove: () => void;
  className?: string;
}

const typeClasses = {
  PRIMARY: "bg-entity-primary-bg text-entity-primary",
  SECONDARY: "bg-entity-secondary-bg text-entity-secondary",
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

export function EntityChip({ name, entityType, onRemove, className }: EntityChipProps) {
  const classes = [
    "inline-flex items-center gap-1.5 rounded-full font-medium text-sm px-3 py-2",
    typeClasses[entityType],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {name}
      <button
        type="button"
        onClick={onRemove}
        className="hover:opacity-70"
        aria-label={`Remove ${name}`}
      >
        <CloseIcon />
      </button>
    </span>
  );
}
