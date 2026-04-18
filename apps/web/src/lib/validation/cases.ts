import { z } from "zod";

export const CaseListQuerySchema = z.object({
  schemaId: z.string().min(1, "schemaId is required"),
  // Comma-separated statuses: "OPEN", "OPEN,IN_PROGRESS", etc.
  status: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"])).min(1))
    .optional(),
  entityId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type CaseListQuery = z.infer<typeof CaseListQuerySchema>;
