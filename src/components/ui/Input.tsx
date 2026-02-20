import { theme } from "../../theme";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "style"> {
  style?: React.CSSProperties;
}

export function Input({ style, ...props }: InputProps) {
  return (
    <input
      style={{
        padding: theme.spacing.sm,
        borderRadius: theme.radius.md,
        background: theme.colors.bg.cardAlt,
        color: theme.colors.text.primary,
        border: `1px solid ${theme.colors.border}`,
        fontSize: "0.9rem",
        boxSizing: "border-box",
        ...style,
      }}
      {...props}
    />
  );
}
