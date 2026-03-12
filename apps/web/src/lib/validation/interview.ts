import { ValidationError } from "@denim/types";
import { z } from "zod";

export const InterviewInputSchema = z.object({
  role: z.string().min(1, "Role is required"),
  domain: z.string().min(1, "Domain is required"),
  whats: z.array(z.string().min(1)).min(1, "At least one primary entity is required"),
  whos: z.array(z.string()),
  goals: z.array(z.string()).min(1, "At least one goal is required"),
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
