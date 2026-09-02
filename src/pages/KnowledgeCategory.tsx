import { Braces, Database, FileText, FolderGit2, Layers3, Terminal, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { NavIcon } from '../types'
import { Breadcrumb } from '../components/common/Breadcrumb'
import { EmptyState } from '../components/common/EmptyState'

export type KnowledgeCategory = 'mq' | 'algorithms' | 'interview' | 'k8s' | 'linux'

interface KnowledgeCategoryProps {
  category: KnowledgeCategory
  title: string
  description: string
  icon: NavIcon
}

interface KnowledgeNote {
  id: string
  title: string
  summary: string
  markdown: string
}

const markdownModules = import.meta.glob<string>('../content/knowledge/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const iconMap: Record<NavIcon, LucideIcon> = {
  folder: FolderGit2,
  terminal: Terminal,
  braces: Braces,
  database: Database,
  layers: Layers3,
}

function getFileName(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
}

function getNoteTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading || fallback
}

function getNoteSummary(markdown: string): string {
  const summary = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('```') && !line.startsWith('<!--'))

  return summary || '这篇笔记暂时还没有摘要。'
}

function getNotes(category: KnowledgeCategory): KnowledgeNote[] {
  const categoryPrefix = `../content/knowledge/${category}/`

  return Object.entries(markdownModules)
    .filter(([path]) => path.startsWith(categoryPrefix))
    .map(([path, markdown]) => {
      const fileName = getFileName(path)
      return {
        id: fileName.toLowerCase(),
        title: getNoteTitle(markdown, fileName),
        summary: getNoteSummary(markdown),
        markdown,
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

export function KnowledgeCategoryPage({ category, title, description, icon }: KnowledgeCategoryProps) {
  const Icon = iconMap[icon]
  const notes = getNotes(category)

  return (
    <div>
      <Breadcrumb items={[{ label: title }]} />
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-7 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-[#2e5d94]">
            <Icon size={17} aria-hidden="true" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">Knowledge section</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-slate-950">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        <span className="font-mono text-xs text-slate-400">{notes.length.toString().padStart(2, '0')} notes</span>
      </div>

      {notes.length === 0 ? (
        <div className="mt-7">
          <EmptyState title="No notes yet." description="Add a Markdown file to this category directory and it will appear here automatically." />
        </div>
      ) : (
        <div className="mt-7 space-y-3">
          {notes.map((note) => (
            <Link
              key={note.id}
              to={`/${category}/${note.id}`}
              className="group block border border-slate-200 bg-white p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(30,52,80,0.08)] sm:p-6"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#edf3f9] text-[#2e5d94]">
                  <FileText size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900 group-hover:text-[#2e5d94]">{note.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{note.summary}</p>
                  <span className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">Open note</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
