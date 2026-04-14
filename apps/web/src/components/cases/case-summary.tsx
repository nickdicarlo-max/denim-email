"use client";

interface CaseSummaryProps {
  summary: { beginning: string; middle: string; end: string };
  summaryLabels: { beginning: string; middle: string; end: string };
  aggregatedData: Record<string, unknown>;
  extractedFieldDefs: { name: string; type: string; format: string | null }[];
}

export function CaseSummary({
  summary,
  summaryLabels,
  aggregatedData,
  extractedFieldDefs,
}: CaseSummaryProps) {
  const sections = [
    { label: summaryLabels.beginning, content: summary.beginning },
    { label: summaryLabels.middle, content: summary.middle },
    { label: summaryLabels.end, content: summary.end },
  ].filter((s) => s.content);

  const dataEntries = extractedFieldDefs
    .filter((def) => aggregatedData[def.name] != null)
    .map((def) => ({
      label: def.name,
      value: formatFieldValue(aggregatedData[def.name], def.format),
    }));

  return (
    <section className="bg-white rounded-lg shadow p-4 space-y-4">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Summary</h2>

      {sections.map((section) => (
        <div key={section.label}>
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">
            {section.label}
          </h3>
          <p className="text-sm text-primary leading-relaxed">{section.content}</p>
        </div>
      ))}

      {dataEntries.length > 0 && (
        <div className="border-t border-border pt-3">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Key Data
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {dataEntries.map((entry) => (
              <div key={entry.label} className="flex justify-between text-sm">
                <span className="text-secondary capitalize">{entry.label}</span>
                <span className="text-primary font-medium">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function formatFieldValue(value: unknown, format: string | null): string {
  if (value == null) return "-";
  if (format === "currency") return `$${Number(value).toLocaleString()}`;
  if (format === "percentage") return `${Number(value)}%`;
  if (format === "date" && typeof value === "string") {
    return new Date(value).toLocaleDateString();
  }
  return String(value);
}
