import { z } from "zod";

export const FeedbackInputSchema = z.object({
  schemaId: z.string().min(1, "schemaId is required"),
  type: z.enum([
    "THUMBS_UP",
    "THUMBS_DOWN",
    "EMAIL_MOVE",
    "EMAIL_EXCLUDE",
    "CASE_MERGE",
    "CASE_SPLIT",
    "TAG_EDIT",
    "ENTITY_MERGE",
    "ENTITY_EDIT",
  ]),
  caseId: z.string().min(1).optional(),
  emailId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
