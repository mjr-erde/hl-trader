import { theme } from "../../theme";

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <section>
      <h2 style={theme.typography.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}
