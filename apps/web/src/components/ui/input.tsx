"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  const classes = [
    "w-full bg-white border-[1.5px] border-border rounded-md text-base text-primary px-3.5 py-3 placeholder:text-muted",
    "focus:border-accent focus:ring-1 focus:ring-accent focus:outline-hidden",
    "transition",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <input ref={ref} className={classes} {...props} />;
});

Input.displayName = "Input";
