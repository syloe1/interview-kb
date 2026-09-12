import { ArrowRight, BookOpen, CheckCircle2, Clock3, LibraryBig } from 'lucide-react';
import { Link } from 'react-router-dom';
import { navigationItems } from '../data/navigation';
import { BookmarkLinks } from '../components/common/BookmarkLinks';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

const iconByLabel = {
  Projects: LibraryBig,
  Go: Clock3,
  'C++': Clock3,
  Database: Clock3,
  八股: Clock3,
  MQ: Clock3,
  算法题: Clock3,
  面试: Clock3,
  K8s: Clock3,
  Linux: Clock3,
  思考: Clock3,
};

export function Home() {
  return (
    <div>
      <section className="border-b border-[var(--border)] pb-9">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
          <BookOpen size={14} aria-hidden="true" />
          Personal workspace
        </div>

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
              Interview-KB
            </h1>
            <p className="mt-3 text-base font-medium text-[var(--text-secondary)]">
              Personal Interview Knowledge Base
            </p>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[var(--text-muted)]">
              这是一个用于记录和复习个人项目、技术知识和面试问题的知识库。把值得再次想起的内容，整理成可以快速检索的笔记。
            </p>
            <blockquote className="mt-6 border-l-2 border-[var(--accent)] pl-4 text-[15px] font-medium leading-7 text-[var(--text-secondary)]">
              软件工程正在从写代码，转向定义问题、组织上下文、验证结果。
            </blockquote>
          </div>

          <div className="border-l-2 border-[var(--border-active)] pl-4 text-sm text-[var(--text-muted)] lg:mb-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
              Current focus
            </p>
            <p className="mt-2 font-medium text-[var(--text-secondary)]">
              Building a stronger
              <br />
              systems foundation.
            </p>
          </div>
        </div>
      </section>

      <section className="pt-8">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
              Browse by topic
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Knowledge map</h2>
          </div>
          <span className="hidden text-xs text-[var(--text-faint)] sm:block">
            {navigationItems.length} sections · 1 active
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {navigationItems.map((item, index) => {
            const Icon = iconByLabel[item.label as keyof typeof iconByLabel];
            const isActive = index === 0;
            const isComingSoon = item.countLabel.toLowerCase().includes('coming');

            return (
              <Link
                key={item.path}
                to={item.path}
                className="group block transition-transform duration-200 hover:-translate-y-0.5"
              >
                <Card
                  className={`flex min-h-[170px] flex-col border p-5 transition-[border-color,box-shadow] duration-200 group-hover:shadow-[0_8px_24px_rgba(30,52,80,0.07)] ${
                    isActive
                      ? 'border-[var(--border-active)] bg-[var(--card-bg-active)]'
                      : 'border-[var(--border)] bg-[var(--card-bg)] group-hover:border-[var(--border-active)]'
                  }`}
                >
                  <CardHeader className="flex flex-row items-start justify-between p-0">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-md ${
                        isActive
                          ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                          : 'bg-[var(--hover-bg)] text-[var(--text-faint)]'
                      }`}
                    >
                      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <ArrowRight
                      size={16}
                      className="text-[var(--border)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
                      aria-hidden="true"
                    />
                  </CardHeader>

                  <CardContent className="mt-7 flex-1 p-0">
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">
                      {item.label}
                    </h3>
                    <p className="mt-1.5 text-sm leading-5 text-[var(--text-muted)]">
                      {item.description}
                    </p>
                  </CardContent>

                  <div className="mt-auto pt-4">
                    <Badge
                      variant={isComingSoon ? 'secondary' : 'success'}
                      className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
                    >
                      {isActive && !isComingSoon && (
                        <CheckCircle2 size={12} className="mr-1" aria-hidden="true" />
                      )}
                      {item.countLabel}
                    </Badge>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <BookmarkLinks />
    </div>
  );
}
