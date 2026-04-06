"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

/**
 * Button — "Digital Curator" style.
 *
 * DESIGN.md rules:
 * - Primary: caramel gradient, on_primary text, "tactile pebble" feel
 * - Secondary: surface_container_highest bg, feels like a tactile pebble
 * - Ghost: text only, Plus Jakarta Sans bold, primary color
 * - Min radius: 8px (sm)
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-inverse rounded-sm font-semibold text-md px-6 py-3 hover:brightness-110 transition-all",
  secondary:
    "bg-surface-highest text-primary rounded-sm font-medium text-base px-4 py-3 hover:bg-surface-high transition-all",
  ghost:
    "bg-transparent text-accent rounded-sm font-semibold text-base px-3 py-2 hover:bg-accent-soft transition-all",
};

export function Button({
  variant = "primary",
  fullWidth = true,
  children,
  className,
  ...props
}: ButtonProps & { fullWidth?: boolean }) {
  const classes = [
    "min-h-[44px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    fullWidth ? "w-full" : "w-auto",
    variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
