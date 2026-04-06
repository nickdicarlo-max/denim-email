/**
 * Design Tokens — "The Digital Curator"
 *
 * Single source of truth for all visual values, derived from DESIGN.md.
 * Import these tokens in Tailwind config, components, and the Chrome extension.
 *
 * Philosophy: editorial, tactile, warm. No pure black. No hard borders.
 * Fonts: Noto Serif (display/headlines) + Plus Jakarta Sans (body/utility).
 * Palette: organic earth tones and muted minerals.
 */

// ---------------------------------------------------------------------------
// Colors — DESIGN.md "The Palette"
// ---------------------------------------------------------------------------

export const colors = {
  // --- Surfaces (warm cream canvas, "Espresso & Cloth") ---
  surface: "#fbf9f6", // Primary background / canvas
  card: "#ffffff", // Cards, elevated surfaces (surface_container_lowest)
  cardHover: "#f5f3f0", // Card hover state (surface_container_low)
  overlay: "rgba(74, 63, 53, 0.4)", // Bottom sheet / modal backdrop (warm-tinted)
  subtle: "#efeeeb", // Secondary backgrounds, chips (surface_container)

  // Surface hierarchy — stacking importance like a physical desk
  surfaceLow: "#f5f3f0", // surface_container_low
  surfaceMid: "#efeeeb", // surface_container
  surfaceHigh: "#eae8e5", // surface_container_high (recessed: search bars, footers)
  surfaceHighest: "#e4e2df", // surface_container_highest (most recessed)

  // --- Text (espresso-toned ink, never pure black) ---
  primary: "#4a3f35", // Headings, body text, high-emphasis content
  secondary: "#82756a", // Supporting text, descriptions, labels (outline)
  muted: "#a89888", // Timestamps, hints, placeholders
  inverse: "#ffffff", // Text on dark or colored backgrounds

  // --- Borders (ghost borders only, 10-20% opacity preferred) ---
  border: "#d4c4b7", // Ghost borders (outline_variant)
  borderLight: "#efeeeb", // Subtle separators within cards

  // --- Interactive (deep caramel brand) ---
  accent: "#7d562d", // Primary buttons, links, focus rings, active elements
  accentSoft: "#ffdcbd", // Accent background tint (primary_fixed)
  accentText: "#5b3912", // High-contrast accent for text (on_primary_container)
  accentContainer: "#d4a373", // Accent container (primary_container)

  // --- Semantic: Imminent / Urgent (sun-baked coral) ---
  imminent: "#e27d60", // Urgent status, active actions, needs attention
  imminentSoft: "#ffdbd1", // Imminent background tint (tertiary_fixed)
  imminentText: "#7b2e17", // Imminent text (on_tertiary_fixed_variant)

  // --- Semantic: Upcoming / Secondary (serene teal) ---
  upcoming: "#186967", // Future-dated, secondary interest (secondary)
  upcomingSoft: "#a7f0ec", // Upcoming background tint (secondary_container)
  upcomingText: "#00504e", // Upcoming text (on_secondary_fixed_variant)

  // --- Semantic: Success ---
  success: "#16A34A",
  successSoft: "#ECFDF5",
  successText: "#15803D",

  // --- Semantic: Warning ---
  warning: "#D97706",
  warningSoft: "#FFFBEB",
  warningText: "#B45309",

  // --- Semantic: Error ---
  error: "#ba1a1a",
  errorSoft: "#ffdad6",
  errorText: "#93000a",

  // --- Semantic: Improving (calibration progress) ---
  improving: "#6366F1",
  improvingSoft: "#EEF2FF",
  improvingText: "#4F46E5",

  // --- Entity chips ---
  entityPrimary: "#7d562d", // "What" chips (caramel) - schools, properties, projects
  entityPrimaryBg: "#ffdcbd",
  entitySecondary: "#186967", // "Who" chips (teal) - teachers, vendors, contacts
  entitySecondaryBg: "#a7f0ec",
} as const;

// ---------------------------------------------------------------------------
// Typography — "Editorial" feel
// ---------------------------------------------------------------------------

export const typography = {
  fontFamily: {
    serif: "'Noto Serif', 'Georgia', 'Times New Roman', serif",
    sans: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  },

  // Display & Headlines use Noto Serif with wide tracking and generous leading.
  // Body & Titles use Plus Jakarta Sans for legibility.
  fontSize: {
    xs: ["11px", { lineHeight: "16px" }], // Timestamps, badges, micro labels
    sm: ["12px", { lineHeight: "16px" }], // Tags, secondary info, card metadata
    base: ["14px", { lineHeight: "22px" }], // Body text, card titles, input text
    md: ["15px", { lineHeight: "24px" }], // Section headers, button text
    lg: ["18px", { lineHeight: "26px" }], // Screen titles, primary headings
    xl: ["22px", { lineHeight: "30px" }], // Hero headings (display-md)
    "2xl": ["28px", { lineHeight: "36px" }], // Display-lg hero moments
  },

  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },

  // Label styles — uppercase small caps for status labels
  // "Large Serif headlines paired with much smaller, all-caps Sans-Serif labels"
  label: {
    fontSize: "10px",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    lineHeight: "14px",
  },
} as const;

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export const spacing = {
  0: "0px",
  0.5: "2px",
  1: "4px",
  1.5: "6px",
  2: "8px",
  2.5: "10px",
  3: "12px",
  3.5: "14px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",

  // Semantic spacing — "if you think there is enough space, add 16px more"
  cardPadding: "24px 32px", // Generous: "2rem (32px) of internal padding"
  sectionGap: "24px",
  cardGap: "12px",
  chipGap: "6px",
  inlineGap: "4px",
} as const;

// ---------------------------------------------------------------------------
// Border Radius — "minimum radius for any visible container is 8px"
// ---------------------------------------------------------------------------

export const radii = {
  xs: "4px", // Inline code, tiny elements
  sm: "8px", // Tags, chips, small buttons (min visible radius)
  md: "12px", // Inputs, search (custom scale from DESIGN.md)
  lg: "24px", // Cards, modals, bottom sheets (DESIGN.md: 24px)
  xl: "32px", // Large cards, hero elements
  full: "9999px", // Pills, avatars, circular buttons
} as const;

// ---------------------------------------------------------------------------
// Shadows — "Warm Glow" (tinted, not gray)
// ---------------------------------------------------------------------------

export const shadows = {
  sm: "0 1px 3px rgba(74, 63, 53, 0.04)",
  md: "0 2px 8px rgba(74, 63, 53, 0.06), 0 1px 3px rgba(74, 63, 53, 0.04)",
  lg: "0 8px 24px rgba(125, 86, 45, 0.06), 0 2px 6px rgba(74, 63, 53, 0.04)",
  xl: "0 20px 40px rgba(74, 63, 53, 0.06)", // "editorial-shadow" from Stitch
} as const;

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export const animation = {
  fast: "150ms",
  normal: "200ms",
  slow: "300ms",

  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",

  fadeIn: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slideUp: "transform 300ms cubic-bezier(0, 0, 0.2, 1)",
} as const;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const layout = {
  sidePanel: {
    min: "375px",
    default: "420px",
    max: "500px",
  },

  // Desktop container
  container: {
    max: "1200px",
    padding: "2rem",
  },

  touchTarget: {
    min: "44px",
  },

  zIndex: {
    base: 0,
    card: 1,
    sticky: 10,
    overlay: 100,
    bottomSheet: 200,
    toast: 300,
  },
} as const;

// ---------------------------------------------------------------------------
// Component Tokens
// ---------------------------------------------------------------------------

export const components = {
  caseCard: {
    background: colors.card,
    borderRadius: radii.lg,
    padding: spacing.cardPadding,
    shadow: shadows.md,
    shadowHover: shadows.lg,
  },

  tag: {
    borderRadius: radii.full,
    paddingX: spacing[2],
    paddingY: spacing[1],
    fontSize: typography.fontSize.sm[0],
    fontWeight: typography.fontWeight.medium,
  },

  entityChip: {
    borderRadius: radii.full,
    paddingX: spacing[3],
    paddingY: spacing[2],
    fontSize: typography.fontSize.sm[0],
    fontWeight: typography.fontWeight.medium,
  },

  button: {
    primary: {
      background: colors.accent,
      color: colors.inverse,
      borderRadius: radii.sm,
      fontWeight: typography.fontWeight.semibold,
      fontSize: typography.fontSize.md[0],
      paddingX: spacing[6],
      paddingY: spacing[3],
    },
    secondary: {
      background: colors.surfaceHighest,
      color: colors.primary,
      borderRadius: radii.sm,
      fontWeight: typography.fontWeight.medium,
      fontSize: typography.fontSize.base[0],
      paddingX: spacing[4],
      paddingY: spacing[3],
    },
    ghost: {
      background: "transparent",
      color: colors.accent,
      borderRadius: radii.sm,
      fontWeight: typography.fontWeight.semibold,
      fontSize: typography.fontSize.base[0],
      paddingX: spacing[3],
      paddingY: spacing[2],
    },
  },

  input: {
    background: colors.surfaceHigh,
    borderRadius: radii.md,
    fontSize: typography.fontSize.base[0],
    padding: `${spacing[3]} ${spacing[3.5]}`,
    color: colors.primary,
    placeholderColor: colors.muted,
  },

  bottomSheet: {
    background: colors.card,
    borderRadius: `${radii.xl} ${radii.xl} 0 0`,
    shadow: shadows.xl,
    handleColor: colors.border,
    handleWidth: "40px",
    handleHeight: "4px",
  },

  toast: {
    background: colors.primary,
    color: colors.inverse,
    borderRadius: radii.full,
    fontSize: typography.fontSize.sm[0],
    padding: `${spacing[2.5]} ${spacing[4]}`,
    shadow: shadows.lg,
  },

  statusLabel: {
    active: { color: colors.imminentText, ...typography.label },
    resolved: { color: colors.successText, ...typography.label },
    calibrating: { color: colors.improvingText, ...typography.label },
  },

  metricBar: {
    background: colors.subtle,
    progressColor: colors.improving,
    borderRadius: radii.sm,
    height: "6px",
  },

  summaryDot: {
    beginning: colors.accent,
    middle: colors.imminent,
    end: colors.success,
    size: "8px",
  },

  swipeAction: {
    move: { background: colors.accent, color: colors.inverse },
    exclude: { background: colors.muted, color: colors.inverse },
  },

  thumbs: {
    up: { color: colors.success, activeBackground: colors.successSoft },
    down: { color: colors.error, activeBackground: colors.errorSoft },
  },
} as const;

// ---------------------------------------------------------------------------
// Tailwind Config Extension
// ---------------------------------------------------------------------------

export const tailwindExtend = {
  colors: {
    surface: {
      DEFAULT: colors.surface,
      low: colors.surfaceLow,
      mid: colors.surfaceMid,
      high: colors.surfaceHigh,
      highest: colors.surfaceHighest,
    },
    subtle: colors.subtle,
    primary: colors.primary,
    secondary: colors.secondary,
    muted: colors.muted,
    inverse: colors.inverse,
    border: {
      DEFAULT: colors.border,
      light: colors.borderLight,
    },
    accent: {
      DEFAULT: colors.accent,
      soft: colors.accentSoft,
      text: colors.accentText,
      container: colors.accentContainer,
    },
    imminent: {
      DEFAULT: colors.imminent,
      soft: colors.imminentSoft,
      text: colors.imminentText,
    },
    upcoming: {
      DEFAULT: colors.upcoming,
      soft: colors.upcomingSoft,
      text: colors.upcomingText,
    },
    success: {
      DEFAULT: colors.success,
      soft: colors.successSoft,
      text: colors.successText,
    },
    warning: {
      DEFAULT: colors.warning,
      soft: colors.warningSoft,
      text: colors.warningText,
    },
    error: {
      DEFAULT: colors.error,
      soft: colors.errorSoft,
      text: colors.errorText,
    },
    improving: {
      DEFAULT: colors.improving,
      soft: colors.improvingSoft,
      text: colors.improvingText,
    },
    entity: {
      primary: colors.entityPrimary,
      "primary-bg": colors.entityPrimaryBg,
      secondary: colors.entitySecondary,
      "secondary-bg": colors.entitySecondaryBg,
    },
  },
  fontFamily: {
    serif: [typography.fontFamily.serif],
    sans: [typography.fontFamily.sans],
    mono: [typography.fontFamily.mono],
  },
  borderRadius: {
    xs: radii.xs,
    sm: radii.sm,
    md: radii.md,
    lg: radii.lg,
    xl: radii.xl,
  },
  boxShadow: {
    sm: shadows.sm,
    DEFAULT: shadows.md,
    lg: shadows.lg,
    xl: shadows.xl,
  },
} as const;
