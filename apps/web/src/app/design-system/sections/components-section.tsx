"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CardShell } from "@/components/ui/card-shell";
import { EntityChip } from "@/components/ui/entity-chip";
import { Input } from "@/components/ui/input";
import { ProgressDots } from "@/components/ui/progress-dots";
import { Tag } from "@/components/ui/tag";

function Demo({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white rounded-md border border-border-light overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="font-serif text-base text-primary">{title}</h3>
        {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
      </div>
      <div className="p-6 bg-surface">{children}</div>
    </div>
  );
}

const noop = () => {};

export function ComponentsSection() {
  return (
    <section id="components" className="space-y-6">
      <header>
        <h2 className="font-serif text-xl mb-2">Components</h2>
        <p className="text-sm text-secondary">
          Live components from <code className="font-mono">apps/web/src/components/ui/</code>.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Demo title="Button" description="primary · secondary · ghost · disabled">
          <div className="space-y-3 max-w-sm">
            <Button variant="primary">Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="ghost">Ghost action</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
        </Demo>

        <Demo title="Input" description="default · with value · disabled">
          <div className="space-y-3 max-w-sm">
            <Input placeholder="Search cases…" />
            <Input defaultValue="Lincoln Elementary" />
            <Input placeholder="Disabled" disabled />
          </div>
        </Demo>

        <Demo title="Tag" description="active · inactive · actionable · sizes">
          <div className="flex flex-wrap gap-2 items-center">
            <Tag label="Permission Slips" />
            <Tag label="Inactive" active={false} />
            <Tag label="Action Required" actionable />
            <Tag label="Removable" onRemove={noop} />
            <Tag label="Small" size="sm" />
            <Tag label="Medium" size="md" />
          </div>
        </Demo>

        <Demo title="EntityChip" description="primary (what) · secondary (who)">
          <div className="flex flex-wrap gap-2">
            <EntityChip name="Lincoln Elementary" entityType="PRIMARY" onRemove={noop} />
            <EntityChip name="1501 Sylvan St" entityType="PRIMARY" onRemove={noop} />
            <EntityChip name="Mrs. Patel" entityType="SECONDARY" onRemove={noop} />
            <EntityChip name="Acme Plumbing" entityType="SECONDARY" onRemove={noop} />
          </div>
        </Demo>

        <Demo title="ProgressDots" description="step indicator for multi-card flows">
          <div className="space-y-2">
            <ProgressDots current={0} total={4} />
            <ProgressDots current={2} total={4} />
            <ProgressDots current={3} total={4} />
          </div>
        </Demo>

        <Demo title="CardShell" description="elevated surface, 24px radius, warm shadow">
          <CardShell>
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-imminent-text font-semibold">
                Active · 3 emails
              </div>
              <h4 className="font-serif text-lg text-primary">Permission slip due Friday</h4>
              <p className="text-sm text-secondary">
                Mrs. Patel sent the reminder twice. Two parents replied with questions about the
                pickup time.
              </p>
            </div>
          </CardShell>
        </Demo>
      </div>
    </section>
  );
}
