import { theme } from "../../theme";

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  minWidth?: number;
  style?: React.CSSProperties;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  minWidth = 100,
  style,
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: theme.spacing.sm,
        borderRadius: theme.radius.md,
        background: theme.colors.bg.cardAlt,
        color: theme.colors.text.primary,
        border: `1px solid ${theme.colors.border}`,
        minWidth,
        fontSize: "0.9rem",
        cursor: "pointer",
        ...style,
      }}
    >
      {placeholder && (
        <option value="">
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
