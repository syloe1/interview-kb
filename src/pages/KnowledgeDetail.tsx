import { useMemo } from 'react';
import { ArrowLeft, BookMarked, ListTree } from 'lucide-react';
import GithubSlugger from 'github-slugger';
import { Link, useParams } from 'react-router-dom';
import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import remarkParse from 'remark-parse';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { MarkdownRenderer } from '../components/common/MarkdownRenderer';
//Props
interface KnowledgeDetailProps {
  category: string;
}
//目录项
interface TableOfContentsItem {
  id: string;
  label: string;
}

const markdownModules = import.meta.glob<string>('../content/knowledge/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
// Record<K, V> Ts的工具泛型， 
const categoryLabels: Record<string, string> = {
  go: 'Go',
  cpp: 'C++',
  database: 'Database',
  mq: 'MQ',
  algorithms: '算法题',
  interview: '面试',
  k8s: 'K8s',
  linux: 'Linux',
  thinking: '思考',
};
//生成目录
function getTableOfContents(markdown: string): TableOfContentsItem[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const slugger = new GithubSlugger();
  const items: TableOfContentsItem[] = [];

  visit(tree, 'heading', (node) => {
    if (node.depth !== 2) return;
    const label = toString(node);
    items.push({ id: slugger.slug(label), label });
  });

  return items;
}
//查找笔记
function getModule(
  category: string,
  noteId: string
): { path: string; markdown: string } | undefined {
  const normalizedCategory = category.toLowerCase();
  const normalizedNoteId = noteId.toLowerCase();

  const match = Object.entries(markdownModules).find(([path]) => {
    const segments = path.split('/');
    const fileName = segments.at(-1)?.replace(/\.md$/i, '').toLowerCase();
    return (
      segments.at(-2)?.toLowerCase() === normalizedCategory &&
      fileName === normalizedNoteId
    );
  });

  return match ? { path: match[0], markdown: match[1] } : undefined;
}

function getTitle(markdown: string, fallback: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

export function KnowledgeDetail({ category }: KnowledgeDetailProps) {
  const { noteId = '' } = useParams();
  const source = getModule(category, noteId);
  const title = source ? getTitle(source.markdown, noteId) : noteId;
  const categoryLabel = categoryLabels[category.toLowerCase()] ?? category;
  const tableOfContents = useMemo(
    () => (source ? getTableOfContents(source.markdown) : []),
    [source]
  );

  if (!source) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
          Note not found
        </p>
        <h1 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">
          The note page is unavailable.
        </h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          No Markdown file matches “{noteId}”.
        </p>
        <Link
          to={`/${category}`}
          className="mt-6 inline-flex items-center gap-2 border border-[var(--border)] bg-[var(--card-bg)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to {categoryLabel}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb
        items={[{ label: categoryLabel, path: `/${category}` }, { label: title }]}
      />
      <div className="border-b border-[var(--border)] pb-7">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
          Knowledge note
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
          {title}
        </h1>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <article className="min-w-0 border border-[var(--border)] bg-[var(--card-bg)] px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-7 flex items-center gap-2 border-b border-[var(--border-light)] pb-5 text-xs text-[var(--text-faint)]">
            <BookMarked size={15} aria-hidden="true" />
            <span>
              Notes loaded from{' '}
              <code className="font-mono text-[11px] text-[var(--text-muted)]">
                {source.path.replace('../', 'src/')}
              </code>
            </span>
          </div>
          <div className="markdown-content">
            <MarkdownRenderer markdown={source.markdown} />
          </div>
        </article>

        <aside className="hidden lg:sticky lg:top-[92px] lg:block">
          <div className="border border-[var(--border)] bg-[var(--card-bg)] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <ListTree size={15} className="text-[var(--accent)]" aria-hidden="true" /> On this
              page
            </div>
            <nav
              className="mt-4 max-h-[calc(100vh-160px)] overflow-y-auto border-l border-[var(--border)] pr-1"
              aria-label="Note sections"
            >
              {tableOfContents.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="block border-l-2 border-transparent py-1.5 pl-3 text-xs leading-5 text-[var(--text-faint)] outline-none transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
