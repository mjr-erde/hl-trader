import { theme } from "../../theme";
import { Card } from "./Card";

interface PnLCardProps {
  label: string;
  value: number;
  suffix?: string;
}

export function PnLCard({ label, value, suffix = "USDC" }: PnLCardProps) {
  const color = value >= 0 ? theme.colors.pnl.positive : theme.colors.pnl.negative;
  return (
    <Card minWidth={140}>
      <div style={theme.typography.label}>{label}</div>
      <div style={{ ...theme.typography.pnlValue, color }}>
        {value >= 0 ? "+" : ""}
        {value.toFixed(2)} {suffix}
      </div>
    </Card>
  );
}
