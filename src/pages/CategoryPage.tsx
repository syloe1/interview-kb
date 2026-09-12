import type { NavIcon } from '../types';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { EmptyState } from '../components/common/EmptyState';

interface CategoryPageProps {
  title: string;
  description: string;
  icon: NavIcon;
}
export function CategoryPage({ title, description }: CategoryPageProps) {
  return (
    <div>
      <Breadcrumb items={[{ label: title }]} />
      <div className="border-b border-[var(--border)] pb-7">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
          Knowledge section
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[var(--text-primary)]">
          {title}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{description}</p>
      </div>
      <div className="mt-7">
        <EmptyState
          title="No notes yet."
          description="This section is currently under construction. New notes will appear here as they are added."
        />
      </div>
    </div>
  );
}
