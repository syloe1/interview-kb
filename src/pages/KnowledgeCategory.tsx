import {
  Braces,
  Database,
  FileText,
  FolderGit2,
  Layers3,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NavIcon } from '../types';
import { knowledgeMarkdown } from '../data/knowledgeNotes';
import { getFileNameFromPath, getNoteSummary, getNoteTitle } from '../lib/markdown';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { EmptyState } from '../components/common/EmptyState';
// 分类联合类型
export type KnowledgeCategory =
  | 'go'
  | 'cpp'
  | 'database'
  | 'mq'
  | 'algorithms'
  | 'interview'
  | 'k8s'
  | 'linux'
  | 'thinking'
  | 'python'
  | 'qt';
// 组件Props
interface KnowledgeCategoryProps {
  category: KnowledgeCategory;
  title: string;
  description: string;
  icon: NavIcon;
}
// 笔记数据结构
interface KnowledgeNote {
  id: string;
  title: string;
  summary: string;
  markdown: string;
}

const iconMap: Record<NavIcon, LucideIcon> = {
  folder: FolderGit2,
  terminal: Terminal,
  braces: Braces,
  database: Database,
  layers: Layers3,
};
//获取笔记列表
function getNotes(category: KnowledgeCategory): KnowledgeNote[] {
  // 统一转小写比较，避免目录名大小写不一致（如 Python/）导致匹配不到
  const categoryPrefix = `../content/knowledge/${category}/`.toLowerCase();

  return Object.entries(knowledgeMarkdown)
    .filter(([path]) => path.toLowerCase().startsWith(categoryPrefix))
    .map(([path, markdown]) => {
      const fileName = getFileNameFromPath(path);
      return {
        id: fileName.toLowerCase(),
        title: getNoteTitle(markdown, fileName),
        summary: getNoteSummary(markdown),
        markdown,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}

export function KnowledgeCategoryPage({
  category,
  title,
  description,
  icon,
}: KnowledgeCategoryProps) {
  const Icon = iconMap[icon];
  const notes = getNotes(category);

  return (
    <div>
      <Breadcrumb items={[{ label: title }]} />
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-7 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <Icon size={17} aria-hidden="true" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">
              Knowledge section
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[var(--text-primary)]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{description}</p>
        </div>
        <span className="font-mono text-xs text-[var(--text-faint)]">
          {notes.length.toString().padStart(2, '0')} notes
        </span>
      </div>

      {notes.length === 0 ? (
        <div className="mt-7">
          <EmptyState
            title="No notes yet."
            description="Add a Markdown file to this category directory and it will appear here automatically."
          />
        </div>
      ) : (
        <div className="mt-7 space-y-3">
          {notes.map((note) => (
            <Link
              key={note.id}
              to={`/${category}/${note.id}`}
              className="group block border border-[var(--border)] bg-[var(--card-bg)] p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--border-active)] hover:shadow-[0_8px_24px_rgba(30,52,80,0.08)] sm:p-6"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent-light)] text-[var(--accent)]">
                  <FileText size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                    {note.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                    {note.summary}
                  </p>
                  <span className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                    Open note
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
