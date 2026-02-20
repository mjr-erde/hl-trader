import { theme } from "../../theme";

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  minWidth?: number;
}

export function Card({ children, style, minWidth }: CardProps) {
  return (
    <div
      style={{
        padding: theme.spacing.lg,
        background: theme.colors.bg.card,
        borderRadius: theme.radius.lg,
        border: `1px solid ${theme.colors.border}`,
        minWidth: minWidth ?? undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
