import { ValidationError } from "@denim/types";
import { z } from "zod";

const entityNameString = z.string().trim().min(1).max(255);

const EntityGroupSchema = z.object({
  whats: z.array(entityNameString).min(1, "Each group needs at least one WHAT"),
  whos: z.array(entityNameString),
});

export const InterviewInputSchema = z.object({
  role: z.string().trim().min(1, "Role is required"),
  domain: z.string().trim().min(1, "Domain is required"),
  whats: z.array(entityNameString).min(1, "At least one primary entity is required"),
  whos: z.array(entityNameString),
  // groups and goals are optional in the simplified onboarding flow.
  // When empty, the prompt builder falls back to flat whats/whos and skips
  // goal-based field adjustments.
  groups: z.array(EntityGroupSchema).max(20).default([]),
  sharedWhos: z.array(entityNameString).optional(),
  goals: z.array(z.string()).default([]),
  customDescription: z.string().trim().max(500).optional(),
  // #111: optional user-provided topic name. Trimmed empty strings are rejected
  // so the entity-confirm fallback path can trigger deterministically.
  name: z.string().trim().min(1).max(100).optional(),
});

export const FinalizeConfirmationsSchema = z.object({
  confirmedEntities: z.array(z.string()),
  removedEntities: z.array(z.string()),
  confirmedTags: z.array(z.string()),
  removedTags: z.array(z.string()),
  addedEntities: z.array(z.string().max(255)).optional(),
  addedTags: z.array(z.string().max(255)).optional(),
  schemaName: z.string().max(255).optional(),
  groups: z.array(EntityGroupSchema).max(20).optional(),
  sharedWhos: z.array(entityNameString).optional(),
});

/**
 * Validates input with Zod schema, throws ValidationError on failure.
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ValidationError(messages);
  }
  return result.data;
}
