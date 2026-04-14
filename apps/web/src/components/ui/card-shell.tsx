import type { ReactNode } from "react";

interface CardShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * CardShell — "Digital Curator" card surface.
 *
 * DESIGN.md rules:
 * - 24px radius (lg)
 * - No dividers, no 1px borders
 * - Tonal lift via surface_container_lowest (white) on surface background
 * - 32px internal padding
 * - Warm ambient shadow (caramel-tinted, not gray)
 */
export function CardShell({ children, className }: CardShellProps) {
  const classes = ["bg-white rounded-lg shadow-md p-6 md:p-8", className].filter(Boolean).join(" ");

  return <div className={classes}>{children}</div>;
}
