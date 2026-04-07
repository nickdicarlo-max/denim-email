"use client";

import Image from "next/image";

export function FeedHeader({ avatarUrl }: { avatarUrl?: string | null }) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-6 py-4 flex items-center justify-between">
      <h1 className="font-serif text-xl font-bold text-primary tracking-wide">Denim</h1>
      {avatarUrl ? (
        <Image src={avatarUrl} alt="" width={32} height={32} className="rounded-full" unoptimized />
      ) : (
        <span className="material-symbols-outlined text-[24px] text-secondary">account_circle</span>
      )}
    </header>
  );
}
