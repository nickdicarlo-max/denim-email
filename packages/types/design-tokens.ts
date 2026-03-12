/**
 * Design Tokens
 *
 * Single source of truth for all visual values.
 * Import these tokens in Tailwind config, components, and the Chrome extension.
 *
 * Usage:
 *   import { colors, typography, spacing, radii, shadows } from "@denim/types/tokens";
 *
 * Tailwind usage:
 *   These tokens are mapped into tailwind.config.ts via the extend key.
 *   Use Tailwind classes (e.g., `bg-surface`, `text-primary`) rather than
 *   referencing tokens directly in components.
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const colors = {
  // --- Surfaces ---
  surface: "#F7F6F3", // Warm off-white. Primary background. Signature element.
  card: "#FFFFFF", // Cards, elevated surfaces, inputs
  cardHover: "#FAFAF8", // Card hover state
  overlay: "rgba(0, 0, 0, 0.4)", // Bottom sheet / modal backdrop
  subtle: "#F0EFEB", // Secondary backgrounds, disabled states, chips

  // --- Text ---
  primary: "#1A1A1A", // Headings, body text, high-emphasis content
  secondary: "#6B6B6B", // Supporting text, descriptions, labels
  muted: "#9B9B9B", // Timestamps, hints, placeholders
  inverse: "#FFFFFF", // Text on dark or colored backgrounds

  // --- Borders ---
  border: "#E8E6E1", // Card borders, dividers, input borders
  borderLight: "#F0EFEB", // Subtle separators within cards

  // --- Interactive ---
  accent: "#2563EB", // Primary buttons, links, focus rings, active elements
  accentSoft: "#EFF4FF", // Accent background tint (selected states, hover fills)
  accentText: "#1D4ED8", // High-contrast accent for text on light backgrounds

  // --- Semantic: Success ---
  success: "#16A34A", // Resolved status, positive actions, checkmarks
  successSoft: "#ECFDF5", // Success background tint
  successText: "#15803D", // Success text on light backgrounds

  // --- Semantic: Warning ---
  warning: "#D97706", // Active status, attention needed, pending actions
  warningSoft: "#FFFBEB", // Warning background tint
  warningText: "#B45309", // Warning text on light backgrounds

  // --- Semantic: Error ---
  error: "#DC2626", // Errors, destructive actions, thumbs down
  errorSoft: "#FEF2F2", // Error background tint
  errorText: "#B91C1C", // Error text on light backgrounds

  // --- Semantic: Improving ---
  improving: "#6366F1", // Accuracy metrics, calibration progress, "getting smarter"
  improvingSoft: "#EEF2FF", // Improving background tint
  improvingText: "#4F46E5", // Improving text on light backgrounds

  // --- Entity chips ---
  entityPrimary: "#2563EB", // "What" chips (blue) - schools, properties, projects
  entityPrimaryBg: "#EFF4FF",
  entitySecondary: "#D97706", // "Who" chips (amber) - teachers, vendors, contacts
  entitySecondaryBg: "#FFFBEB",
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const typography = {
  // Font families
  fontFamily: {
    sans: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  },

  // Font sizes with line heights
  // Named for usage context, not abstract scale
  fontSize: {
    xs: ["11px", { lineHeight: "16px" }], // Timestamps, badges, micro labels
    sm: ["12px", { lineHeight: "16px" }], // Tags, secondary info, card metadata
    base: ["14px", { lineHeight: "20px" }], // Body text, card titles, input text
    md: ["15px", { lineHeight: "22px" }], // Section headers, button text
    lg: ["17px", { lineHeight: "24px" }], // Screen titles, primary headings
    xl: ["20px", { lineHeight: "28px" }], // Hero headings (rare in side panel)
  },

  // Font weights
  fontWeight: {
    normal: "400", // Body text
    medium: "500", // Tags, labels, secondary emphasis
    semibold: "600", // Card titles, buttons, headings
    bold: "700", // Hero headings only (use sparingly)
  },

  // Label styles (uppercase small caps for status labels)
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
  // Base unit: 4px
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

  // Semantic spacing
  cardPadding: "14px 16px", // Standard card internal padding
  sectionGap: "16px", // Gap between sections in a screen
  cardGap: "8px", // Gap between cards in a list
  chipGap: "6px", // Gap between tag/entity chips
  inlineGap: "4px", // Gap between inline elements (icon + text)
} as const;

// ---------------------------------------------------------------------------
// Border Radius
// ---------------------------------------------------------------------------

export const radii = {
  xs: "4px", // Inline code, tiny elements
  sm: "6px", // Tags, chips, small buttons
  md: "8px", // Buttons, inputs, small cards
  lg: "12px", // Cards, modals, bottom sheets
  xl: "16px", // Large cards, hero elements
  full: "9999px", // Pills, avatars, circular buttons
} as const;

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

export const shadows = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
  md: "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
  lg: "0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)",
  xl: "0 8px 24px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.06)",
} as const;

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export const animation = {
  // Duration
  fast: "150ms", // Hover states, focus rings, color changes
  normal: "200ms", // Fade in/out, small movements
  slow: "300ms", // Slide up (bottom sheets), larger movements

  // Easing
  ease: "cubic-bezier(0.4, 0, 0.2, 1)", // General purpose
  easeIn: "cubic-bezier(0.4, 0, 1, 1)", // Elements entering
  easeOut: "cubic-bezier(0, 0, 0.2, 1)", // Elements leaving

  // Presets (for Tailwind arbitrary values or inline styles)
  fadeIn: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slideUp: "transform 300ms cubic-bezier(0, 0, 0.2, 1)",
} as const;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const layout = {
  // Side panel widths
  sidePanel: {
    min: "375px", // Minimum supported (phone-sized)
    default: "420px", // Default Chrome side panel
    max: "500px", // Maximum useful width
  },

  // Touch targets
  touchTarget: {
    min: "44px", // Minimum tappable area (Apple HIG)
  },

  // Z-index scale
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
// Semantic tokens that reference the primitives above.
// Use these in component styles for consistency.

export const components = {
  // Case card
  caseCard: {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: spacing.cardPadding,
    shadow: shadows.md,
    shadowHover: shadows.lg,
  },

  // Tags / pills
  tag: {
    borderRadius: radii.full,
    paddingX: spacing[2],
    paddingY: spacing[1],
    fontSize: typography.fontSize.sm[0],
    fontWeight: typography.fontWeight.medium,
  },

  // Entity chips (interview)
  entityChip: {
    borderRadius: radii.full,
    paddingX: spacing[3],
    paddingY: spacing[2],
    fontSize: typography.fontSize.sm[0],
    fontWeight: typography.fontWeight.medium,
  },

  // Buttons
  button: {
    primary: {
      background: colors.accent,
      color: colors.inverse,
      borderRadius: radii.md,
      fontWeight: typography.fontWeight.semibold,
      fontSize: typography.fontSize.md[0],
      paddingX: spacing[4],
      paddingY: spacing[3],
    },
    secondary: {
      background: colors.card,
      color: colors.primary,
      border: `1px solid ${colors.border}`,
      borderRadius: radii.md,
      fontWeight: typography.fontWeight.medium,
      fontSize: typography.fontSize.base[0],
      paddingX: spacing[4],
      paddingY: spacing[3],
    },
    ghost: {
      background: "transparent",
      color: colors.accentText,
      borderRadius: radii.md,
      fontWeight: typography.fontWeight.medium,
      fontSize: typography.fontSize.base[0],
      paddingX: spacing[3],
      paddingY: spacing[2],
    },
  },

  // Inputs
  input: {
    background: colors.card,
    border: `1.5px solid ${colors.border}`,
    borderFocus: `1.5px solid ${colors.accent}`,
    borderRadius: radii.md,
    fontSize: typography.fontSize.base[0],
    padding: `${spacing[3]} ${spacing[3.5]}`,
    color: colors.primary,
    placeholderColor: colors.muted,
  },

  // Bottom sheet
  bottomSheet: {
    background: colors.card,
    borderRadius: `${radii.xl} ${radii.xl} 0 0`,
    shadow: shadows.xl,
    handleColor: colors.border,
    handleWidth: "40px",
    handleHeight: "4px",
  },

  // Toast notification
  toast: {
    background: colors.primary,
    color: colors.inverse,
    borderRadius: radii.full,
    fontSize: typography.fontSize.sm[0],
    padding: `${spacing[2.5]} ${spacing[4]}`,
    shadow: shadows.lg,
  },

  // Status label (uppercase, colored)
  statusLabel: {
    active: { color: colors.warningText, ...typography.label },
    resolved: { color: colors.successText, ...typography.label },
    calibrating: { color: colors.improvingText, ...typography.label },
  },

  // Metric bar
  metricBar: {
    background: colors.subtle,
    progressColor: colors.improving,
    borderRadius: radii.sm,
    height: "6px",
  },

  // Summary section dots
  summaryDot: {
    beginning: colors.accent,
    middle: colors.warning,
    end: colors.success,
    size: "8px",
  },

  // Swipe action buttons
  swipeAction: {
    move: { background: colors.accent, color: colors.inverse },
    exclude: { background: colors.muted, color: colors.inverse },
  },

  // Thumbs feedback
  thumbs: {
    up: { color: colors.success, activeBackground: colors.successSoft },
    down: { color: colors.error, activeBackground: colors.errorSoft },
  },
} as const;

// ---------------------------------------------------------------------------
// Tailwind Config Extension
// ---------------------------------------------------------------------------
// Copy this into tailwind.config.ts under `theme.extend`

export const tailwindExtend = {
  colors: {
    surface: colors.surface,
    subtle: colors.subtle,
    primary: colors.primary,
    secondary: colors.secondary,
    muted: colors.muted,
    inverse: colors.inverse,
    border: colors.border,
    "border-light": colors.borderLight,
    accent: {
      DEFAULT: colors.accent,
      soft: colors.accentSoft,
      text: colors.accentText,
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
