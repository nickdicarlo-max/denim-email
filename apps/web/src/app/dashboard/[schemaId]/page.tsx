import { ScanProgress } from "@/components/dashboard/scan-progress";
import { ScanTrigger } from "@/components/dashboard/scan-trigger";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: "bg-amber-400" },
  ONBOARDING: { label: "Onboarding", color: "bg-amber-400" },
  ACTIVE: { label: "Active", color: "bg-green-500" },
  PAUSED: { label: "Paused", color: "bg-gray-400" },
};

const PHASE_LABELS: Record<string, string> = {
  IDLE: "Idle",
  DISCOVERING: "Discovering emails",
  EXTRACTING: "Extracting data",
  CLUSTERING: "Clustering",
  SYNTHESIZING: "Synthesizing cases",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SchemaDetailPage({
  params,
}: {
  params: Promise<{ schemaId: string }>;
}) {
  const { schemaId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    include: {
      tags: { where: { isActive: true }, orderBy: { emailCount: "desc" } },
      entities: { where: { isActive: true }, orderBy: { type: "asc" } },
      extractedFields: { orderBy: { sortOrder: "asc" } },
      exclusionRules: { where: { isActive: true } },
      scanJobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!schema || schema.userId !== user.id) {
    redirect("/dashboard");
  }

  const statusConfig = STATUS_CONFIG[schema.status] ?? STATUS_CONFIG.PAUSED;
  const primaryEntities = schema.entities.filter((e) => e.type === "PRIMARY");
  const secondaryEntities = schema.entities.filter((e) => e.type === "SECONDARY");

  return (
    <main className="min-h-screen bg-surface">
      <header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <span className="text-xl font-bold text-primary tracking-tight">denim</span>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-accent-text hover:underline"
        >
          &larr; Back to Topics
        </Link>
      </header>

      <div className="px-6 py-8 max-w-4xl mx-auto space-y-8">
        {/* Schema header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">{schema.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              {schema.domain && (
                <span className="inline-block bg-accent-soft text-accent-text text-xs font-medium px-2 py-0.5 rounded-full">
                  {schema.domain}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                {statusConfig.label}
              </span>
            </div>
            <p className="text-sm text-secondary mt-2 max-w-xl">{schema.description}</p>
          </div>
          <ScanTrigger schemaId={schema.id} />
        </div>

        {/* Live stats + scan progress (polls while pipeline is active) */}
        <ScanProgress
          schemaId={schema.id}
          initialEmailCount={schema.emailCount}
          initialCaseCount={schema.caseCount}
        />

        {/* View Cases link */}
        {schema.caseCount > 0 && (
          <Link
            href={`/dashboard/${schema.id}/cases`}
            className="inline-flex items-center gap-2 bg-accent text-inverse rounded-md font-semibold text-sm px-4 py-2.5 hover:opacity-90 transition"
          >
            View {schema.caseCount} {schema.caseCount === 1 ? "Case" : "Cases"} &rarr;
          </Link>
        )}

        {/* Entities */}
        <Section title="Entities">
          {primaryEntities.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                Primary
              </h4>
              <div className="flex flex-wrap gap-2">
                {primaryEntities.map((e) => (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1.5 bg-entity-primary-bg text-entity-primary text-sm font-medium px-3 py-1.5 rounded-full"
                  >
                    {e.name}
                    <span className="text-xs opacity-60">({e.emailCount})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {secondaryEntities.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                Secondary
              </h4>
              <div className="flex flex-wrap gap-2">
                {secondaryEntities.map((e) => (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1.5 bg-entity-secondary-bg text-entity-secondary text-sm font-medium px-3 py-1.5 rounded-full"
                  >
                    {e.name}
                    {e.secondaryTypeName && (
                      <span className="text-xs opacity-60">({e.secondaryTypeName})</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {schema.entities.length === 0 && (
            <p className="text-sm text-muted">No entities detected yet.</p>
          )}
        </Section>

        {/* Tags */}
        <Section title="Tags">
          {schema.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {schema.tags.map((tag) => (
                <span
                  key={tag.id}
                  className={`inline-flex items-center gap-1 text-sm font-medium px-3 py-1 rounded-full ${
                    tag.isWeak
                      ? "bg-subtle text-muted"
                      : "bg-accent-soft text-accent-text"
                  }`}
                >
                  {tag.name}
                  <span className="text-xs opacity-60">({tag.emailCount})</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No tags created yet.</p>
          )}
        </Section>

        {/* Extracted Fields */}
        {schema.extractedFields.length > 0 && (
          <Section title="Extracted Fields">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {schema.extractedFields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between bg-white rounded-lg px-3 py-2 shadow-xs"
                >
                  <div>
                    <span className="text-sm font-medium text-primary">{field.name}</span>
                    <span className="text-xs text-muted ml-2">{field.type.toLowerCase()}</span>
                  </div>
                  {field.showOnCard && (
                    <span className="text-xs bg-accent-soft text-accent-text px-1.5 py-0.5 rounded">
                      on card
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Exclusion Rules */}
        {schema.exclusionRules.length > 0 && (
          <Section title="Exclusion Rules">
            <div className="space-y-1">
              {schema.exclusionRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="text-xs font-mono bg-subtle text-muted px-1.5 py-0.5 rounded">
                    {rule.ruleType.toLowerCase()}
                  </span>
                  <span className="text-primary">{rule.pattern}</span>
                  <span className="text-xs text-muted ml-auto">
                    {rule.matchCount} matches
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Scan History */}
        <Section title="Scan History">
          {schema.scanJobs.length > 0 ? (
            <div className="space-y-3">
              {schema.scanJobs.map((job) => (
                <div
                  key={job.id}
                  className="bg-white rounded-lg shadow-xs px-4 py-3 flex items-center gap-4"
                >
                  <ScanStatusBadge status={job.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-primary">
                      {PHASE_LABELS[job.phase] ?? job.phase}
                    </div>
                    {job.statusMessage && (
                      <p className="text-xs text-secondary truncate">{job.statusMessage}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted whitespace-nowrap">
                    <div>
                      {job.processedEmails}/{job.totalEmails} emails
                    </div>
                    <div>{formatDate(job.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No scans have been run yet.</p>
          )}
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ScanStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    PENDING: { bg: "bg-amber-100", text: "text-amber-700" },
    RUNNING: { bg: "bg-blue-100", text: "text-blue-700" },
    COMPLETED: { bg: "bg-green-100", text: "text-green-700" },
    FAILED: { bg: "bg-red-100", text: "text-red-700" },
  };
  const c = config[status] ?? config.PENDING;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {status}
    </span>
  );
}
