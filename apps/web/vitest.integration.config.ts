import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 600000,
    setupFiles: ["tests/integration/helpers/setup.ts"],
    fileParallelism: false,
    pool: "forks",
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Exact match only — don't intercept @prisma/client/runtime/* sub-paths
      { find: /^@prisma\/client$/, replacement: path.resolve(__dirname, "./prisma/generated/prisma/client/client.ts") },
    ],
  },
});
