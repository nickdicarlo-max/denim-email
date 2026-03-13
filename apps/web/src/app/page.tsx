"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/interview");
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface">
      <div className="animate-pulse text-muted text-sm">Loading...</div>
    </main>
  );
}
