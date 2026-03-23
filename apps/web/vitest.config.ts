import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Exact match only — don't intercept @prisma/client/runtime/* sub-paths
      { find: /^@prisma\/client$/, replacement: path.resolve(__dirname, "./prisma/generated/prisma/client/client.ts") },
    ],
  },
});
