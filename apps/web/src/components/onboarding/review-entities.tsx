"use client";

export interface EntityData {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  autoDetected: boolean;
  emailCount: number;
  aliases: string[];
  isActive: boolean;
}

interface ReviewEntitiesProps {
  userThings: string[];
  entities: EntityData[];
  onToggleEntity: (entityId: string, active: boolean) => void;
}

/**
 * Two-section entity review for the onboarding review page.
 *
 * Section 1: User-entered things with discovered aliases.
 * Section 2: New discoveries (auto-detected primary entities not in userThings).
 */
export function ReviewEntities({ userThings, entities, onToggleEntity }: ReviewEntitiesProps) {
  // Section 1: Match user-entered things to primary entities
  const userThingsLower = userThings.map((t) => t.toLowerCase());

  // Find primary entities matching each user thing
  const thingSections = userThings.map((thingName) => {
    const thingLower = thingName.toLowerCase();
    // The "parent" entity that matches the user-entered name
    const parentEntity = entities.find(
      (e) => e.type === "PRIMARY" && e.name.toLowerCase() === thingLower,
    );
    // Auto-detected aliases: primary entities whose name differs from the user thing
    // but are associated (discovered as aliases during scan)
    const aliasEntities = entities.filter(
      (e) =>
        e.type === "PRIMARY" &&
        e.autoDetected &&
        e.name.toLowerCase() !== thingLower &&
        e.aliases.some((a) => a.toLowerCase() === thingLower),
    );
    return { thingName, parentEntity, aliasEntities };
  });

  // Section 2: New discoveries -- auto-detected primary entities not matching any user thing
  const discoveries = entities.filter((e) => {
    if (e.type !== "PRIMARY" || !e.autoDetected) return false;
    const nameLower = e.name.toLowerCase();
    // Skip if entity name matches a user thing
    if (userThingsLower.includes(nameLower)) return false;
    // Skip if entity is an alias of a user thing
    const isAliasOfUserThing = userThings.some((t) =>
      e.aliases.some((a) => a.toLowerCase() === t.toLowerCase()),
    );
    if (isAliasOfUserThing) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Section 1: User-entered things */}
      <div className="rounded-lg bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-4">
          Your Things
        </h2>

        <div className="space-y-5">
          {thingSections.map(({ thingName, aliasEntities }) => (
            <div key={thingName}>
              <p className="font-semibold text-primary">{thingName}</p>

              {aliasEntities.length > 0 ? (
                <div className="mt-2 ml-4 space-y-2">
                  {aliasEntities.map((entity) => (
                    <div key={entity.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-primary">{entity.name}</span>
                        <span className="text-xs text-muted">
                          {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleEntity(entity.id, !entity.isActive)}
                        className="cursor-pointer text-xs text-secondary hover:text-red-600 transition-colors"
                      >
                        {entity.isActive ? "Not right? Separate" : "Re-merge"}
                      </button>
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

      {/* Section 2: New discoveries */}
      {discoveries.length > 0 && (
        <div className="rounded-lg bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-4">
            New Discoveries
          </h2>

          <div className="space-y-3">
            {discoveries.map((entity) => (
              <div key={entity.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-primary font-medium">{entity.name}</span>
                  <span className="text-xs text-muted">
                    {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                  </span>
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
