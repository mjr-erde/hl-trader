import { theme } from "../../theme";

const thStyle: React.CSSProperties = {
  padding: theme.spacing.md,
  textAlign: "left",
  fontWeight: 600,
  color: theme.colors.text.secondary,
};

const tdStyle: React.CSSProperties = {
  padding: theme.spacing.md,
  color: theme.colors.text.primary,
};

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  style?: React.CSSProperties;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  selectedKey?: string | null;
  onSelect?: (row: T) => void;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  selectedKey,
  onSelect,
  emptyMessage = "No data.",
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <p style={{ color: theme.colors.text.secondary }}>{emptyMessage}</p>
    );
  }

  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        background: theme.colors.bg.cardAlt,
        borderRadius: theme.radius.lg,
        overflow: "hidden",
      }}
    >
      <thead>
        <tr style={{ background: theme.colors.bg.card }}>
          {columns.map((col) => (
            <th key={col.key} style={thStyle}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const key = getRowKey(row);
          const isSelected = selectedKey != null && key === selectedKey;
          return (
            <tr
              key={key}
              style={{
                borderTop: `1px solid ${theme.colors.border}`,
                background: isSelected ? theme.colors.bg.rowHover : undefined,
                cursor: onSelect ? "pointer" : undefined,
              }}
              onClick={onSelect ? () => onSelect(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ ...tdStyle, ...col.style }}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
