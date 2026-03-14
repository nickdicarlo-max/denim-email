import { GmailClient } from "@/lib/gmail/client";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { validateHypothesis } from "@/lib/services/interview";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const { hypothesis } = body;

    if (!hypothesis) {
      return NextResponse.json({ error: "Missing hypothesis" }, { status: 400 });
    }

    const gmailToken = await getValidGmailToken(userId);
    const gmail = new GmailClient(gmailToken);
    const { messages, discoveries } = await gmail.sampleScan(200);

    const emailSamples = messages.map((m) => ({
      subject: m.subject,
      senderDomain: m.senderDomain,
      senderName: m.senderDisplayName || m.senderEmail,
      snippet: m.snippet,
    }));

    const validation = await validateHypothesis(hypothesis, emailSamples, {
      userId,
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
