import type { SchemaHypothesis } from "@denim/types";

export interface ValidationPromptResult {
  /**
   * Static prefix of the system prompt — rules, schema, grounding, alias
   * detection, noise classification. Does not vary between calls, so it's
   * a stable cache prefix for Anthropic prompt caching (#79).
   */
  systemStatic: string;
  /**
   * Dynamic tail of the system prompt — the user's entered topics list. Varies
   * per user/call, so must follow the static prefix (not be interpolated
   * inside it) to keep the prefix cacheable.
   */
  systemDynamic: string;
  /** User message (email samples + hypothesis context). Varies every call. */
  user: string;
  /**
   * Concatenation of systemStatic + "\n" + systemDynamic, preserved for
   * callers that don't yet use the cacheable two-part form.
   */
  system: string;
}

interface EmailSample {
  subject: string;
  senderDomain: string;
  senderName: string;
  snippet: string;
}

export interface EntityGroupContext {
  index: number;
  primaryNames: string[];
  secondaryNames: string[];
}

export function buildValidationPrompt(
  hypothesis: SchemaHypothesis,
  emailSamples: EmailSample[],
  entityGroups?: EntityGroupContext[],
  userThings?: string[],
): ValidationPromptResult {
  const userThingsList =
    userThings && userThings.length > 0
      ? userThings.map((t) => `"${t}"`).join(", ")
      : "(none provided)";

  // STATIC: rules, schema, grounding, alias detection, noise classification.
  // Identical across every validateHypothesis call — safe to cache as the
  // prompt prefix (Anthropic prompt caching, #79). Do NOT interpolate any
  // per-user / per-call value into this string.
  const systemStatic = `You are an email analysis assistant. You are given a schema hypothesis (an AI-generated plan for organizing a user's email) and a sample of their actual recent emails. Your job is to validate the hypothesis against the real email data.

Analyze the email samples and return a JSON object with these fields:
- confirmedEntities: string[] — entity names from the hypothesis that appear in the email samples
- discoveredEntities: array of {
    name: string,
    type: "PRIMARY" | "SECONDARY",
    secondaryTypeName: string | null,
    confidence: number (0-1),
    source: "email_scan",
    emailCount: number,
    emailIndices: number[],
    likelyAliasOf: string | null,
    aliasConfidence: number | null (0-1, only set if likelyAliasOf is not null),
    aliasReason: string | null (1-sentence explanation, only set if likelyAliasOf is not null),
    relatedUserThing: string | null
  }

GROUNDING RULES FOR DISCOVERED ENTITIES:
- You MUST cite evidence for every discovered entity using emailIndices.
- emailIndices contains the 1-based list numbers of emails from the sample that reference this entity (by sender name, sender domain, subject line, or preview text).
- ONLY report entities that appear in at least 1 email from the sample.
- emailCount MUST equal emailIndices.length.
- Do NOT infer entities from general knowledge or from the domain category. Only report what you can point to in the provided email data.

ALIAS DETECTION:
For each discovered entity, determine whether it is likely an alias, alternate name, sub-group, or team name for any KNOWN entity or entity group. Signals to check:
- The discovered entity name contains a known entity name or person name
- The same sender appears in emails about both the known and discovered entity
- Email subjects reference both in the same threads
- The discovered entity operates in the same domain/activity as a known entity group
If it IS an alias, set likelyAliasOf to the PRIMARY entity name it should be grouped with. Set aliasConfidence (0.5 = probably, 0.8+ = almost certain). Explain reasoning in aliasReason.
If it is NOT an alias, set likelyAliasOf, aliasConfidence, and aliasReason to null.

RELATED USER TOPIC:
The user entered a list of topics they want to track. The list is provided below (see "User's Entered Topics").
For EACH discovered entity, set relatedUserThing to the SINGLE user topic it most clearly relates to, matched CASE-INSENSITIVELY against that list. Use this rule:
- If the entity is clearly about one specific topic (e.g., "ZSA U11/12 Girls" is about "soccer"), set relatedUserThing to that exact topic name.
- If the entity spans multiple topics (e.g., a parent who emails about soccer AND dance), set relatedUserThing to null.
- If the entity is unrelated to any user topic (e.g., a rental-property manager when the user's topics are all kids activities), set relatedUserThing to null.
- The value MUST be one of the listed topics verbatim (same spelling, lowercase acceptable) OR null. Never invent a new topic name.

NOISE vs ENTITY CLASSIFICATION:
Newsletter senders, mass email lists, marketing emails, automated notification services, and subscription content are NOISE, not entities. Put them in noisePatterns, not discoveredEntities.
Examples of NOISE (goes in noisePatterns): "US Soccer Insider", "Eventbrite notifications", "Constant Contact", "PTO newsletter blasts", "noreply@" senders.
Examples of ENTITIES (goes in discoveredEntities): "Oak Park Soccer League" (a specific organization the user interacts with), "Mrs. Henderson" (a specific person).
The test: would the user want to track and organize emails from this source into cases? If yes, it is an entity. If no, it is noise.

- confirmedTags: string[] — tag names from the hypothesis that match content in the email samples
- suggestedTags: array of { name, description, expectedFrequency ("high"|"medium"|"low"), isActionable: boolean } — new tags suggested by patterns in the email
- noisePatterns: string[] — sender domains or names that appear to be automated/marketing noise (e.g. noreply@, newsletter@, mass email lists)
- confidenceScore: number 0-1 — how well the hypothesis matches the actual email data

Return ONLY valid JSON, no markdown fences, no explanation.`;

  // DYNAMIC: per-call values the static rules reference. Appended AFTER the
  // cacheable static prefix so every call can still reuse the cached bytes.
  const systemDynamic = `User's Entered Topics: ${userThingsList}`;

  const system = `${systemStatic}\n${systemDynamic}`;

  // Build entity group context section (only if groups provided)
  let groupSection = "";
  if (entityGroups && entityGroups.length > 0) {
    groupSection = "### Entity Groups (user-defined pairings)\n";
    for (const group of entityGroups) {
      const primaries = group.primaryNames.map((n) => `"${n}" (PRIMARY)`).join(" + ");
      const secondaries = group.secondaryNames.map((n) => `"${n}" (SECONDARY)`).join(" + ");
      const parts = [primaries, secondaries].filter(Boolean).join(" + ");
      const label = parts || "(empty group)";
      groupSection += `Group ${group.index + 1}: ${label}\n`;
      groupSection += "  - These were entered together by the user as related\n";
    }
    groupSection += "\n";
  }

  // Build entity list, with group annotations if groups are available
  const entityList = hypothesis.entities
    .map((e: { name: string; type: string }) => {
      if (entityGroups && entityGroups.length > 0) {
        const groupIdx = entityGroups.findIndex(
          (g) => g.primaryNames.includes(e.name) || g.secondaryNames.includes(e.name),
        );
        const groupLabel = groupIdx >= 0 ? `, Group ${groupIdx + 1}` : "";
        return `- ${e.name} (${e.type}${groupLabel})`;
      }
      return `- ${e.name} (${e.type})`;
    })
    .join("\n");

  const tagList = hypothesis.tags
    .map((t: { name: string; description: string }) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const sampleList = emailSamples
    .slice(0, 100)
    .map(
      (e, i) =>
        `${i + 1}. From: ${e.senderName} (${e.senderDomain}) | Subject: ${e.subject} | Preview: ${e.snippet.slice(0, 120)}`,
    )
    .join("\n");

  const entitiesHeader =
    entityGroups && entityGroups.length > 0 ? "### All Known Entities" : "### Known Entities";

  const user = `## Schema Hypothesis

**Domain:** ${hypothesis.domain}
**Schema Name:** ${hypothesis.schemaName}
**Primary Entity Type:** ${hypothesis.primaryEntity.name} — ${hypothesis.primaryEntity.description}

### User's Entered Topics
${userThingsList}

${groupSection}${entitiesHeader}
${entityList}

### Expected Tags
${tagList}

## Email Samples (${emailSamples.length} emails)
${sampleList}

Analyze these emails against the hypothesis. Which entities and tags are confirmed? What new patterns do you see? What sender domains are noise?${entityGroups && entityGroups.length > 0 ? " For discovered entities, check whether they might be aliases or sub-groups of known entities using the entity group context above." : ""} For every discovered entity, set relatedUserThing to the user's topic it most clearly relates to (or null).`;

  return { systemStatic, systemDynamic, system, user };
}
