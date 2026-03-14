"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SchemaCard } from "./schema-card";

type SchemaStatus = "DRAFT" | "ONBOARDING" | "ACTIVE" | "PAUSED";

interface Schema {
  id: string;
  name: string;
  domain: string | null;
  status: SchemaStatus;
  emailCount: number;
  caseCount: number;
  updatedAt: string;
}

interface SchemaCardListProps {
  initialSchemas: Schema[];
}

export function SchemaCardList({ initialSchemas }: SchemaCardListProps) {
  const [schemas, setSchemas] = useState(initialSchemas);
  const router = useRouter();

  function handleDeleted(id: string) {
    setSchemas((prev) => prev.filter((s) => s.id !== id));
    router.refresh();
  }

  if (schemas.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-secondary text-sm mb-4">No topics yet</p>
        <a
          href="/interview"
          className="text-accent-text font-medium text-sm hover:underline"
        >
          Start your first topic &rarr;
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {schemas.map((schema) => (
        <SchemaCard key={schema.id} schema={schema} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}
