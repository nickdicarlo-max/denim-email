import { inngest } from "./client";

/**
 * Test function demonstrating concurrency key pattern.
 * Replace with real pipeline functions in later phases.
 */
export const testFunction = inngest.createFunction(
  {
    id: "test-function",
    concurrency: {
      limit: 5,
      key: "event.data.schemaId",
    },
  },
  { event: "scan.emails.discovered" },
  async ({ event, step }) => {
    const { schemaId, emailIds } = event.data;

    await step.run("process", async () => {
      return { schemaId, processed: emailIds.length };
    });
  },
);

export const functions = [testFunction];
