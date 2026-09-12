interface ProjectSectionProps {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}
export function ProjectSection({ eyebrow, title, children }: ProjectSectionProps) {
  return (
    <section className="border-t border-[var(--border)] pt-6">
      <div className="mb-4 flex items-baseline gap-3">
        {eyebrow && (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            {eyebrow}
          </span>
        )}
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}
