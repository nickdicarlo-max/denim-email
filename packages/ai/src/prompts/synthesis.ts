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
    .map((t: { name: string; description: string }) => `  - "${t.name}": ${t.description}`)
    .join("\n");
}

function buildEntityList(schema: SynthesisSchemaContext): string {
  if (schema.entities.length === 0) {
    return "No entities defined.";
  }
  return schema.entities
    .map((e: { name: string; type: string }) => `  - "${e.name}" (${e.type})`)
    .join("\n");
}

function buildFieldDefinitions(schema: SynthesisSchemaContext): string {
  if (schema.extractedFields.length === 0) {
    return "No extracted fields defined.";
  }
  return schema.extractedFields
    .map((f: { name: string; type: string; description: string }) => `  - "${f.name}" (${f.type}): ${f.description}`)
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
   - "${schema.summaryLabels.end}": Status as of today (${today}). State what is pending or resolved, including the date so readers know when this was assessed. Example: "As of Mar 31: awaiting signed form; registration closes Apr 4."
   Each section should be 1-3 sentences.
   TIME-NEUTRAL LANGUAGE: Your summaries will be displayed for days or weeks after generation. Use absolute dates, not relative time references.
   WRONG: "Meeting tomorrow", "due this Friday", "recently received", "coming up soon", "waiting for approval"
   RIGHT: "Meeting on Thu Apr 3", "due Fri Apr 4", "received Mar 20", "scheduled for Apr 12", "approval pending as of Mar 28"
3. Select 2-3 DISPLAY TAGS from the taxonomy below that best represent this case to a human reader.
4. Identify the PRIMARY ACTOR — the main external counterparty (person or organization) in this case. Set to null if unclear.
5. Extract ACTION ITEMS from the emails. These are tasks, events, payments, deadlines, or responses that need attention.
   - If multiple emails remind about the SAME task, produce ONE action (do not duplicate).
   - If an email says something is "done", "completed", "signed", or "sent", that action should not appear as pending.
   - Include due dates, event times, locations, and amounts when mentioned.
   - Each action needs a confidence score (0-1) reflecting how clearly it was stated.
   - Extract eventEndTime when the email specifies a duration or end time.
     "Practice 5:30-7pm" -> eventStartTime: "2026-04-01T17:30:00Z", eventEndTime: "2026-04-01T19:00:00Z"
     "Awards ceremony at 2pm" -> eventStartTime only (no end time mentioned, leave eventEndTime null)
     Including end times lets the user see how long events take.
   - Action TITLES must include absolute dates, not relative references.
     WRONG: "Register by Friday", "Practice tomorrow", "Pay fee next week"
     RIGHT: "Register by Fri Apr 4", "Practice Tue Apr 1 5:30 PM", "Pay $150 fee by Thu Apr 3"
   - For EVENT actions, include the day, date, and time in the title.
     Example: "Tournament Sat Apr 5 10 AM - 12 PM" (not just "Tournament Saturday")
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
9. Assess the emotional MOOD of this case:
   - "CELEBRATORY" — awards, honors, achievements, milestones, graduations, winning, accomplishments. Moments to celebrate.
   - "POSITIVE" — good news, confirmations, successful completions, thank-you messages. Pleasant but not milestone-level.
   - "NEUTRAL" — standard logistics, scheduling, routine updates. Most cases are this.
   - "URGENT" — problems requiring immediate attention, emergencies, escalations, complaints.
   - "NEGATIVE" — bad news, cancellations, denials, disputes, failures.
   Default to "NEUTRAL" unless the emails clearly indicate otherwise.

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

FINANCIAL AMOUNTS:
When multiple emails discuss the same charge (quote, invoice, payment), report the
FINAL or CONFIRMED amount ONCE, not the sum of every mention. Email threads typically
reference the same dollar figure repeatedly (original quote, approval, confirmation,
invoice) -- these are the SAME charge, not separate charges.

For the "cost" extracted field, report the single most recent/authoritative amount.

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
  "mood": "CELEBRATORY" | "POSITIVE" | "NEUTRAL" | "URGENT" | "NEGATIVE",
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
  // Cap at 30 most recent emails to manage context window
  const sortedEmails = [...emails].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const cappedEmails = sortedEmails.slice(0, 30);
  const wasTruncated = emails.length > 30;

  const emailBlocks = cappedEmails
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

  return `Synthesize the following ${cappedEmails.length} email(s) into a single case:${wasTruncated ? `\n(Note: This case has ${emails.length} total emails. Showing the ${cappedEmails.length} most recent.)` : ""}

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
