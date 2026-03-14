import { SchemaCardList } from "@/components/dashboard/schema-card-list";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const schemas = await prisma.caseSchema.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      emailCount: true,
      caseCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Serialize dates for client components
  const serializedSchemas = schemas.map((s) => ({
    ...s,
    updatedAt: s.updatedAt.toISOString(),
  }));

  return (
    <main className="min-h-screen bg-surface">
      <header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <span className="text-xl font-bold text-primary tracking-tight">denim</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-secondary">{user.email}</span>
          <a
            href="/interview"
            className="text-sm font-medium text-accent-text hover:underline"
          >
            + New Topic
          </a>
        </div>
      </header>

      <div className="px-6 py-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-primary mb-6">Your Topics</h1>
        <SchemaCardList initialSchemas={serializedSchemas} />
      </div>
    </main>
  );
}
