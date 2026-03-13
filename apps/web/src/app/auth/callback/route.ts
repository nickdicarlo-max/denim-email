import { createServerSupabaseClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/interview";

  if (code) {
    try {
      const supabase = createServerSupabaseClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      console.error("Auth callback: code exchange failed:", error.message);
    } catch (err) {
      console.error("Auth callback: unexpected error:", err);
    }
  }

  // Redirect to interview with error param instead of a nonexistent error page
  return NextResponse.redirect(`${origin}/interview?auth_error=true`);
}
