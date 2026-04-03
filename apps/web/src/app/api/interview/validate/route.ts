import { GmailClient } from "@/lib/gmail/client";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { validateHypothesis } from "@/lib/services/interview";
import { resolveEntity } from "@denim/engine";
import type { SchemaHypothesis } from "@denim/types";
import { NextResponse } from "next/server";

/**
 * Resolve WHO entity names to sender email addresses by fuzzy-matching
 * against the sampled emails. Enriches hypothesis entity aliases in-place.
 */
function resolveWhoEmails(
  hypothesis: SchemaHypothesis,
  messages: { senderDisplayName: string; senderEmail: string }[],
) {
  const whoEntities = hypothesis.entities.filter((e) => e.type === "SECONDARY");
  if (whoEntities.length === 0) return;

  // Build entity list for resolveEntity
  const entityList = whoEntities.map((e) => ({
    name: e.name,
    type: e.type as "PRIMARY" | "SECONDARY",
    aliases: e.aliases,
  }));

  // Track resolved emails per entity to avoid duplicates
  const resolvedEmails = new Map<string, Set<string>>();
  for (const e of whoEntities) {
    resolvedEmails.set(e.name, new Set(e.aliases));
  }

  for (const msg of messages) {
    if (!msg.senderDisplayName) continue;
    const match = resolveEntity(msg.senderDisplayName, msg.senderEmail, entityList, 0.80);
    if (match) {
      const aliasSet = resolvedEmails.get(match.entityName);
      if (aliasSet && !aliasSet.has(msg.senderEmail)) {
        aliasSet.add(msg.senderEmail);
        // Add email address to the entity's aliases on the hypothesis
        const entity = whoEntities.find((e) => e.name === match.entityName);
        if (entity) {
          entity.aliases.push(msg.senderEmail);
        }
      }
    }
  }
}

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const { hypothesis, entityGroups } = body;

    if (!hypothesis) {
      return NextResponse.json({ error: "Missing hypothesis" }, { status: 400 });
    }

    const gmailToken = await getValidGmailToken(userId);
    const gmail = new GmailClient(gmailToken);
    const { messages, discoveries } = await gmail.sampleScan(200);

    // Resolve WHO names to sender email addresses from sampled emails
    resolveWhoEmails(hypothesis, messages);

    const emailSamples = messages.map((m) => ({
      subject: m.subject,
      senderDomain: m.senderDomain,
      senderName: m.senderDisplayName || m.senderEmail,
      snippet: m.snippet,
    }));

    const validation = await validateHypothesis(hypothesis, emailSamples, {
      userId,
      entityGroups,
    });

    return NextResponse.json({ data: { validation, discoveries } });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "validate",
      userId,
    });
  }
});
