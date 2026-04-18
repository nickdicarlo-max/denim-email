import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

/**
 * Inngest webhook endpoint.
 *
 * Request-signature enforcement is configured on the Inngest client (see
 * `lib/inngest/client.ts`) so this handler only declares transport + the
 * function registry. Issue #95 Task 4.4c: the client now passes
 * `signingKey` explicitly — without it, unsigned events could hit this URL
 * directly and drive onboarding discovery against any victim schemaId.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
