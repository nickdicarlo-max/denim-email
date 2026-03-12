import type { DenimEvents } from "@denim/types";
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "case-engine",
  schemas: new Map() as never, // Type assertion for DenimEvents
});

// Re-export the typed client for use in function definitions
export type { DenimEvents };
