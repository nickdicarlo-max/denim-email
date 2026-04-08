import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeSchemaMetrics } from "@/lib/services/scan-metrics";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TopicListClient } from "./topic-list-client";

export default async function TopicsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const schemas = await prisma.caseSchema.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      createdAt: true,
      _count: { select: { entities: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const serialized = await Promise.all(
    schemas.map(async (s) => {
      const metrics = await computeSchemaMetrics(s.id);
      return {
        id: s.id,
        name: s.name,
        domain: s.domain,
        status: s.status,
        emailCount: metrics.emailCount,
        caseCount: metrics.caseCount,
        entityCount: s._count.entities,
        createdAt: s.createdAt.toISOString(),
      };
    }),
  );

  return <TopicListClient topics={serialized} />;
}
