import type { ReactNode } from "react";

interface CardShellProps {
  children: ReactNode;
  className?: string;
}

export function CardShell({ children, className }: CardShellProps) {
  const classes = ["bg-white rounded-lg shadow p-4", className].filter(Boolean).join(" ");

  return <div className={classes}>{children}</div>;
}
