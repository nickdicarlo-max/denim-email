/**
 * Batch fixture loader — reads Gmail API JSON files from a directory
 * and converts them to GmailMessageFull objects.
 *
 * Usage:
 *   import { loadFixtures } from "@/lib/gmail/fixture-loader";
 *   const emails = loadFixtures("../../Denim_Samples_Individual");
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GmailMessageFull } from "./types";
import { parseGmailJson } from "./parse";

/**
 * Load all Gmail API JSON fixtures from a directory.
 * Returns GmailMessageFull[] sorted by date ascending.
 * Logs parse failures to stderr but continues processing.
 */
export function loadFixtures(dirPath: string): GmailMessageFull[] {
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  const results: GmailMessageFull[] = [];
  const failures: string[] = [];

  for (const file of files) {
    try {
      const msg = loadFixture(join(dirPath, file));
      results.push(msg);
    } catch (err) {
      failures.push(`${file}: ${(err as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n  Parse failures (${failures.length}):`);
    for (const f of failures.slice(0, 10)) {
      console.error(`    ${f}`);
    }
    if (failures.length > 10) {
      console.error(`    ... and ${failures.length - 10} more`);
    }
  }

  // Sort by date ascending
  results.sort((a, b) => a.date.getTime() - b.date.getTime());

  return results;
}

/**
 * Load a single Gmail API JSON fixture file.
 */
export function loadFixture(filePath: string): GmailMessageFull {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  return parseGmailJson(raw);
}
