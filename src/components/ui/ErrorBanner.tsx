import { theme } from "../../theme";

interface ErrorBannerProps {
  message: string;
  detail?: string;
}

export function ErrorBanner({ message, detail }: ErrorBannerProps) {
  return (
    <div
      style={{
        padding: theme.spacing.lg,
        background: theme.colors.bg.error,
        borderRadius: theme.radius.lg,
        color: "#fecaca",
      }}
    >
      <strong>Error:</strong> {message}
      {detail && (
        <>
          <br />
          <span style={{ fontSize: "0.85rem" }}>{detail}</span>
        </>
      )}
    </div>
  );
}
