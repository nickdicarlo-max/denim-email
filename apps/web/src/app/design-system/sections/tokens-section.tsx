interface TokensSectionProps {
  spacing: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
}

const NUMERIC_SPACING_KEYS = [
  "0",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "8",
  "10",
  "12",
  "16",
];

const SEMANTIC_SPACING_KEYS = ["cardPadding", "sectionGap", "cardGap", "chipGap", "inlineGap"];

function parsePx(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)px/);
  return match ? Number.parseFloat(match[1]) : 0;
}

export function TokensSection({ spacing, radii, shadows }: TokensSectionProps) {
  return (
    <>
      {/* Spacing */}
      <section id="spacing" className="space-y-6">
        <header>
          <h2 className="font-serif text-xl mb-2">Spacing</h2>
          <p className="text-sm text-secondary">
            "If you think there's enough space, add 16px more." Generous tactile rhythm.
          </p>
        </header>

        <div className="bg-white rounded-md border border-border-light p-5 space-y-3">
          <h3 className="font-serif text-base mb-2">Numeric scale</h3>
          {NUMERIC_SPACING_KEYS.map((key) => {
            const value = spacing[key];
            if (!value) return null;
            const px = parsePx(value);
            return (
              <div key={key} className="flex items-center gap-4">
                <div className="font-mono text-xs text-muted w-10 shrink-0">{key}</div>
                <div className="font-mono text-xs text-muted w-12 shrink-0">{value}</div>
                <div
                  className="bg-accent rounded-xs"
                  style={{ width: `${px}px`, height: "12px" }}
                />
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-md border border-border-light p-5">
          <h3 className="font-serif text-base mb-3">Semantic spacing</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {SEMANTIC_SPACING_KEYS.map((key) => (
              <div key={key} className="flex justify-between border-b border-border-light py-1.5">
                <dt className="text-secondary">{key}</dt>
                <dd className="font-mono text-xs text-primary">{spacing[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Radii */}
      <section id="radii" className="space-y-6">
        <header>
          <h2 className="font-serif text-xl mb-2">Border Radii</h2>
          <p className="text-sm text-secondary">
            Minimum visible radius is 8px. Cards use 24px. Pills go full.
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {Object.entries(radii).map(([name, value]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                className="w-20 h-20 bg-accent-soft border border-border"
                style={{ borderRadius: value }}
              />
              <div className="text-center">
                <div className="font-mono text-xs text-primary">{name}</div>
                <div className="font-mono text-[10px] text-muted">{value}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Shadows */}
      <section id="shadows" className="space-y-6">
        <header>
          <h2 className="font-serif text-xl mb-2">Shadows</h2>
          <p className="text-sm text-secondary">
            "Warm Glow" — caramel-tinted, never gray. Editorial depth.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {Object.entries(shadows).map(([name, value]) => (
            <div key={name} className="flex flex-col items-center gap-3">
              <div
                className="w-full h-24 bg-white rounded-lg flex items-center justify-center"
                style={{ boxShadow: value }}
              >
                <span className="font-serif text-base text-primary">{name}</span>
              </div>
              <div className="font-mono text-[10px] text-muted text-center break-all px-2">
                {value}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
