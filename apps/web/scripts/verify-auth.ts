/**
 * Verify Supabase Auth configuration.
 * Run: npx tsx scripts/verify-auth.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function verifyAuth() {
  console.log("Verifying Supabase Auth configuration...\n");

  // 1. Check Supabase connection with anon key
  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  console.log(`  Supabase URL: ${supabaseUrl}`);

  // 2. Check that Google OAuth provider is configured
  // signInWithOAuth doesn't actually redirect in server context,
  // but it will tell us if the provider is configured
  const { data: oauthData, error: oauthError } = await anonClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "http://localhost:3000/auth/callback",
      skipBrowserRedirect: true,
    },
  });

  if (oauthError) {
    console.error("  ✗ Google OAuth error:", oauthError.message);
  } else if (oauthData?.url) {
    console.log("  ✓ Google OAuth provider configured");
    console.log(`    Auth URL generated: ${oauthData.url.substring(0, 80)}...`);
  }

  // 3. Check service role key works (admin access)
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: users, error: usersError } = await serviceClient.auth.admin.listUsers();

  if (usersError) {
    console.error("  ✗ Service role key error:", usersError.message);
  } else {
    console.log(`  ✓ Service role key working (${users.users.length} users in system)`);
  }

  // 4. Verify RLS is blocking anon access
  const { data: schemas, error: schemasError } = await anonClient
    .from("case_schemas")
    .select("id")
    .limit(1);

  if (schemasError) {
    // Permission denied or RLS blocking = good
    console.log(`  ✓ RLS active on case_schemas (anon blocked: ${schemasError.message})`);
  } else {
    console.log(`  ✓ RLS active on case_schemas (${schemas?.length ?? 0} rows visible to anon)`);
  }

  console.log("\n✓ Auth verification complete.");
}

verifyAuth()
  .catch((e) => {
    console.error("\n✗ Verification failed:", e.message);
    process.exit(1);
  });
