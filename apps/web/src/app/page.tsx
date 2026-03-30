import { GetStartedButton } from "@/components/landing/get-started-button";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
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
      redirectTo = schemaCount > 0 ? "/dashboard" : "/interview";
    }
  } catch {
    // Auth errors (no session) — fall through to landing page
  }

  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <main className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
        <span className="text-xl font-bold text-primary tracking-tight">denim</span>
        <GetStartedButton />
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 pb-20">
        <h1 className="text-4xl sm:text-5xl font-bold text-primary tracking-tight max-w-2xl leading-tight">
          Your email, organized into cases
        </h1>
        <p className="mt-4 text-lg text-secondary max-w-lg leading-relaxed">
          Connect your Gmail and let AI turn scattered threads into clear,
          actionable cases — no folders, no labels, no rules to maintain.
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
