/**
 * Modern button component — variants with hover/active states.
 */

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "success" | "danger" | "warning" | "ghost" | "secondary" | "toggle";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** For toggle variant: whether this option is selected */
  active?: boolean;
  size?: "sm" | "md";
}

export function Button({
  variant = "secondary",
  active,
  size = "md",
  className = "",
  style,
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    variant === "toggle" && active ? "active" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} style={style} {...props}>
      {children}
    </button>
  );
}
