"use client";

import type { HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useCallback, useState } from "react";
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
  isLoading?: boolean;
  onFinalize: (confirmations: {
    confirmedEntities: string[];
    removedEntities: string[];
    confirmedTags: string[];
    removedTags: string[];
    addedEntities?: string[];
    addedTags?: string[];
    schemaName?: string;
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

export function Card4Review({ hypothesis, validation, isLoading, onFinalize, onBack }: Card4Props) {
  const [schemaName, setSchemaName] = useState(hypothesis.schemaName);
  const [removedEntities, setRemovedEntities] = useState<Set<string>>(() => new Set());
  const [addedEntities, setAddedEntities] = useState<string[]>([]);
  const [removedTags, setRemovedTags] = useState<Set<string>>(() => new Set());
  const [confirmedSuggestedTags, setConfirmedSuggestedTags] = useState<Set<string>>(
    () => new Set(),
  );
  const [addedTags, setAddedTags] = useState<string[]>([]);

  // Add entity inline form state
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");

  // Add tag inline form state
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");

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

  const handleFinalize = useCallback(() => {
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
    onFinalize,
  ]);

  const { clusteringConfig } = hypothesis;

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
          <div className="space-y-2">
            {/* Hypothesis entities */}
            {hypothesis.entities.map((entity) => {
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
            })}

            {/* Discovered entities from validation */}
            {validation.discoveredEntities.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-muted mb-1.5 font-medium">Discovered</p>
                {validation.discoveredEntities.map((entity) => {
                  const isRemoved = removedEntities.has(entity.name);
                  return (
                    <div
                      key={entity.name}
                      className={`flex items-center justify-between p-2 rounded-md border border-border-light transition mb-1.5 ${
                        isRemoved ? "opacity-40" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <EntityChip
                          name={entity.name}
                          entityType={entity.type}
                          onRemove={() => handleRemoveEntity(entity.name)}
                        />
                        <span className="text-xs text-muted truncate">Discovered in email</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

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
