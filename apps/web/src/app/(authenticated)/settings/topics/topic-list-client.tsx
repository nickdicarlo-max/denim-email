"use client";

import Link from "next/link";

interface Topic {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  emailCount: number;
  caseCount: number;
  entityCount: number;
  createdAt: string;
}

export function TopicListClient({ topics }: { topics: Topic[] }) {
  return (
    <div className="px-6 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl font-bold text-primary tracking-wide">My Topics</h1>
        <Link
          href="/onboarding/category"
          className="text-sm font-medium text-accent flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Topic
        </Link>
      </div>

      {topics.length === 0 ? (
        <p className="text-sm text-secondary text-center py-8">No topics set up yet.</p>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="bg-white rounded-lg p-5 flex items-start justify-between"
            >
              <div>
                <h3 className="text-md font-semibold text-primary mb-1">{topic.name}</h3>
                <p className="text-sm text-secondary">
                  {topic.entityCount} entities &middot; {topic.caseCount} cases &middot;{" "}
                  {topic.emailCount} emails
                </p>
                <p className="text-xs text-muted mt-1">
                  Active since{" "}
                  {new Date(topic.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <span
                className={[
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  topic.status === "ACTIVE"
                    ? "bg-success-soft text-success-text"
                    : "bg-surface-mid text-secondary",
                ].join(" ")}
              >
                {topic.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
