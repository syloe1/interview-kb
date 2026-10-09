import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ArrowLeft, BookMarked, CircleDot, ListTree } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { MarkdownRenderer } from '../components/common/MarkdownRenderer';
import { ProjectSection } from '../components/project/ProjectSection';
import { projectMarkdownSources } from '../data/projectNotes';
import { projects } from '../data/projects';
import { getTableOfContents } from '../lib/markdown';

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 渲染项目详情页
export function ProjectDetail() {
  const { projectId = '' } = useParams();
  // 从搜索结果跳过来时带两个参数：section 是要滚到的小节锚点，q 是要高亮的关键词
  const [searchParams] = useSearchParams();
  const sectionId = searchParams.get('section') ?? '';
  const highlightQuery = searchParams.get('q') ?? '';

  const normalizedProjectId = projectId.toLowerCase();
  const project = projects.find((item) => item.id.toLowerCase() === normalizedProjectId);
  const markdownKey = project?.fileName
    ? project.fileName.replace(/\.md$/i, '').toLowerCase()
    : normalizedProjectId;
  const markdownSource = project ? projectMarkdownSources[markdownKey] : undefined;
  const [markdown, setMarkdown] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const tableOfContents = useMemo(
    () => (markdown ? getTableOfContents(markdown) : []),
    [markdown]
  );

  // 加载 Markdown 内容
  useEffect(() => {
    let isCurrent = true;
    setMarkdown('');
    setLoadError('');

    if (!project || !markdownSource) {
      setLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setLoading(true);
    markdownSource
      .load()
      .then((content) => {
        if (isCurrent) setMarkdown(content);
      })
      .catch(() => {
        if (isCurrent) setLoadError(`Unable to load ${markdownSource.fileName}.`);
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [project, markdownSource]);

  // 项目正文是异步加载的，必须等 markdown 到位、锚点元素渲染出来之后再滚
  useEffect(() => {
    if (!sectionId || !markdown) return;
    scrollToSection(sectionId);
  }, [sectionId, markdown]);

  if (!project) {
    return <ProjectNotFound message={`No project is registered for “${projectId}”.`} />;
  }

  if (!markdownSource) {
    return (
      <ProjectNotFound
        message={`No Markdown file matches the project id “${project.id}”.`}
      />
    );
  }

  return (
    <div>
      <Breadcrumb
        items={[{ label: 'Projects', path: '/projects' }, { label: project.name }]}
      />

      <div className="border-b border-[var(--border)] pb-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-500">
              <CircleDot size={13} fill="currentColor" aria-hidden="true" /> Active
              project
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
              {project.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
              {project.description}
            </p>
          </div>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-2 border border-[var(--border)] bg-[var(--card-bg)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
          >
            View repository <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-[var(--border)] bg-[var(--hover-bg)] px-2 py-1 font-mono text-[10px] font-medium text-[var(--text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <article className="min-w-0 border border-[var(--border)] bg-[var(--card-bg)] px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-7 flex items-center gap-2 border-b border-[var(--border-light)] pb-5 text-xs text-[var(--text-faint)]">
            <BookMarked size={15} aria-hidden="true" />
            <span>
              Notes loaded from{' '}
              <code className="font-mono text-[11px] text-[var(--text-muted)]">
                src/content/projects/{markdownSource.fileName}
              </code>
            </span>
          </div>
          <div className="markdown-content">
            {isLoading && (
              <p className="py-12 text-center text-sm text-[var(--text-faint)]">
                Loading project notes...
              </p>
            )}
            {loadError && (
              <p className="border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                {loadError}
              </p>
            )}
            {!isLoading && !loadError && (
              <MarkdownRenderer markdown={markdown} highlight={highlightQuery} />
            )}
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
              aria-label="Project sections"
            >
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

      <ProjectSection eyebrow="Structure" title="A note on extensibility">
        <p className="text-sm leading-6 text-slate-500">
          The page reads project content and its table of contents directly from Markdown.
          Add a level-two heading to the file and it will appear in the page navigation
          automatically.
        </p>
      </ProjectSection>
    </div>
  );
}

function ProjectNotFound({ message }: { message: string }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
        Project not found
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">
        The project page is unavailable.
      </h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">{message}</p>
      <Link
        to="/projects"
        className="mt-6 inline-flex items-center gap-2 border border-[var(--border)] bg-[var(--card-bg)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Back to projects
      </Link>
    </div>
  );
}
