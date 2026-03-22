"use client";

import type { EntityGroupInput, HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useCallback, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "../ui/button";
import { CardShell } from "../ui/card-shell";
import { EntityChip } from "../ui/entity-chip";
import { Input } from "../ui/input";
import { ProgressDots } from "../ui/progress-dots";
import { Tag } from "../ui/tag";

interface Card4Props {
  hypothesis: SchemaHypothesis;
  validation: HypothesisValidation;
  discoveries?: unknown[];
  groups?: EntityGroupInput[];
  isLoading?: boolean;
  onFinalize: (confirmations: {
    confirmedEntities: string[];
    removedEntities: string[];
    confirmedTags: string[];
    removedTags: string[];
    addedEntities?: string[];
    addedTags?: string[];
    schemaName?: string;
    groups?: EntityGroupInput[];
  }) => void;
  onBack: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wider uppercase text-accent-text mb-2">
      {children}
    </h3>
  );
}

function PlusIcon() {
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
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function EyeIcon() {
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
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ArrowLeftIcon() {
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
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function confidenceBadgeClasses(score: number): string {
  if (score >= 0.7) return "bg-success-soft text-success-text";
  if (score >= 0.4) return "bg-warning-soft text-warning-text";
  return "bg-error-soft text-error-text";
}

function LinkIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13" />
    </svg>
  );
}

// --- Drag-and-drop components ---

function DraggableEntityChip({
  entity,
  isRemoved,
  onRemove,
}: {
  entity: { name: string; type: "PRIMARY" | "SECONDARY"; emailCount?: number };
  isRemoved: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `discovered-${entity.name}`,
    data: { entityName: entity.name, entityType: entity.type },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between p-2 rounded-md border border-border-light transition mb-1.5 ${
        isRemoved ? "opacity-40" : ""
      } ${isDragging ? "opacity-30" : ""}`}
    >
      <div
        className="flex items-center gap-2 min-w-0 cursor-grab active:cursor-grabbing touch-none"
        {...listeners}
        {...attributes}
      >
        <EntityChip
          name={entity.name}
          entityType={entity.type}
          onRemove={onRemove}
        />
        <span className={`text-xs truncate ${entity.emailCount != null && entity.emailCount <= 1 ? "text-orange-500" : "text-muted"}`}>
          {entity.emailCount != null ? `${entity.emailCount} email${entity.emailCount !== 1 ? "s" : ""}` : "Discovered in email"}
        </span>
      </div>
    </div>
  );
}

function DroppableGroupCard({
  groupIndex,
  children,
}: {
  groupIndex: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${groupIndex}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`p-3 rounded-lg border-[1.5px] transition-colors ${
        isOver
          ? "border-accent bg-accent-soft/30"
          : "border-border bg-white"
      }`}
    >
      {children}
      {isOver && (
        <div className="text-[10px] font-medium text-accent-text text-center mt-2 py-1">
          Drop here
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export function Card4Review({ hypothesis, validation, groups, isLoading, onFinalize, onBack }: Card4Props) {
  const [schemaName, setSchemaName] = useState(hypothesis.schemaName);
  const [removedEntities, setRemovedEntities] = useState<Set<string>>(() => new Set());
  const [addedEntities, setAddedEntities] = useState<string[]>([]);
  const [removedTags, setRemovedTags] = useState<Set<string>>(() => new Set());
  const [confirmedSuggestedTags, setConfirmedSuggestedTags] = useState<Set<string>>(
    () => new Set(),
  );
  const [addedTags, setAddedTags] = useState<string[]>([]);
  const [entityGroupAssignments, setEntityGroupAssignments] = useState<Map<string, number>>(() => new Map());

  // Drag-and-drop active item for overlay
  const [activeDragEntity, setActiveDragEntity] = useState<{
    name: string;
    type: "PRIMARY" | "SECONDARY";
  } | null>(null);

  // Add entity inline form state
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");

  // Add tag inline form state
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  // Sensors: touch (long-press 250ms) + mouse (5px distance)
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 5 },
  });
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 5 },
  });
  const sensors = useSensors(touchSensor, mouseSensor);

  const handleRemoveEntity = useCallback((name: string) => {
    setRemovedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
    // Also clear from group assignments if removed
    setEntityGroupAssignments((prev) => {
      if (prev.has(name)) {
        const next = new Map(prev);
        next.delete(name);
        return next;
      }
      return prev;
    });
  }, []);

  const handleRemoveAddedEntity = useCallback((name: string) => {
    setAddedEntities((prev) => prev.filter((e) => e !== name));
  }, []);

  const handleAddEntity = useCallback(() => {
    const trimmed = newEntityName.trim();
    if (trimmed) {
      setAddedEntities((prev) => [...prev, trimmed]);
      setNewEntityName("");
      setAddingEntity(false);
    }
  }, [newEntityName]);

  const handleToggleTag = useCallback((name: string) => {
    setRemovedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleToggleSuggestedTag = useCallback((name: string) => {
    setConfirmedSuggestedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleAddTag = useCallback(() => {
    const trimmed = newTagName.trim();
    if (trimmed) {
      setAddedTags((prev) => [...prev, trimmed]);
      setNewTagName("");
      setAddingTag(false);
    }
  }, [newTagName]);

  const handleAssignToGroup = useCallback((entityName: string, groupIndex: number) => {
    setEntityGroupAssignments((prev) => {
      const next = new Map(prev);
      next.set(entityName, groupIndex);
      return next;
    });
  }, []);

  const handleUnassignFromGroup = useCallback((entityName: string) => {
    setEntityGroupAssignments((prev) => {
      const next = new Map(prev);
      next.delete(entityName);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((event: DragEndEvent) => {
    const data = event.active.data.current as { entityName?: string; entityType?: "PRIMARY" | "SECONDARY" } | undefined;
    if (data?.entityName && data?.entityType) {
      setActiveDragEntity({ name: data.entityName, type: data.entityType });
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragEntity(null);
    const { active, over } = event;
    if (!over) return;

    const entityName = active.data.current?.entityName as string | undefined;
    const dropId = over.id as string;
    if (!entityName || !dropId.startsWith("group-")) return;

    const groupIndex = Number.parseInt(dropId.replace("group-", ""), 10);
    if (!Number.isNaN(groupIndex)) {
      handleAssignToGroup(entityName, groupIndex);
    }
  }, [handleAssignToGroup]);

  const handleFinalize = useCallback(() => {
    // Build updated groups with assigned discovered entities merged in
    const updatedGroups = groups?.map((group, gi) => {
      const assignedToThisGroup = validation.discoveredEntities.filter(
        (e) => entityGroupAssignments.get(e.name) === gi && !removedEntities.has(e.name),
      );
      return {
        whats: [
          ...group.whats,
          ...assignedToThisGroup.filter((e) => e.type === "PRIMARY").map((e) => e.name),
        ],
        whos: [
          ...group.whos,
          ...assignedToThisGroup.filter((e) => e.type === "SECONDARY").map((e) => e.name),
        ],
      };
    });

    const confirmations = {
      confirmedEntities: validation.discoveredEntities
        .filter((e) => !removedEntities.has(e.name))
        .map((e) => e.name),
      removedEntities: Array.from(removedEntities),
      confirmedTags: [
        ...hypothesis.tags.filter((t) => !removedTags.has(t.name)).map((t) => t.name),
        ...Array.from(confirmedSuggestedTags),
      ],
      removedTags: Array.from(removedTags),
      addedEntities: addedEntities.length > 0 ? addedEntities : undefined,
      addedTags: addedTags.length > 0 ? addedTags : undefined,
      schemaName,
      groups: updatedGroups,
    };
    onFinalize(confirmations);
  }, [
    validation.discoveredEntities,
    removedEntities,
    hypothesis.tags,
    removedTags,
    confirmedSuggestedTags,
    addedEntities,
    addedTags,
    schemaName,
    groups,
    entityGroupAssignments,
    onFinalize,
  ]);

  const { clusteringConfig } = hypothesis;

  // Compute unassigned discovered entities
  const unassignedDiscovered = validation.discoveredEntities.filter(
    (e) => !entityGroupAssignments.has(e.name) && !removedEntities.has(e.name),
  );

  const hasGroups = groups && groups.length > 0;

  return (
    <CardShell className="flex flex-col h-full">
      {/* Back button */}
      <div className="mb-2">
        <Button
          variant="ghost"
          onClick={onBack}
          className="w-auto inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon />
          Back
        </Button>
      </div>

      {/* Header */}
      <ProgressDots current={3} total={4} />
      <div className="px-1 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold text-primary tracking-tight">Review your setup</h2>
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${confidenceBadgeClasses(validation.confidenceScore)}`}
          >
            {Math.round(validation.confidenceScore * 100)}% match
          </span>
        </div>
        <p className="text-sm text-secondary leading-snug">
          Here&apos;s what we found. Toggle items to customize.
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-5 px-1 pb-4">
        {/* Schema Name */}
        <div>
          <SectionLabel>Schema Name</SectionLabel>
          <Input
            value={schemaName}
            onChange={(e) => setSchemaName(e.target.value)}
            placeholder="Name for this schema"
          />
        </div>

        {/* Primary Entity Type */}
        <div>
          <SectionLabel>Primary Entity Type</SectionLabel>
          <div className="bg-subtle rounded-md p-3">
            <p className="text-sm font-medium text-primary">{hypothesis.primaryEntity.name}</p>
            <p className="text-xs text-secondary mt-0.5">{hypothesis.primaryEntity.description}</p>
          </div>
        </div>

        {/* Entities */}
        <div>
          <SectionLabel>Entities</SectionLabel>
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="space-y-2">
              {hasGroups ? (
                <>
                  {/* Group cards — mirrors Card 1 visual structure */}
                  {groups.map((group, gi) => {
                    const groupWhats = hypothesis.entities.filter(
                      (e) => e.type === "PRIMARY" && group.whats.includes(e.name),
                    );
                    const groupWhos = hypothesis.entities.filter(
                      (e) => e.type === "SECONDARY" && group.whos.includes(e.name),
                    );
                    // Discovered entities assigned to this group
                    const assignedDiscovered = validation.discoveredEntities.filter(
                      (e) => entityGroupAssignments.get(e.name) === gi && !removedEntities.has(e.name),
                    );
                    if (groupWhats.length === 0 && groupWhos.length === 0 && assignedDiscovered.length === 0) return null;
                    return (
                      <DroppableGroupCard key={gi} groupIndex={gi}>
                        {groups.length > 1 && (
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                            Group {gi + 1}
                          </div>
                        )}
                        {/* WHATs */}
                        <div className="flex flex-wrap gap-1.5 mb-1">
                          {groupWhats.map((entity) => {
                            const isRemoved = removedEntities.has(entity.name);
                            return (
                              <span
                                key={entity.name}
                                className={`transition ${isRemoved ? "opacity-40" : ""}`}
                              >
                                <EntityChip
                                  name={entity.name}
                                  entityType="PRIMARY"
                                  onRemove={() => handleRemoveEntity(entity.name)}
                                />
                              </span>
                            );
                          })}
                        </div>
                        {/* WHOs linked to this group */}
                        {groupWhos.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border-light">
                            <span className="text-muted"><LinkIcon /></span>
                            <div className="flex flex-wrap gap-1.5">
                              {groupWhos.map((entity) => {
                                const isRemoved = removedEntities.has(entity.name);
                                return (
                                  <span
                                    key={entity.name}
                                    className={`transition ${isRemoved ? "opacity-40" : ""}`}
                                  >
                                    <EntityChip
                                      name={entity.name}
                                      entityType="SECONDARY"
                                      onRemove={() => handleRemoveEntity(entity.name)}
                                    />
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Assigned discovered entities */}
                        {assignedDiscovered.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-dashed border-border-light">
                            <div className="text-[10px] font-medium text-muted mb-1.5">discovered</div>
                            <div className="flex flex-wrap gap-1.5">
                              {assignedDiscovered.map((entity) => (
                                <span key={entity.name} className="inline-flex items-center gap-1">
                                  <EntityChip
                                    name={entity.name}
                                    entityType={entity.type}
                                    onRemove={() => handleRemoveEntity(entity.name)}
                                    className="border border-dashed border-current"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleUnassignFromGroup(entity.name)}
                                    className="text-muted hover:text-accent-text transition p-1"
                                    aria-label={`Unassign ${entity.name}`}
                                    title="Return to discovered"
                                  >
                                    <UndoIcon />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </DroppableGroupCard>
                    );
                  })}

                  {/* Ungrouped entities (not in any group — AI-inferred or standalone) */}
                  {(() => {
                    const groupedNames = new Set(
                      groups.flatMap((g) => [...g.whats, ...g.whos]),
                    );
                    const ungrouped = hypothesis.entities.filter(
                      (e) => !groupedNames.has(e.name),
                    );
                    if (ungrouped.length === 0) return null;
                    return ungrouped.map((entity) => {
                      const isRemoved = removedEntities.has(entity.name);
                      return (
                        <div
                          key={entity.name}
                          className={`flex items-center justify-between p-2 rounded-md border border-border-light transition ${
                            isRemoved ? "opacity-40" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <EntityChip
                              name={entity.name}
                              entityType={entity.type}
                              onRemove={() => handleRemoveEntity(entity.name)}
                            />
                            <span className="text-xs text-muted truncate">
                              {entity.source === "email_scan"
                                ? "Discovered in email"
                                : "AI inferred"}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </>
              ) : (
                /* Fallback: flat list when no groups available */
                hypothesis.entities.map((entity) => {
                  const isRemoved = removedEntities.has(entity.name);
                  return (
                    <div
                      key={entity.name}
                      className={`flex items-center justify-between p-2 rounded-md border border-border-light transition ${
                        isRemoved ? "opacity-40" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <EntityChip
                          name={entity.name}
                          entityType={entity.type}
                          onRemove={() => handleRemoveEntity(entity.name)}
                        />
                        <span className="text-xs text-muted truncate">
                          {entity.source === "user_input"
                            ? "From your input"
                            : entity.source === "email_scan"
                              ? "Discovered in email"
                              : "AI inferred"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Discovered entities from validation — only show unassigned */}
              {unassignedDiscovered.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted mb-1.5 font-medium">
                    {hasGroups
                      ? "Drag into a group above, or remove what you don\u2019t need"
                      : "Discovered"}
                  </p>
                  {unassignedDiscovered.map((entity) => (
                    <DraggableEntityChip
                      key={entity.name}
                      entity={entity}
                      isRemoved={false}
                      onRemove={() => handleRemoveEntity(entity.name)}
                    />
                  ))}
                </div>
              )}

              {/* Removed discovered entities (shown faded, clickable to restore) */}
              {(() => {
                const removedDiscovered = validation.discoveredEntities.filter(
                  (e) => removedEntities.has(e.name) && !entityGroupAssignments.has(e.name),
                );
                if (removedDiscovered.length === 0) return null;
                return removedDiscovered.map((entity) => (
                  <div
                    key={entity.name}
                    className="flex items-center justify-between p-2 rounded-md border border-border-light transition mb-1.5 opacity-40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <EntityChip
                        name={entity.name}
                        entityType={entity.type}
                        onRemove={() => handleRemoveEntity(entity.name)}
                      />
                      <span className="text-xs text-muted truncate">Removed</span>
                    </div>
                  </div>
                ));
              })()}

              {/* User-added entities */}
              {addedEntities.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-2 rounded-md border border-border-light"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <EntityChip
                      name={name}
                      entityType="PRIMARY"
                      onRemove={() => handleRemoveAddedEntity(name)}
                    />
                    <span className="text-xs text-muted truncate">Added by you</span>
                  </div>
                </div>
              ))}

              {/* Add entity inline */}
              {addingEntity ? (
                <div className="flex items-center gap-2 p-2 rounded-md border border-accent bg-white">
                  <input
                    value={newEntityName}
                    onChange={(e) => setNewEntityName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddEntity();
                      if (e.key === "Escape") {
                        setAddingEntity(false);
                        setNewEntityName("");
                      }
                    }}
                    placeholder="Entity name"
                    className="flex-1 text-sm px-2 py-1 border-none outline-none bg-transparent text-primary placeholder:text-muted"
                  />
                  <button
                    type="button"
                    onClick={handleAddEntity}
                    disabled={!newEntityName.trim()}
                    className="text-xs font-semibold px-3 py-1 rounded bg-accent text-inverse disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingEntity(false);
                      setNewEntityName("");
                    }}
                    className="text-muted hover:opacity-70 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingEntity(true)}
                  className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-md border-[1.5px] border-dashed border-border text-sm font-medium text-accent-text hover:border-accent hover:bg-accent-soft transition"
                >
                  <PlusIcon />
                  Add entity
                </button>
              )}
            </div>

            {/* Drag overlay — floating chip while dragging */}
            <DragOverlay>
              {activeDragEntity ? (
                <span className="inline-flex items-center gap-1.5 rounded-full font-medium text-sm px-3 py-2 shadow-lg scale-105 bg-entity-primary-bg text-entity-primary">
                  {activeDragEntity.name}
                </span>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* Tags */}
        <div>
          <SectionLabel>
            Tags (
            {hypothesis.tags.filter((t) => !removedTags.has(t.name)).length +
              confirmedSuggestedTags.size +
              addedTags.length}{" "}
            active)
          </SectionLabel>
          <p className="text-xs text-muted mb-2">Tap to toggle. Orange tags imply action needed.</p>
          <div className="flex flex-wrap gap-1.5">
            {/* Hypothesis tags */}
            {hypothesis.tags.map((tag) => (
              <Tag
                key={tag.name}
                label={tag.name}
                active={!removedTags.has(tag.name)}
                actionable={tag.isActionable}
                onToggle={() => handleToggleTag(tag.name)}
              />
            ))}

            {/* Suggested tags from validation */}
            {validation.suggestedTags.map((tag) => (
              <span key={tag.name} className="inline-flex items-center gap-1">
                <Tag
                  label={tag.name}
                  active={confirmedSuggestedTags.has(tag.name)}
                  actionable={tag.isActionable}
                  onToggle={() => handleToggleSuggestedTag(tag.name)}
                />
                <span className="text-[10px] font-semibold text-accent-text bg-accent-soft px-1.5 py-0.5 rounded-full">
                  NEW
                </span>
              </span>
            ))}

            {/* User-added tags */}
            {addedTags.map((name) => (
              <Tag
                key={name}
                label={name}
                active
                onRemove={() => setAddedTags((prev) => prev.filter((t) => t !== name))}
              />
            ))}

            {/* Add tag inline */}
            {addingTag ? (
              <div className="inline-flex items-center gap-1">
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddTag();
                    if (e.key === "Escape") {
                      setAddingTag(false);
                      setNewTagName("");
                    }
                  }}
                  placeholder="Tag name"
                  className="w-28 text-xs px-2.5 py-1.5 rounded-full border border-accent outline-none text-primary"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="text-accent-text text-xs font-semibold hover:opacity-70"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingTag(false);
                    setNewTagName("");
                  }}
                  className="text-muted text-xs hover:opacity-70"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTag(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-accent text-xs font-medium text-accent-text hover:bg-accent-soft transition"
              >
                <PlusIcon />
                Add
              </button>
            )}
          </div>
        </div>

        {/* Extracted Fields */}
        <div>
          <SectionLabel>Extracted Fields</SectionLabel>
          <div className="divide-y divide-border-light">
            {hypothesis.extractedFields.map((field) => (
              <div key={field.name} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">{field.description}</p>
                  <p className="text-xs text-muted">
                    {field.name} ({field.type})
                  </p>
                </div>
                {field.showOnCard && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-text bg-accent-soft px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                    <EyeIcon />
                    On card
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Clustering Summary */}
        <div>
          <SectionLabel>How We&apos;ll Organize</SectionLabel>
          <div className="bg-subtle rounded-md p-3 text-sm text-secondary space-y-1.5">
            <p>
              Merge threshold: {clusteringConfig.mergeThreshold} — emails need a{" "}
              {clusteringConfig.mergeThreshold}% match to group together
            </p>
            <p>
              Time window: {clusteringConfig.timeDecayDays.fresh} days — recent emails weighted more
              heavily
            </p>
            <p>
              Reminder detection:{" "}
              {clusteringConfig.reminderCollapseEnabled ? "enabled" : "disabled"}
            </p>
          </div>
        </div>
      </div>

      {/* Finalize button - sticky at bottom */}
      <div className="pt-3 border-t border-border mt-auto">
        <Button onClick={handleFinalize} disabled={isLoading}>
          {isLoading ? "Finalizing..." : "Looks good, start organizing!"}
        </Button>
      </div>
    </CardShell>
  );
}
