"use client";

interface SchemaChip {
  id: string;
  name: string;
  caseCount: number;
  entities: { id: string; name: string; caseCount: number }[];
}

interface TopicChipsProps {
  schemas: SchemaChip[];
  activeSchemaId: string | null;
  activeEntityId: string | null;
  onSchemaChange: (id: string | null) => void;
  onEntityChange: (id: string | null) => void;
}

export function TopicChips({
  schemas,
  activeSchemaId,
  activeEntityId,
  onSchemaChange,
  onEntityChange,
}: TopicChipsProps) {
  const activeSchema = activeSchemaId ? schemas.find((s) => s.id === activeSchemaId) : null;

  return (
    <div className="space-y-2 px-6">
      {/* Topic row */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => {
            onSchemaChange(null);
            onEntityChange(null);
          }}
          className={[
            "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all cursor-pointer shrink-0",
            activeSchemaId === null
              ? "bg-accent text-inverse"
              : "bg-surface-highest text-secondary",
          ].join(" ")}
        >
          All
        </button>
        {schemas.map((schema) => (
          <button
            key={schema.id}
            type="button"
            onClick={() => {
              onSchemaChange(activeSchemaId === schema.id ? null : schema.id);
              onEntityChange(null);
            }}
            className={[
              "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all cursor-pointer shrink-0",
              activeSchemaId === schema.id
                ? "bg-accent text-inverse"
                : "bg-surface-highest text-secondary",
            ].join(" ")}
          >
            {schema.name}
          </button>
        ))}
      </div>

      {/* Entity sub-chips */}
      {activeSchema && activeSchema.entities.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pl-2">
          {activeSchema.entities.map((entity) => (
            <button
              key={entity.id}
              type="button"
              onClick={() => onEntityChange(activeEntityId === entity.id ? null : entity.id)}
              className={[
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer shrink-0",
                activeEntityId === entity.id
                  ? "bg-accent-soft text-accent-text"
                  : "bg-surface-high text-secondary",
              ].join(" ")}
            >
              {entity.name} ({entity.caseCount})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
