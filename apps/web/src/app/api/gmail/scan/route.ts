import { GmailClient } from "@/lib/gmail/client";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
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
      return NextResponse.json({ error: "Gmail not connected" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const maxResults = typeof body?.maxResults === "number" ? body.maxResults : 200;

    const gmail = new GmailClient(providerToken);
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
