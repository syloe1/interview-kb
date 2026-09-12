import { ArrowUpRight, Boxes, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Project } from '../../types';

interface ProjectCardProps {
  project: Project;
}
export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      to={project.path}
      className="group block border border-[var(--border)] bg-[var(--card-bg)] p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--border-active)] hover:shadow-[0_8px_24px_rgba(30,52,80,0.08)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent-light)] text-[var(--accent)]">
            <Boxes size={19} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{project.name}</h2>
            <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              {project.category}
            </p>
          </div>
        </div>
        <ArrowUpRight
          size={18}
          className="text-[var(--border)] transition-colors group-hover:text-[var(--accent)]"
          aria-hidden="true"
        />
      </div>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
        {project.description}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {project.tags.map((tag) => (
          <span
            key={tag}
            className="rounded border border-[var(--border)] bg-[var(--hover-bg)] px-2 py-1 font-mono text-[10px] font-medium text-[var(--text-muted)]"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between border-t border-[var(--border-light)] pt-4 text-xs text-[var(--text-faint)]">
        <span>{project.updatedAt}</span>
        <span className="flex items-center gap-1 font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
          Open notes <ChevronRight size={14} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
