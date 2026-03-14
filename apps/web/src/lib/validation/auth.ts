import { z } from "zod";

export const storeTokensSchema = z.object({
  providerToken: z.string().min(1, "Provider token is required"),
  providerRefreshToken: z.string().default(""),
});

export type StoreTokensInput = z.infer<typeof storeTokensSchema>;
