import type { DenimEvents } from "@denim/types";
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "case-engine" });

// Re-export the typed client for use in function definitions
export type { DenimEvents };
