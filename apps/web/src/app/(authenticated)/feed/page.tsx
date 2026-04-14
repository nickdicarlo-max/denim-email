import { redirect } from "next/navigation";
import { FeedClient } from "@/components/feed/feed-client";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function FeedPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarUrl: true },
  });

  return <FeedClient avatarUrl={dbUser?.avatarUrl} />;
}
