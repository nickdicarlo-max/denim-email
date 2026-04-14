import { contrastRatio, gradeContrast } from "../contrast";

interface ColorSectionProps {
  colors: Record<string, string>;
}

const GROUPS: { title: string; description: string; keys: string[] }[] = [
  {
    title: "Surfaces",
    description: "Warm cream canvas. Stacking importance like a physical desk.",
    keys: [
      "surface",
      "card",
      "cardHover",
      "subtle",
      "surfaceLow",
      "surfaceMid",
      "surfaceHigh",
      "surfaceHighest",
    ],
  },
  {
    title: "Text",
    description: "Espresso-toned ink. Never pure black.",
    keys: ["primary", "secondary", "muted", "inverse"],
  },
  {
    title: "Borders",
    description: "Ghost borders only — 10–20% opacity preferred.",
    keys: ["border", "borderLight"],
  },
  {
    title: "Accent (Caramel)",
    description: "Deep caramel brand. Buttons, links, focus rings.",
    keys: ["accent", "accentSoft", "accentText", "accentContainer"],
  },
  {
    title: "Imminent (Coral)",
    description: "Sun-baked coral. Urgent, needs attention.",
    keys: ["imminent", "imminentSoft", "imminentText"],
  },
  {
    title: "Upcoming (Teal)",
    description: "Serene teal. Future-dated, secondary interest.",
    keys: ["upcoming", "upcomingSoft", "upcomingText"],
  },
  {
    title: "Success",
    description: "",
    keys: ["success", "successSoft", "successText"],
  },
  {
    title: "Warning",
    description: "",
    keys: ["warning", "warningSoft", "warningText"],
  },
  {
    title: "Error",
    description: "",
    keys: ["error", "errorSoft", "errorText"],
  },
  {
    title: "Improving",
    description: "Calibration progress.",
    keys: ["improving", "improvingSoft", "improvingText"],
  },
  {
    title: "Entity Chips",
    description: "Caramel = What. Teal = Who.",
    keys: ["entityPrimary", "entityPrimaryBg", "entitySecondary", "entitySecondaryBg"],
  },
];

function isHex(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value);
}

function gradeBadgeClasses(grade: string): string {
  if (grade === "AAA") return "bg-success-soft text-success-text";
  if (grade === "AA") return "bg-success-soft text-success-text";
  if (grade === "AA Large") return "bg-warning-soft text-warning-text";
  return "bg-error-soft text-error-text";
}

function ColorSwatch({
  name,
  value,
  surfaceColor,
}: {
  name: string;
  value: string;
  surfaceColor: string;
}) {
  const ratio = isHex(value) ? contrastRatio(value, surfaceColor) : null;
  const grade = ratio ? gradeContrast(ratio) : null;

  return (
    <div className="flex flex-col rounded-md overflow-hidden border border-border-light bg-white">
      <div
        role="img"
        aria-label={`${name} swatch`}
        className="h-20 w-full border-b border-border-light"
        style={{ backgroundColor: value }}
      />
      <div className="px-3 py-2.5 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-primary truncate">{name}</span>
          {grade && (
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-xs ${gradeBadgeClasses(grade)}`}
            >
              {grade}
            </span>
          )}
        </div>
        <div className="font-mono text-xs text-muted">{value}</div>
        {ratio !== null && (
          <div className="text-[10px] text-muted">contrast vs surface: {ratio.toFixed(2)}:1</div>
        )}
      </div>
    </div>
  );
}

export function ColorSection({ colors }: ColorSectionProps) {
  const surfaceColor = colors.surface ?? "#fbf9f6";

  return (
    <section id="colors" className="space-y-8">
      <header>
        <h2 className="font-serif text-xl mb-2">Colors</h2>
        <p className="text-sm text-secondary">
          Every token from <code className="font-mono">design-tokens.ts</code>. Contrast badges are
          measured against the canvas surface ({surfaceColor}).
        </p>
      </header>

      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-3">
          <div>
            <h3 className="font-serif text-base text-primary">{group.title}</h3>
            {group.description && (
              <p className="text-xs text-secondary mt-0.5">{group.description}</p>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {group.keys.map((key) => {
              const value = colors[key];
              if (!value) return null;
              return <ColorSwatch key={key} name={key} value={value} surfaceColor={surfaceColor} />;
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
