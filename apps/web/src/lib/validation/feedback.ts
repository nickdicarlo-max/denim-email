import { z } from "zod";

export const FeedbackInputSchema = z.object({
	schemaId: z.string().uuid("schemaId must be a valid UUID"),
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
	caseId: z.string().uuid().optional(),
	emailId: z.string().uuid().optional(),
	payload: z.record(z.unknown()).optional(),
});

export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
