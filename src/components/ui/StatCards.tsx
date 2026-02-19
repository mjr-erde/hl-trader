import { theme } from "../../theme";
import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  minWidth?: number;
}

export function StatCard({ label, value, minWidth = 140 }: StatCardProps) {
  return (
    <Card minWidth={minWidth}>
      <div style={theme.typography.label}>{label}</div>
      <div style={theme.typography.value}>{value}</div>
    </Card>
  );
}

interface StatCardsProps {
  children: React.ReactNode;
}

export function StatCards({ children }: StatCardsProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: theme.spacing.lg,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}
    >
      {children}
    </div>
  );
}
