"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-inverse rounded-md font-semibold text-md px-4 py-3 hover:opacity-90 transition",
  secondary:
    "bg-white border border-border text-primary rounded-md font-medium text-base px-4 py-3 hover:bg-gray-50 transition",
  ghost:
    "bg-transparent text-accent-text rounded-md font-medium text-base px-3 py-2 hover:bg-accent-soft transition",
};

export function Button({ variant = "primary", children, className, ...props }: ButtonProps) {
  const classes = [
    "min-h-[44px] w-full disabled:opacity-50 disabled:cursor-not-allowed",
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
