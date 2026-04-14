type FontSizeEntry = readonly [string, { lineHeight: string }];

interface TypographySectionProps {
  typography: {
    fontFamily: { serif: string; sans: string; mono: string };
    fontSize: Record<string, FontSizeEntry>;
    fontWeight: Record<string, string>;
    label: {
      fontSize: string;
      fontWeight: string;
      textTransform: "uppercase";
      letterSpacing: string;
      lineHeight: string;
    };
  };
}

export function TypographySection({ typography }: TypographySectionProps) {
  const sizeOrder = ["xs", "sm", "base", "md", "lg", "xl", "2xl"];

  return (
    <section id="typography" className="space-y-8">
      <header>
        <h2 className="font-serif text-xl mb-2">Typography</h2>
        <p className="text-sm text-secondary">
          Noto Serif for display + headlines. Plus Jakarta Sans for body. JetBrains Mono for code.
        </p>
      </header>

      {/* Font families */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-md border border-border-light p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
            Serif — display
          </div>
          <div className="font-serif text-2xl text-primary">A calm digital curator.</div>
          <div className="font-mono text-[11px] text-muted mt-3 truncate">
            {typography.fontFamily.serif}
          </div>
        </div>
        <div className="bg-white rounded-md border border-border-light p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
            Sans — body
          </div>
          <div className="font-sans text-2xl text-primary">Built for clarity.</div>
          <div className="font-mono text-[11px] text-muted mt-3 truncate">
            {typography.fontFamily.sans}
          </div>
        </div>
        <div className="bg-white rounded-md border border-border-light p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
            Mono — code
          </div>
          <div className="font-mono text-xl text-primary">{`{ schemaId }`}</div>
          <div className="font-mono text-[11px] text-muted mt-3 truncate">
            {typography.fontFamily.mono}
          </div>
        </div>
      </div>

      {/* Size scale */}
      <div className="bg-white rounded-md border border-border-light overflow-hidden">
        <div className="px-5 py-3 border-b border-border-light">
          <h3 className="font-serif text-base">Scale</h3>
        </div>
        <div className="divide-y divide-border-light">
          {sizeOrder.map((size) => {
            const entry = typography.fontSize[size];
            if (!entry) return null;
            const [px, meta] = entry;
            return (
              <div key={size} className="px-5 py-4 flex items-baseline gap-6">
                <div className="w-16 shrink-0">
                  <div className="font-mono text-xs text-muted">{size}</div>
                  <div className="font-mono text-[10px] text-muted">{px}</div>
                </div>
                <div
                  className="font-sans text-primary flex-1 truncate"
                  style={{ fontSize: px, lineHeight: meta.lineHeight }}
                >
                  The quick brown fox jumps over the lazy dog
                </div>
                <div className="font-mono text-[10px] text-muted shrink-0">
                  lh {meta.lineHeight}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weights */}
      <div className="bg-white rounded-md border border-border-light p-5">
        <h3 className="font-serif text-base mb-4">Weights</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(typography.fontWeight).map(([name, value]) => (
            <div key={name}>
              <div className="text-lg text-primary" style={{ fontWeight: value }}>
                Aa Bb Cc
              </div>
              <div className="font-mono text-[11px] text-muted mt-1">
                {name} · {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Label style */}
      <div className="bg-white rounded-md border border-border-light p-5">
        <h3 className="font-serif text-base mb-3">Label style</h3>
        <p className="text-xs text-secondary mb-4">
          Small caps for status labels — paired with serif headlines.
        </p>
        <div
          style={{
            fontSize: typography.label.fontSize,
            fontWeight: typography.label.fontWeight,
            textTransform: typography.label.textTransform,
            letterSpacing: typography.label.letterSpacing,
            lineHeight: typography.label.lineHeight,
          }}
          className="text-imminent-text"
        >
          Active · 3 emails
        </div>
      </div>
    </section>
  );
}
