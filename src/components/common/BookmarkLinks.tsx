import { ExternalLink } from 'lucide-react';
import { bookmarkCategories } from '../../data/bookmarks';

export function BookmarkLinks() {
  return (
    <section className="mt-12 border-t border-[var(--border)] pt-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
            Useful links
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">常用网站</h2>
        </div>
        <span className="hidden text-xs text-[var(--text-faint)] sm:block">
          点击在新标签页打开
        </span>
      </div>

      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {bookmarkCategories.map((category) => (
          <div key={category.title}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {category.title}
            </h3>
            <ul className="space-y-2.5">
              {category.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                  >
                    {link.label}
                    <ExternalLink
                      size={11}
                      className="opacity-0 transition-opacity group-hover:opacity-60"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
