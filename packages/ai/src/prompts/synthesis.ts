/**
 * Synthesis prompt builder for case enrichment.
 * Takes a case's emails and schema context, produces a prompt for Claude
 * to generate title, summary, display tags, primary actor, and actions.
 * Pure function — no I/O, no side effects.
 */
import type { SynthesisEmailInput, SynthesisSchemaContext } from "@denim/types";

export interface SynthesisPromptResult {
  system: string;
  user: string;
}

function buildTagTaxonomy(schema: SynthesisSchemaContext): string {
  if (schema.tags.length === 0) {
    return "No tags defined.";
  }
  return schema.tags
    .map((t) => `  - "${t.name}": ${t.description}`)
    .join("\n");
}

function buildEntityList(schema: SynthesisSchemaContext): string {
  if (schema.entities.length === 0) {
    return "No entities defined.";
  }
  return schema.entities
    .map((e) => `  - "${e.name}" (${e.type})`)
    .join("\n");
}

function buildFieldDefinitions(schema: SynthesisSchemaContext): string {
  if (schema.extractedFields.length === 0) {
    return "No extracted fields defined.";
  }
  return schema.extractedFields
    .map((f) => `  - "${f.name}" (${f.type}): ${f.description}`)
    .join("\n");
}

function buildSystemPrompt(schema: SynthesisSchemaContext, today: string): string {
  return `You are a case synthesis engine for a "${schema.domain}" case management system. You receive a group of related emails that belong to the same case and must produce a rich case summary.

TODAY'S DATE: ${today}
Use this to determine urgency. Events/deadlines that have already passed are NOT imminent — they are NO_ACTION (expired).

Your job:
1. Generate a descriptive TITLE (under 60 characters) that captures the case's essence. Not just the first email subject — synthesize across all emails.
2. Generate a three-part SUMMARY using the labels below:
   - "${schema.summaryLabels.beginning}": How this case started or what initiated it.
   - "${schema.summaryLabels.middle}": Key activity, exchanges, or developments.
   - "${schema.summaryLabels.end}": Current status, next steps, or resolution.
   Each section should be 1-3 sentences.
3. Select 2-3 DISPLAY TAGS from the taxonomy below that best represent this case to a human reader.
4. Identify the PRIMARY ACTOR — the main external counterparty (person or organization) in this case. Set to null if unclear.
5. Extract ACTION ITEMS from the emails. These are tasks, events, payments, deadlines, or responses that need attention.
   - If multiple emails remind about the SAME task, produce ONE action (do not duplicate).
   - If an email says something is "done", "completed", "signed", or "sent", that action should not appear as pending.
   - Include due dates, event times, locations, and amounts when mentioned.
   - Each action needs a confidence score (0-1) reflecting how clearly it was stated.
6. Determine the case STATUS:
   - "OPEN" — active, needs attention
   - "IN_PROGRESS" — work is underway
   - "RESOLVED" — everything appears handled/completed
7. Assign a single EMOJI (1-2 characters) that visually represents this case's topic or activity.
   Examples: ⚽ for soccer, 🏠 for property, 📋 for admin, 💰 for payments, 🎓 for school, 🔧 for maintenance.
   Choose intuitively based on what the case is about.
8. Determine URGENCY based on time-sensitive content:
   - "IMMINENT" — action/event within 48 hours
   - "THIS_WEEK" — action/event within 7 days
   - "UPCOMING" — action/event more than 7 days out, or ongoing recurring activity
   - "NO_ACTION" — relevant content but nothing the user needs to do (completed, informational, expired)
   - "IRRELEVANT" — emails don't substantively relate to the entity; likely misclassified noise

DELIBERATE INACTION: If the email describes something the user explicitly declined,
chose not to do, or allowed to expire (e.g., "membership expired, will NOT auto-renew",
"we chose not to participate", "unsubscribed"), do NOT create an action item.
These are intentional decisions, not pending tasks. Set urgency to NO_ACTION.

TAG TAXONOMY (select display tags from this list only):
${buildTagTaxonomy(schema)}

KNOWN ENTITIES (identify primary actor from these if possible):
${buildEntityList(schema)}

EXTRACTED FIELD DEFINITIONS (for context):
${buildFieldDefinitions(schema)}

RECURRING EVENTS:
- If the case contains recurring event emails (practices, games, meetings, classes), the title should describe the recurring activity (e.g., "Soccer Practices", "Team Games"), NOT a single occurrence (e.g., NOT "New event: Practice").
- Identify the NEXT upcoming event date and location as the primary action item. Past events should not appear as actions.
- Set status to IN_PROGRESS if upcoming events exist, RESOLVED if all events have passed.

CRITICAL RULES:
1. Return ONLY valid JSON matching the required schema exactly. No explanations, no markdown, no extra text.
2. Title must be under 60 characters.
3. Display tags must come from the taxonomy above. 2-3 tags maximum.
4. Action types must be one of: TASK, EVENT, PAYMENT, DEADLINE, RESPONSE.
5. Dates must be ISO 8601 format (e.g., "2026-03-15" or "2026-03-15T16:00:00Z").
6. Deduplicate actions: if two emails mention the same task, produce one action.
7. If an action appears completed based on email content, do NOT include it.

Required JSON shape:
{
  "title": string,
  "emoji": string,
  "summary": {
    "beginning": string,
    "middle": string,
    "end": string
  },
  "displayTags": string[],
  "primaryActor": { "name": string, "entityType": string } | null,
  "actions": [
    {
      "title": string,
      "description": string | null,
      "actionType": "TASK" | "EVENT" | "PAYMENT" | "DEADLINE" | "RESPONSE",
      "dueDate": string | null,
      "eventStartTime": string | null,
      "eventEndTime": string | null,
      "eventLocation": string | null,
      "confidence": number,
      "amount": number | null,
      "currency": string | null,
      "sourceEmailId": string | null
    }
  ],
  "status": "OPEN" | "IN_PROGRESS" | "RESOLVED",
  "urgency": "IMMINENT" | "THIS_WEEK" | "UPCOMING" | "NO_ACTION" | "IRRELEVANT"
}`;
}

function buildUserPrompt(emails: SynthesisEmailInput[]): string {
  const emailBlocks = emails
    .map(
      (e, i) =>
        `--- EMAIL ${i + 1} (id: ${e.id}) ---
Subject: ${e.subject}
From: ${e.senderDisplayName} <${e.senderEmail}>
Date: ${e.date}
Is Reply: ${e.isReply}
Tags: ${e.tags.length > 0 ? e.tags.join(", ") : "none"}
Summary: ${e.summary}`,
    )
    .join("\n\n");

  return `Synthesize the following ${emails.length} email(s) into a single case:

${emailBlocks}

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for Claude to synthesize a case from its emails.
 * Pure function, no I/O.
 */
export function buildSynthesisPrompt(
  emails: SynthesisEmailInput[],
  schema: SynthesisSchemaContext,
  today?: string,
): SynthesisPromptResult {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  return {
    system: buildSystemPrompt(schema, todayStr),
    user: buildUserPrompt(emails),
  };
}
