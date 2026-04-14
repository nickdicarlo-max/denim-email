import {
  animation,
  colors,
  layout,
  radii,
  shadows,
  spacing,
  typography,
} from "@denim/types/design-tokens";
import { ColorSection } from "./sections/color-section";
import { ComponentsSection } from "./sections/components-section";
import { TokensSection } from "./sections/tokens-section";
import { TypographySection } from "./sections/typography-section";

export const metadata = {
  title: "Design System — Case Engine",
  description: "Visual reference for design tokens and components.",
};

const NAV_SECTIONS = [
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "spacing", label: "Spacing" },
  { id: "radii", label: "Radii" },
  { id: "shadows", label: "Shadows" },
  { id: "components", label: "Components" },
];

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-surface text-primary font-sans">
      <header className="border-b border-border-light bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-8 py-6 flex items-baseline justify-between gap-8 flex-wrap">
          <div>
            <h1 className="font-serif text-2xl text-primary">Design System</h1>
            <p className="text-sm text-secondary mt-1">
              The Digital Curator — editorial, tactile, warm. Live token + component reference.
            </p>
          </div>
          <nav className="flex gap-1 flex-wrap">
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="px-3 py-1.5 text-sm text-secondary hover:text-accent hover:bg-accent-soft rounded-sm transition"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-8 py-12 space-y-20">
        <ColorSection colors={colors} />
        <TypographySection typography={typography} />
        <TokensSection spacing={spacing} radii={radii} shadows={shadows} />
        <ComponentsSection />

        <section id="meta" className="pt-8 border-t border-border-light">
          <h2 className="font-serif text-xl mb-4">Meta</h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex justify-between border-b border-border-light py-2">
              <dt className="text-secondary">Side panel width</dt>
              <dd className="font-mono">{layout.sidePanel.default}</dd>
            </div>
            <div className="flex justify-between border-b border-border-light py-2">
              <dt className="text-secondary">Container max</dt>
              <dd className="font-mono">{layout.container.max}</dd>
            </div>
            <div className="flex justify-between border-b border-border-light py-2">
              <dt className="text-secondary">Touch target min</dt>
              <dd className="font-mono">{layout.touchTarget.min}</dd>
            </div>
            <div className="flex justify-between border-b border-border-light py-2">
              <dt className="text-secondary">Animation fast / normal / slow</dt>
              <dd className="font-mono">
                {animation.fast} / {animation.normal} / {animation.slow}
              </dd>
            </div>
          </dl>
        </section>

        <footer className="text-center text-xs text-muted py-8">
          Source: <code className="font-mono">packages/types/design-tokens.ts</code> ·{" "}
          <code className="font-mono">apps/web/src/components/ui/*</code>
        </footer>
      </main>
    </div>
  );
}
