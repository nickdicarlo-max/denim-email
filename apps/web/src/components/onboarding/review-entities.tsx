"use client";

export interface EntityData {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  autoDetected: boolean;
  emailCount: number;
  aliases: string[];
  isActive: boolean;
  confidence: number;
  likelyAliasOf: string | null;
  aliasConfidence: number | null;
  aliasReason: string | null;
  relatedUserThing: string | null;
}

interface ReviewEntitiesProps {
  userThings: string[];
  entities: EntityData[];
  onToggleEntity: (entityId: string, active: boolean) => void;
}

/**
 * Two-section entity review for onboarding.
 *
 * Section 1 "Your Topics": each user-entered WHAT as a header, with
 *   discoveries that relate to that topic listed below. A discovery
 *   relates to a topic if it is a PRIMARY whose aliases contain the
 *   topic name (existing alias-based match), OR if it is any entity
 *   whose `relatedUserThing` matches the topic name (new, from
 *   validation).
 *
 * Section 2 "Discoveries": everything else — entities that didn't get
 *   placed under any topic. Includes PRIMARY entities that look like
 *   their own topics (Rental Properties, The Control Surface) and
 *   SECONDARY entities that span topics (like a parent who emails about
 *   both soccer and dance).
 */
export function ReviewEntities({ userThings, entities, onToggleEntity }: ReviewEntitiesProps) {
  const userThingsLower = userThings.map((t) => t.toLowerCase());

  // For each user thing, find the entities that should display under it.
  const thingSections = userThings.map((thingName) => {
    const thingLower = thingName.toLowerCase();
    // Parent-match: PRIMARY entity whose name equals the user thing.
    // We do NOT display this as a row — the header already shows the
    // user thing; the row would be a duplicate. Kept for future use.
    const parentEntity = entities.find(
      (e) => e.type === "PRIMARY" && e.name.toLowerCase() === thingLower,
    );

    // Related entities under this user thing. Two ways to qualify:
    //   1. PRIMARY with an alias matching the user thing (old behavior)
    //   2. Any type with relatedUserThing === thingName (new)
    const relatedEntities = entities.filter((e) => {
      // Skip the parent entity itself (it IS the user thing).
      if (parentEntity && e.id === parentEntity.id) return false;
      const aliasMatch =
        e.type === "PRIMARY" &&
        e.autoDetected &&
        e.aliases.some((a) => a.toLowerCase() === thingLower);
      const relatedMatch =
        e.relatedUserThing != null && e.relatedUserThing.toLowerCase() === thingLower;
      return aliasMatch || relatedMatch;
    });

    return { thingName, parentEntity, relatedEntities };
  });

  // Build a set of entity ids already shown under a user thing, so we
  // don't duplicate them in Discoveries.
  const shownIds = new Set<string>();
  for (const { parentEntity, relatedEntities } of thingSections) {
    if (parentEntity) shownIds.add(parentEntity.id);
    for (const e of relatedEntities) shownIds.add(e.id);
  }

  // Discoveries: everything else (PRIMARY or SECONDARY, auto-detected,
  // not already shown under a topic, and not matching a user thing name
  // via aliases).
  const discoveries = entities
    .filter((e) => {
      if (shownIds.has(e.id)) return false;
      if (!e.autoDetected) return false;
      const nameLower = e.name.toLowerCase();
      if (userThingsLower.includes(nameLower)) return false;
      const isAliasOfUserThing = userThings.some((t) =>
        e.aliases.some((a) => a.toLowerCase() === t.toLowerCase()),
      );
      if (isAliasOfUserThing) return false;
      return true;
    })
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return (
    <div className="space-y-6">
      {/* Section 1: Your Topics */}
      <div className="rounded-lg bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-4">
          Your Topics
        </h2>

        <div className="space-y-5">
          {thingSections.map(({ thingName, relatedEntities }) => (
            <div key={thingName}>
              <p className="font-semibold text-primary">{thingName}</p>

              {relatedEntities.length > 0 ? (
                <div className="mt-2 ml-4 space-y-2">
                  {relatedEntities.map((entity) => (
                    <div key={entity.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-primary">{entity.name}</span>
                        <span className="text-xs text-muted">
                          {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                        </span>
                      </div>
                      {entity.isActive ? (
                        <button
                          type="button"
                          onClick={() => onToggleEntity(entity.id, false)}
                          className="cursor-pointer text-xs text-muted hover:text-red-600 transition-colors"
                        >
                          Not now
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggleEntity(entity.id, true)}
                          className="cursor-pointer text-xs font-medium text-accent hover:brightness-110 transition-colors"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 ml-4 text-sm text-muted">No additional items found</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Discoveries */}
      {discoveries.length > 0 && (
        <div className="rounded-lg bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-4">
            Discoveries
          </h2>

          <div className="space-y-3">
            {discoveries.map((entity) => (
              <div key={entity.id} className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-primary font-medium">{entity.name}</span>
                    <span className="text-xs text-muted">
                      {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                    </span>
                  </div>
                  {entity.likelyAliasOf && (
                    <span className="text-xs text-muted">
                      May be related to {entity.likelyAliasOf}
                      {entity.aliasConfidence != null &&
                        ` (${Math.round(entity.aliasConfidence * 100)}%)`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {entity.isActive ? (
                    <button
                      type="button"
                      onClick={() => onToggleEntity(entity.id, false)}
                      className="cursor-pointer text-xs text-muted hover:text-red-600 transition-colors"
                    >
                      Not now
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onToggleEntity(entity.id, true)}
                      className="cursor-pointer text-xs font-medium text-accent hover:brightness-110 transition-colors"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
