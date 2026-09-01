import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import GithubSlugger from 'github-slugger'
import hljs from 'highlight.js/lib/core'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import { toString } from 'mdast-util-to-string'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import {
  ArrowUpRight,
  ArrowLeft,
  BookMarked,
  Check,
  CircleDot,
  Clipboard,
  ListTree,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Breadcrumb } from '../components/common/Breadcrumb'
import { ProjectSection } from '../components/project/ProjectSection'
import { projects } from '../data/projects'

hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('go', go)
hljs.registerAliases(['c++', 'cc', 'hpp'], { languageName: 'cpp' })
hljs.registerAliases('golang', { languageName: 'go' })

interface MarkdownSource {
  fileName: string
  load: () => Promise<string>
}

const markdownModules = import.meta.glob<string>('../content/projects/*.md', {
  query: '?raw',
  import: 'default',
})

const markdownSources = Object.fromEntries(
  Object.entries(markdownModules).map(([path, load]) => {
    const fileName = path.split('/').pop() ?? ''
    const projectId = fileName.replace(/\.md$/i, '').toLowerCase()
    return [projectId, { fileName, load }]
  }),
) as Record<string, MarkdownSource>

interface TableOfContentsItem {
  id: string
  label: string
}

function getTextContent(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children)
  }

  if (Array.isArray(children)) {
    return children.map(getTextContent).join('')
  }

  if (children && typeof children === 'object' && 'props' in children) {
    return getTextContent((children.props as { children?: ReactNode }).children)
  }

  return ''
}

function getTableOfContents(markdown: string): TableOfContentsItem[] {
  const tree = unified().use(remarkParse).parse(markdown)
  const slugger = new GithubSlugger()
  const items: TableOfContentsItem[] = []

  visit(tree, 'heading', (node) => {
    if (node.depth !== 2) return

    const label = toString(node)
    items.push({
      id: slugger.slug(label),
      label,
    })
  })

  return items
}

interface CodeBlockProps {
  className?: string
  children?: ReactNode
}

function CodeBlock({ className, children }: CodeBlockProps) {
  const [isCopied, setCopied] = useState(false)
  const language = className?.match(/language-([^\s]+)/)?.[1]?.toLowerCase()
  const code = getTextContent(children).replace(/\n$/, '')

  if (!language) {
    return <code className={className}>{children}</code>
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const isLanguageSupported = Boolean(hljs.getLanguage(language))
  const highlightedCode = isLanguageSupported ? hljs.highlight(code, { language }).value : ''

  return (
    <code className={`hljs ${className ?? ''}`} data-language={language}>
      <button
        type="button"
        className="code-copy-button"
        aria-label="Copy code"
        title="Copy code"
        onClick={copyCode}
      >
        {isCopied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
      </button>
      {isLanguageSupported
        ? <span dangerouslySetInnerHTML={{ __html: highlightedCode }} />
        : children}
    </code>
  )
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1>{children}</h1>,
  code: CodeBlock,
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function ProjectDetail() {
  const { projectId = '' } = useParams()
  const normalizedProjectId = projectId.toLowerCase()
  const project = projects.find((item) => item.id.toLowerCase() === normalizedProjectId)
  const markdownSource = markdownSources[normalizedProjectId]
  const [markdown, setMarkdown] = useState('')
  const [isLoading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const tableOfContents = useMemo(() => markdown ? getTableOfContents(markdown) : [], [markdown])

  useEffect(() => {
    let isCurrent = true
    setMarkdown('')
    setLoadError('')

    if (!project || !markdownSource) {
      setLoading(false)
      return () => { isCurrent = false }
    }

    setLoading(true)
    markdownSource.load()
      .then((content) => {
        if (isCurrent) setMarkdown(content)
      })
      .catch(() => {
        if (isCurrent) setLoadError(`Unable to load ${markdownSource.fileName}.`)
      })
      .finally(() => {
        if (isCurrent) setLoading(false)
      })

    return () => { isCurrent = false }
  }, [project, markdownSource])

  if (!project) {
    return <ProjectNotFound message={`No project is registered for “${projectId}”.`} />
  }

  if (!markdownSource) {
    return <ProjectNotFound message={`No Markdown file matches the project id “${project.id}”.`} />
  }

  return (
    <div>
      <Breadcrumb items={[{ label: 'Projects', path: '/projects' }, { label: project.name }]} />

      <div className="border-b border-slate-200 pb-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <CircleDot size={13} fill="currentColor" aria-hidden="true" /> Active project
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">{project.name}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{project.description}</p>
          </div>
          <a href="https://github.com/" target="_blank" rel="noreferrer" className="inline-flex h-9 shrink-0 items-center gap-2 border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900">
            View repository <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {project.tags.map((tag) => <span key={tag} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-medium text-slate-500">{tag}</span>)}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <article className="min-w-0 border border-slate-200 bg-white px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-7 flex items-center gap-2 border-b border-slate-100 pb-5 text-xs text-slate-400">
            <BookMarked size={15} aria-hidden="true" />
            <span>Notes loaded from <code className="font-mono text-[11px] text-slate-500">src/content/projects/{markdownSource.fileName}</code></span>
          </div>
          <div className="markdown-content">
            {isLoading && <p className="py-12 text-center text-sm text-slate-400">Loading project notes...</p>}
            {loadError && <p className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</p>}
            {!isLoading && !loadError && <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>{markdown}</ReactMarkdown>}
          </div>
        </article>

        <aside className="hidden lg:sticky lg:top-[92px] lg:block">
          <div className="border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ListTree size={15} className="text-[#2e5d94]" aria-hidden="true" /> On this page
            </div>
            <nav className="mt-4 max-h-[calc(100vh-160px)] overflow-y-auto border-l border-slate-200 pr-1" aria-label="Project sections">
              {tableOfContents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className="block w-full border-l-2 border-transparent py-1.5 pl-3 text-left text-xs leading-5 text-slate-400 outline-none transition-colors hover:border-[#2e5d94] hover:text-[#2e5d94] focus-visible:border-[#2e5d94] focus-visible:text-[#2e5d94]"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>
      </div>

      <ProjectSection eyebrow="Structure" title="A note on extensibility">
        <p className="text-sm leading-6 text-slate-500">The page reads project content and its table of contents directly from Markdown. Add a level-two heading to the file and it will appear in the page navigation automatically.</p>
      </ProjectSection>
    </div>
  )
}

function ProjectNotFound({ message }: { message: string }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Project not found</p>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">The project page is unavailable.</h1>
      <p className="mt-3 text-sm text-slate-500">{message}</p>
      <Link to="/projects" className="mt-6 inline-flex items-center gap-2 border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <ArrowLeft size={15} aria-hidden="true" /> Back to projects
      </Link>
    </div>
  )
}
