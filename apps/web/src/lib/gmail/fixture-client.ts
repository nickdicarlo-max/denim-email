/**
 * FixtureGmailClient — drop-in replacement for GmailClient that reads
 * from local fixture files instead of hitting the Gmail API.
 *
 * Evaluates a subset of Gmail query syntax against loaded fixtures so
 * the eval script runs the exact same discovery → extraction pipeline
 * as production.
 */

import type { GmailMessageFull, GmailMessageMeta } from "./types";

export class FixtureGmailClient {
  private fixtures: GmailMessageFull[];
  private fixtureMap: Map<string, GmailMessageFull>;

  constructor(fixtures: GmailMessageFull[]) {
    this.fixtures = fixtures;
    this.fixtureMap = new Map(fixtures.map((f) => [f.id, f]));
  }

  /**
   * Evaluate a Gmail-style query against loaded fixtures.
   * Supports the subset used by discovery queries:
   *   - "quoted phrase" → match in subject, sender, body
   *   - from:"Name" or from:domain → match sender
   *   - subject:"text" → match in subject
   *   - newer_than:Nd → date filter
   *   - OR → union
   *   - Compound intersection via space-separated terms
   */
  async searchEmails(query: string, maxResults = 50): Promise<GmailMessageMeta[]> {
    const matches = this.evaluateQuery(query);
    return matches.slice(0, maxResults).map((f) => ({
      id: f.id,
      threadId: f.threadId,
      subject: f.subject,
      sender: f.sender,
      senderEmail: f.senderEmail,
      senderDomain: f.senderDomain,
      senderDisplayName: f.senderDisplayName,
      recipients: f.recipients,
      date: f.date,
      snippet: f.body.slice(0, 100),
      isReply: f.isReply,
      labels: f.labels,
    }));
  }

  async getEmailFull(messageId: string): Promise<GmailMessageFull> {
    const fixture = this.fixtureMap.get(messageId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${messageId}`);
    }
    return fixture;
  }

  async getEmailFullWithPacing(messageId: string, _delayMs = 0): Promise<GmailMessageFull> {
    return this.getEmailFull(messageId);
  }

  /**
   * Return just the message IDs matching a Gmail query — mirrors
   * `GmailClient.listMessageIds`. Used by Stage 1 (`fetchFromHeaders`) and
   * Stage 2 (`fetchSubjects`).
   */
  async listMessageIds(query: string, maxResults: number): Promise<string[]> {
    const matches = this.evaluateQuery(query);
    return matches.slice(0, maxResults).map((f) => f.id);
  }

  /**
   * Return a Gmail-shaped metadata envelope with only the requested headers.
   * Mirrors `GmailClient.getMessageMetadata`. Headers are synthesized from
   * the parsed fixture fields — `From`, `To`, `Cc`, `Subject`, `Date`.
   *
   * The request body of a real Gmail API call returns ONLY the named
   * headers; we match that contract so discovery code that does a narrow
   * `["Subject", "From"]` fetch sees the same shape it would in production.
   */
  async getMessageMetadata(
    messageId: string,
    headerNames: string[] = ["From", "Subject"],
  ): Promise<{
    id: string;
    payload: { headers: Array<{ name: string; value: string }> };
  }> {
    const fixture = this.fixtureMap.get(messageId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${messageId}`);
    }
    const allHeaders: Record<string, string> = {
      From: fixture.sender,
      To: fixture.recipients.join(", "),
      Cc: "",
      Subject: fixture.subject,
      Date: fixture.date.toUTCString(),
    };
    const want = new Set(headerNames.map((h) => h.toLowerCase()));
    const headers = Object.entries(allHeaders)
      .filter(([name]) => want.has(name.toLowerCase()))
      .map(([name, value]) => ({ name, value }));
    return {
      id: messageId,
      payload: { headers },
    };
  }

  // ── Query evaluation ────────────────────────────────────────────

  private evaluateQuery(rawQuery: string): GmailMessageFull[] {
    // Strip newer_than:Nd and apply as date filter
    let query = rawQuery;
    let minDate: Date | null = null;
    const newerMatch = query.match(/newer_than:(\d+)([dwm])/i);
    if (newerMatch) {
      const amount = Number.parseInt(newerMatch[1], 10);
      const unit = newerMatch[2].toLowerCase();
      const now = new Date();
      const ms =
        unit === "d"
          ? amount * 86400000
          : unit === "w"
            ? amount * 7 * 86400000
            : amount * 30 * 86400000; // approximate month
      minDate = new Date(now.getTime() - ms);
      query = query.replace(/newer_than:\d+[dwm]/i, "").trim();
    }

    let candidates = minDate ? this.fixtures.filter((f) => f.date >= minDate!) : [...this.fixtures];

    if (!query) return candidates;

    // Handle top-level OR: split on " OR " outside parens, union results
    if (this.hasTopLevelOr(query)) {
      return this.evaluateOr(query, candidates);
    }

    // Parse into tokens: quoted phrases, from:X, subject:X, parenthesized groups
    const tokens = this.tokenize(query);

    // Each token is an AND condition — intersect
    for (const token of tokens) {
      candidates = this.filterByToken(token, candidates);
    }

    return candidates;
  }

  private hasTopLevelOr(query: string): boolean {
    // Check for OR not inside parentheses
    let depth = 0;
    const words = query.split(/\s+/);
    for (const w of words) {
      for (const c of w) {
        if (c === "(") depth++;
        if (c === ")") depth--;
      }
      if (w === "OR" && depth === 0) return true;
    }
    return false;
  }

  private evaluateOr(query: string, candidates: GmailMessageFull[]): GmailMessageFull[] {
    // Split on top-level OR
    const parts: string[] = [];
    let current = "";
    let depth = 0;
    for (const word of query.split(/\s+/)) {
      for (const c of word) {
        if (c === "(") depth++;
        if (c === ")") depth--;
      }
      if (word === "OR" && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += (current ? " " : "") + word;
      }
    }
    if (current.trim()) parts.push(current.trim());

    const resultIds = new Set<string>();
    const results: GmailMessageFull[] = [];

    for (const part of parts) {
      const partResults = this.evaluateQuery(part);
      for (const r of partResults) {
        if (!resultIds.has(r.id) && candidates.some((c) => c.id === r.id)) {
          resultIds.add(r.id);
          results.push(r);
        }
      }
    }

    return results;
  }

  private tokenize(query: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    const q = query.trim();

    while (i < q.length) {
      // Skip whitespace
      while (i < q.length && q[i] === " ") i++;
      if (i >= q.length) break;

      // Parenthesized group
      if (q[i] === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < q.length && depth > 0) {
          if (q[j] === "(") depth++;
          if (q[j] === ")") depth--;
          j++;
        }
        tokens.push(q.slice(i, j));
        i = j;
        continue;
      }

      // Quoted phrase
      if (q[i] === '"') {
        const end = q.indexOf('"', i + 1);
        if (end > i) {
          tokens.push(q.slice(i, end + 1));
          i = end + 1;
          continue;
        }
      }

      // Leading `-` is a negation (e.g. `-category:promotions`, `-from:foo`).
      // Consume exactly one following unit (quoted / paren / field / word).
      if (q[i] === "-" && i + 1 < q.length && q[i + 1] !== " ") {
        const start = i;
        i++;
        const consumed = this.consumeUnit(q, i);
        i = consumed;
        tokens.push(q.slice(start, i));
        continue;
      }

      // field:value token — `from:`, `subject:`, `category:`, `label:`.
      // Value may be quoted, a parenthesized group (subject:("a" OR "b")),
      // or an unquoted word.
      if (q.slice(i).match(/^(from|subject|category|label):/i)) {
        let j = i;
        while (j < q.length && q[j] !== ":") j++;
        j++; // past ':'
        if (j < q.length && q[j] === '"') {
          const end = q.indexOf('"', j + 1);
          j = end > j ? end + 1 : q.length;
        } else if (j < q.length && q[j] === "(") {
          let depth = 1;
          j++;
          while (j < q.length && depth > 0) {
            if (q[j] === "(") depth++;
            if (q[j] === ")") depth--;
            j++;
          }
        } else {
          while (j < q.length && q[j] !== " ") j++;
        }
        tokens.push(q.slice(i, j));
        i = j;
        continue;
      }

      // Unquoted word
      let j = i;
      while (j < q.length && q[j] !== " ") j++;
      const word = q.slice(i, j);
      if (word && word !== "OR") {
        tokens.push(word);
      }
      i = j;
    }

    return tokens;
  }

  /**
   * Return the index just past the next "unit" starting at `i`:
   *   - "quoted"                   → end of quote
   *   - (paren group)              → matching close paren
   *   - field:(...) / field:"..."  → end of that field expression
   *   - word                       → next space
   */
  private consumeUnit(q: string, i: number): number {
    if (i >= q.length) return i;
    if (q[i] === '"') {
      const end = q.indexOf('"', i + 1);
      return end > i ? end + 1 : q.length;
    }
    if (q[i] === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < q.length && depth > 0) {
        if (q[j] === "(") depth++;
        if (q[j] === ")") depth--;
        j++;
      }
      return j;
    }
    const fieldMatch = q.slice(i).match(/^(from|subject|category|label):/i);
    if (fieldMatch) {
      let j = i + fieldMatch[0].length;
      if (j < q.length && q[j] === '"') {
        const end = q.indexOf('"', j + 1);
        return end > j ? end + 1 : q.length;
      }
      if (j < q.length && q[j] === "(") {
        let depth = 1;
        j++;
        while (j < q.length && depth > 0) {
          if (q[j] === "(") depth++;
          if (q[j] === ")") depth--;
          j++;
        }
        return j;
      }
      while (j < q.length && q[j] !== " ") j++;
      return j;
    }
    let j = i;
    while (j < q.length && q[j] !== " ") j++;
    return j;
  }

  /**
   * Expand a parenthesized field value (e.g. `subject:("a" OR "b")`) into
   * a list of comparison values. Splits on top-level `OR`, strips quotes.
   */
  private expandFieldValues(raw: string): string[] {
    // Strip outer parens if present
    let inner = raw.trim();
    if (inner.startsWith("(") && inner.endsWith(")")) {
      inner = inner.slice(1, -1).trim();
    }
    if (!inner) return [];
    // Split on top-level OR
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const word of inner.split(/\s+/)) {
      for (const c of word) {
        if (c === "(") depth++;
        if (c === ")") depth--;
      }
      if (word === "OR" && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += (current ? " " : "") + word;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.map((p) => p.replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
  }

  private filterByToken(token: string, candidates: GmailMessageFull[]): GmailMessageFull[] {
    // Negation (e.g. `-category:promotions`, `-from:foo`) — invert inner match.
    if (token.startsWith("-")) {
      const inner = token.slice(1);
      const included = this.filterByToken(inner, candidates);
      const ids = new Set(included.map((c) => c.id));
      return candidates.filter((c) => !ids.has(c.id));
    }

    // Parenthesized group — recurse (typically an OR group)
    if (token.startsWith("(") && token.endsWith(")")) {
      const inner = token.slice(1, -1);
      if (this.hasTopLevelOr(inner)) {
        const orResults = this.evaluateOr(inner, candidates);
        const ids = new Set(orResults.map((r) => r.id));
        return candidates.filter((c) => ids.has(c.id));
      }
      // No OR — treat as sub-expression
      const subTokens = this.tokenize(inner);
      let result = candidates;
      for (const t of subTokens) {
        result = this.filterByToken(t, result);
      }
      return result;
    }

    // `subject:(...)` or `subject:"..."` or `subject:word`
    const subjectParenMatch = token.match(/^subject:(\(.*\))$/i);
    if (subjectParenMatch) {
      const values = this.expandFieldValues(subjectParenMatch[1]);
      if (values.length === 0) return candidates;
      return candidates.filter((c) => {
        const s = c.subject.toLowerCase();
        return values.some((v) => s.includes(v));
      });
    }

    // `from:(...)` grouped
    const fromParenMatch = token.match(/^from:(\(.*\))$/i);
    if (fromParenMatch) {
      const values = this.expandFieldValues(fromParenMatch[1]);
      if (values.length === 0) return candidates;
      return candidates.filter((c) => {
        const senderLC = c.sender.toLowerCase();
        const emailLC = c.senderEmail.toLowerCase();
        const domainLC = c.senderDomain.toLowerCase();
        return values.some(
          (v) => senderLC.includes(v) || emailLC.includes(v) || domainLC === v,
        );
      });
    }

    // `category:promotions` — match Gmail CATEGORY_* labels.
    const categoryMatch = token.match(/^category:"?([\w-]+)"?$/i);
    if (categoryMatch) {
      const label = `CATEGORY_${categoryMatch[1].toUpperCase()}`;
      return candidates.filter((c) => c.labels.includes(label));
    }

    // `label:foo` — direct label match (case preserved for user labels).
    const labelMatch = token.match(/^label:"?([^"]+)"?$/i);
    if (labelMatch) {
      const label = labelMatch[1];
      return candidates.filter((c) => c.labels.includes(label));
    }

    // from: filter (single value — quoted or unquoted)
    const fromMatch = token.match(/^from:"?([^"]+)"?$/i);
    if (fromMatch) {
      const value = fromMatch[1].toLowerCase();
      // Wildcard form `from:*@domain.com` → domain match.
      const domainMatch = value.match(/^\*@(.+)$/);
      if (domainMatch) {
        const targetDomain = domainMatch[1];
        return candidates.filter((c) => c.senderDomain.toLowerCase() === targetDomain);
      }
      return candidates.filter((c) => {
        const senderLC = c.sender.toLowerCase();
        const emailLC = c.senderEmail.toLowerCase();
        const domainLC = c.senderDomain.toLowerCase();
        return senderLC.includes(value) || emailLC.includes(value) || domainLC === value;
      });
    }

    // subject: filter (single value)
    const subjectMatch = token.match(/^subject:"?([^"]+)"?$/i);
    if (subjectMatch) {
      const value = subjectMatch[1].toLowerCase();
      return candidates.filter((c) => c.subject.toLowerCase().includes(value));
    }

    // Quoted phrase — match in subject, sender, or body
    if (token.startsWith('"') && token.endsWith('"')) {
      const phrase = token.slice(1, -1).toLowerCase();
      return candidates.filter((c) => {
        const text = `${c.subject} ${c.sender} ${c.senderEmail} ${c.body}`.toLowerCase();
        return text.includes(phrase);
      });
    }

    // Unquoted word — match in subject or sender
    const word = token.toLowerCase();
    return candidates.filter((c) => {
      const text = `${c.subject} ${c.sender}`.toLowerCase();
      return text.includes(word);
    });
  }
}
