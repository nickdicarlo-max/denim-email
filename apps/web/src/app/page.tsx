import { redirect } from "next/navigation";
import { GetStartedButton } from "@/components/landing/get-started-button";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Copy for the sign-in-failure banner. Keyed on the `reason` param from
 * `/auth/callback`'s errorRedirect (and, when present, the `detail` param
 * which carries the typed `CredentialFailure.reason` for deeper classification).
 *
 * The callback fails closed — every failure path reaches this page, not a
 * happy-path redirect. Before #124 we rendered nothing for these, so users
 * saw an identical landing page after a silent failure. Now they see a
 * specific remedy.
 */
function authErrorCopy(reason: string, detail?: string): { title: string; body: string } {
  // #124: typed account_conflict — OAuth won't fix this, contact support.
  if (reason === "CREDENTIAL_STORE_FAILED" && detail === "account_conflict") {
    return {
      title: "Sign-in blocked by a data conflict",
      body: "Your Google account signed in, but a conflicting record is blocking account setup. Reconnecting won't fix it — please contact support with this error code: account_conflict.",
    };
  }
  if (reason === "CREDENTIAL_STORE_FAILED") {
    return {
      title: "Couldn't save your Google credentials",
      body: "Sign-in succeeded but we couldn't persist your access. Try signing in again; if the problem repeats, contact support.",
    };
  }
  if (reason === "TOKEN_SHAPE_INVALID") {
    return {
      title: "Google didn't return the expected tokens",
      body: "This usually means a permission was denied on the Google consent screen. Try signing in again and grant the Gmail read permission.",
    };
  }
  if (reason === "EXCHANGE_FAILED") {
    return {
      title: "Google sign-in exchange failed",
      body: "Try signing in again. If the problem repeats, contact support.",
    };
  }
  return {
    title: "Sign-in failed",
    body: "Try again. If the problem repeats, contact support.",
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let redirectTo: string | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const schemaCount = await prisma.caseSchema.count({
        where: { userId: user.id },
      });
      redirectTo = schemaCount > 0 ? "/feed" : "/onboarding/category";
    }
  } catch {
    // Auth errors (no session) — fall through to landing page
  }

  if (redirectTo) {
    redirect(redirectTo);
  }

  const resolvedParams = await searchParams;
  const authError = resolvedParams.auth_error === "true";
  const reasonParam = Array.isArray(resolvedParams.reason)
    ? resolvedParams.reason[0]
    : resolvedParams.reason;
  const detailParam = Array.isArray(resolvedParams.detail)
    ? resolvedParams.detail[0]
    : resolvedParams.detail;
  const authCopy = authError && reasonParam ? authErrorCopy(reasonParam, detailParam) : null;

  return (
    <main className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
        <span className="text-xl font-bold text-primary tracking-tight">denim</span>
        <GetStartedButton />
      </header>

      {authCopy && (
        <div className="max-w-2xl mx-auto w-full px-6 mt-4">
          <div className="rounded-lg bg-accent-soft border border-border p-4">
            <h2 className="font-semibold text-accent-text text-base">{authCopy.title}</h2>
            <p className="text-sm text-accent-text mt-1">{authCopy.body}</p>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 pb-20">
        <h1 className="text-4xl sm:text-5xl font-bold text-primary tracking-tight max-w-2xl leading-tight">
          Your email, organized into cases
        </h1>
        <p className="mt-4 text-lg text-secondary max-w-lg leading-relaxed">
          Connect your Gmail and let AI turn scattered threads into clear, actionable cases — no
          folders, no labels, no rules to maintain.
        </p>
        <div className="mt-8">
          <GetStartedButton />
        </div>
      </section>

      {/* Feature cards */}
      <section className="px-6 pb-16 max-w-4xl mx-auto w-full">
        <div className="grid gap-6 sm:grid-cols-3">
          <FeatureCard
            title="Smart interview"
            description="Tell us about your work in plain language. We build a custom schema tailored to your domain."
          />
          <FeatureCard
            title="Automatic clustering"
            description="Emails are grouped into cases using metadata — sender patterns, subjects, timestamps, and entities."
          />
          <FeatureCard
            title="AI-powered actions"
            description="Each case gets a summary, status, and action items extracted from your conversations."
          />
        </div>
      </section>
    </main>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-base font-bold text-primary mb-2">{title}</h3>
      <p className="text-sm text-secondary leading-relaxed">{description}</p>
    </div>
  );
}
