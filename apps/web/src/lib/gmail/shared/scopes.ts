/**
 * Gmail OAuth scope constants — shared, no directives.
 *
 * Lives in `lib/gmail/shared/` so BOTH server and client modules can import
 * it without triggering the Next.js Client Reference wrapping trap (see
 * docs/01_denim_lessons_learned.md, 2026-04-18 entry). A Biome rule in
 * `biome.json` forbids server modules from importing anything out of
 * `lib/gmail/client/**` — this directory is the sanctioned shared layer.
 */
export const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
