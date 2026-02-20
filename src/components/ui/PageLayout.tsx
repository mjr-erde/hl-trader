import { theme } from "../../theme";

interface PageLayoutProps {
  children: React.ReactNode;
}

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.xl,
        width: "100%",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
