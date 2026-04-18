/**
 * Gmail OAuth scope — server-safe constant.
 *
 * MUST live in a module WITHOUT `"use client"`. Importing a string constant
 * from a `"use client"` module into a server route produces a Client
 * Reference object (not the raw string), so calls like `.includes(...)` on
 * it throw `TypeError: x is not a function`. That silently breaks token
 * storage in /auth/callback and puts onboarding into an infinite reconnect
 * loop. See lessons-learned (2026-04-18).
 */
export const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
