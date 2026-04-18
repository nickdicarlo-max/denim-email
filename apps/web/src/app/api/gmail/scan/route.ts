import { NextResponse } from "next/server";
import { GmailClient } from "@/lib/gmail/client";
import { getAccessToken } from "@/lib/gmail/credentials";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const maxResults = typeof body?.maxResults === "number" ? body.maxResults : 200;

    const gmailToken = await getAccessToken(userId);
    const gmail = new GmailClient(gmailToken);
    const { messages, discoveries } = await gmail.sampleScan(maxResults);

    return NextResponse.json({ data: { messages, discoveries } });
  } catch (error) {
    return handleApiError(error, {
      service: "gmail",
      operation: "scan",
      userId,
    });
  }
});
