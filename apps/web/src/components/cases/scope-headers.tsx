"use client";

interface ScopeHeadersProps {
  entities: { id: string; name: string; emailCount: number }[];
  activeEntityId: string | null;
  onEntityChange: (entityId: string | null) => void;
}

export function ScopeHeaders({ entities, activeEntityId, onEntityChange }: ScopeHeadersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onEntityChange(null)}
        className={[
          "text-sm font-medium px-3 py-1.5 rounded-full transition-all cursor-pointer",
          activeEntityId === null
            ? "bg-accent text-inverse"
            : "bg-surface-highest text-secondary hover:bg-surface-high",
        ].join(" ")}
      >
        All
      </button>
      {entities.map((entity) => (
        <button
          key={entity.id}
          type="button"
          onClick={() => onEntityChange(activeEntityId === entity.id ? null : entity.id)}
          className={[
            "text-sm font-medium px-3 py-1.5 rounded-full transition-all cursor-pointer",
            activeEntityId === entity.id
              ? "bg-accent-soft text-accent-text"
              : "bg-surface-highest text-secondary hover:bg-surface-high",
          ].join(" ")}
        >
          {entity.name}
        </button>
      ))}
    </div>
  );
}
