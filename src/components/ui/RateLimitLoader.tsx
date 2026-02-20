import { useEffect, useState } from "react";
import { theme } from "../../theme";

interface RateLimitLoaderProps {
  /** Seconds until retry */
  retryIn?: number;
  onRetry: () => void;
}

export function RateLimitLoader({ retryIn = 12, onRetry }: RateLimitLoaderProps) {
  const [secondsLeft, setSecondsLeft] = useState(retryIn);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onRetry();
      return;
    }
    const t = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft, onRetry]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.lg,
        padding: theme.spacing.xl,
        color: theme.colors.text.secondary,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: `3px solid ${theme.colors.border}`,
          borderTopColor: theme.colors.text.link,
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        Rate limited — retrying in {secondsLeft}s…
      </p>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
