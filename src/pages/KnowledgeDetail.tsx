import { useEffect, useMemo } from 'react';
import { ArrowLeft, BookMarked, ListTree } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { categoryLabels, knowledgeMarkdown } from '../data/knowledgeNotes';
import { getNoteTitle, getTableOfContents } from '../lib/markdown';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { MarkdownRenderer } from '../components/common/MarkdownRenderer';
//Props
interface KnowledgeDetailProps {
  category: string;
}

//查找笔记
function getModule(
  category: string,
  noteId: string
): { path: string; markdown: string } | undefined {
  const normalizedCategory = category.toLowerCase();
  const normalizedNoteId = noteId.toLowerCase();

  const match = Object.entries(knowledgeMarkdown).find(([path]) => {
    const segments = path.split('/');
    const fileName = segments.at(-1)?.replace(/\.md$/i, '').toLowerCase();
    return (
      segments.at(-2)?.toLowerCase() === normalizedCategory &&
      fileName === normalizedNoteId
    );
  });

  return match ? { path: match[0], markdown: match[1] } : undefined;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function KnowledgeDetail({ category }: KnowledgeDetailProps) {
  const { noteId = '' } = useParams();
  // 从搜索结果跳过来时带两个参数：section 是要滚到的小节锚点，q 是要高亮的关键词
  const [searchParams] = useSearchParams();
  const sectionId = searchParams.get('section') ?? '';
  const highlightQuery = searchParams.get('q') ?? '';

  const source = getModule(category, noteId);
  const title = source ? getNoteTitle(source.markdown, noteId) : noteId;
  const categoryLabel = categoryLabels[category.toLowerCase()] ?? category;
  const tableOfContents = useMemo(
    () => (source ? getTableOfContents(source.markdown) : []),
    [source]
  );

  // 正文随渲染同步出现，effect 执行时锚点元素已经在 DOM 里，不需要等。
  // 依赖必须用 source.path 而不是 source 本身：getModule 每次渲染都新建对象，
  // 依赖 source 会让这个 effect 每次渲染都跑一遍，把用户手动滚走的位置又拽回去。
  useEffect(() => {
    if (!sectionId) return;
    scrollToSection(sectionId);
  }, [sectionId, source?.path]);

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
            <MarkdownRenderer markdown={source.markdown} highlight={highlightQuery} />
          </div>
        </article>

        <aside className="hidden lg:sticky lg:top-[92px] lg:block">
          <div className="border border-[var(--border)] bg-[var(--card-bg)] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <ListTree size={15} className="text-[var(--accent)]" aria-hidden="true" />{' '}
              On this page
            </div>
            <nav
              className="mt-4 max-h-[calc(100vh-160px)] overflow-y-auto border-l border-[var(--border)] pr-1"
              aria-label="Note sections"
            >
              {/* 这里必须是按钮不能是 <a href="#id">：HashRouter 的 URL 本身就靠 # 工作，
                  点 href="#foo" 会把路由冲掉变成 404。ProjectDetail 的目录也是同样写法。 */}
              {tableOfContents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className="block w-full border-l-2 border-transparent py-1.5 pl-3 text-left text-xs leading-5 text-[var(--text-faint)] outline-none transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:border-[var(--accent)] focus-visible:text-[var(--accent)]"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
