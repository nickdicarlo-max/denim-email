import { GmailClient } from "@/lib/gmail/client";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { validateHypothesis } from "@/lib/services/interview";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const { hypothesis } = body;

    if (!hypothesis) {
      return NextResponse.json({ error: "Missing hypothesis" }, { status: 400 });
    }

    // Get the provider token from the Supabase session
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.slice(7) ?? "";

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const providerToken = session?.provider_token;

    if (!providerToken) {
      return NextResponse.json(
        { error: "Gmail not connected. Please connect Gmail first." },
        { status: 401 },
      );
    }

    // Sample scan recent emails
    const gmail = new GmailClient(providerToken);
    const { messages, discoveries } = await gmail.sampleScan(200);

    // Map messages to validation samples
    const emailSamples = messages.map((m) => ({
      subject: m.subject,
      senderDomain: m.senderDomain,
      senderName: m.senderDisplayName || m.senderEmail,
      snippet: m.snippet,
    }));

    // Validate hypothesis against real email samples
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
