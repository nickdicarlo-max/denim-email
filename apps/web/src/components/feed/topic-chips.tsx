"use client";

/**
 * Phase 3 — chip row renders user hints first, confirmed discoveries second.
 *
 * `EntityChip.origin === "USER_HINT"` chips are the WHATs the user typed
 * during onboarding and represent ground truth. They render first, stylised
 * to signal trust. Everything else ("confirmed discoveries" — entities
 * Stage 1/Stage 2 surfaced and the user approved at the review screen)
 * renders second, sorted by `discoveryScore` descending.
 *
 * Phase 6 (2026-04-23) — "All" tab now renders every schema's entity chips
 * too, grouped by schema with a small divider so a multi-schema user sees
 * soccer + addresses + clients in one glance without having to drill into
 * a specific schema tab.
 */

interface EntityChip {
  id: string;
  name: string;
  caseCount: number;
  origin?: string;
  discoveryScore?: number | null;
}

interface SchemaChip {
  id: string;
  name: string;
  caseCount: number;
  entities: EntityChip[];
  /** Phase 3 — user-typed hints, pre-separated server-side. */
  hintEntities?: EntityChip[];
  /** Phase 3 — confirmed discoveries, pre-separated + sorted by score. */
  discoveryEntities?: EntityChip[];
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
      {/* Top row: schema tabs (unchanged). */}
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

      {/* Entity sub-chips. Two modes:
            1. Specific schema active → render that schema's hints + discoveries.
            2. "All" active → render every schema's chips, grouped with a small
               schema-name divider so multi-schema glance stays legible. */}
      {activeSchema ? (
        <SchemaEntityRow
          schema={activeSchema}
          activeEntityId={activeEntityId}
          onEntityChange={onEntityChange}
        />
      ) : (
        <AllEntityRows
          schemas={schemas}
          activeEntityId={activeEntityId}
          onEntityChange={onEntityChange}
        />
      )}
    </div>
  );
}

function SchemaEntityRow({
  schema,
  activeEntityId,
  onEntityChange,
}: {
  schema: SchemaChip;
  activeEntityId: string | null;
  onEntityChange: (id: string | null) => void;
}) {
  const hints = schema.hintEntities ?? [];
  const discoveries =
    schema.discoveryEntities ?? (schema.entities ?? []).filter((e) => e.origin !== "USER_HINT");
  if (hints.length + discoveries.length <= 1) return null;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pl-2 items-center">
      {hints.map((entity) => (
        <EntityPill
          key={entity.id}
          entity={entity}
          active={activeEntityId === entity.id}
          variant="hint"
          onClick={() => onEntityChange(activeEntityId === entity.id ? null : entity.id)}
        />
      ))}
      {hints.length > 0 && discoveries.length > 0 && (
        <span
          className="text-[11px] text-muted uppercase tracking-wide whitespace-nowrap px-1"
          aria-hidden="true"
        >
          · discovered ·
        </span>
      )}
      {discoveries.map((entity) => (
        <EntityPill
          key={entity.id}
          entity={entity}
          active={activeEntityId === entity.id}
          variant="discovery"
          onClick={() => onEntityChange(activeEntityId === entity.id ? null : entity.id)}
        />
      ))}
    </div>
  );
}

function AllEntityRows({
  schemas,
  activeEntityId,
  onEntityChange,
}: {
  schemas: SchemaChip[];
  activeEntityId: string | null;
  onEntityChange: (id: string | null) => void;
}) {
  // Skip schemas with ≤1 total entity (nothing meaningful to show).
  const visible = schemas.filter((s) => {
    const hints = s.hintEntities ?? [];
    const discoveries =
      s.discoveryEntities ?? (s.entities ?? []).filter((e) => e.origin !== "USER_HINT");
    return hints.length + discoveries.length > 0;
  });
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {visible.map((schema) => {
        const hints = schema.hintEntities ?? [];
        const discoveries =
          schema.discoveryEntities ??
          (schema.entities ?? []).filter((e) => e.origin !== "USER_HINT");
        return (
          <div
            key={schema.id}
            className="flex gap-2 overflow-x-auto no-scrollbar pl-2 items-center"
          >
            <span
              className="text-[10px] uppercase tracking-wide text-muted whitespace-nowrap shrink-0 font-semibold pr-1"
              aria-label={`topics under ${schema.name}`}
            >
              {schema.name}
            </span>
            {hints.map((entity) => (
              <EntityPill
                key={entity.id}
                entity={entity}
                active={activeEntityId === entity.id}
                variant="hint"
                onClick={() => onEntityChange(activeEntityId === entity.id ? null : entity.id)}
              />
            ))}
            {hints.length > 0 && discoveries.length > 0 && (
              <span
                className="text-[10px] text-muted uppercase tracking-wide whitespace-nowrap px-0.5"
                aria-hidden="true"
              >
                ·
              </span>
            )}
            {discoveries.map((entity) => (
              <EntityPill
                key={entity.id}
                entity={entity}
                active={activeEntityId === entity.id}
                variant="discovery"
                onClick={() => onEntityChange(activeEntityId === entity.id ? null : entity.id)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function EntityPill({
  entity,
  active,
  variant,
  onClick,
}: {
  entity: EntityChip;
  active: boolean;
  variant: "hint" | "discovery";
  onClick: () => void;
}) {
  const base =
    "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer shrink-0";
  const activeStyles =
    variant === "hint" ? "bg-accent text-inverse" : "bg-accent-soft text-accent-text";
  const idleStyles =
    variant === "hint"
      ? "bg-accent-soft text-accent-text border border-accent"
      : "bg-surface-high text-secondary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={[base, active ? activeStyles : idleStyles].join(" ")}
      title={
        variant === "hint"
          ? `From your input · ${entity.caseCount} case${entity.caseCount === 1 ? "" : "s"}`
          : `Denim found this · ${entity.caseCount} case${entity.caseCount === 1 ? "" : "s"}`
      }
    >
      {entity.name} ({entity.caseCount})
    </button>
  );
}
