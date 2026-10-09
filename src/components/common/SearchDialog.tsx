import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, FileText, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  ensureProjectDocs,
  getKnowledgeDocs,
  MAX_SEARCH_RESULTS,
  searchDocs,
  type SearchDoc,
  type SearchHit,
} from '../../data/searchIndex';
import { createHighlightPattern } from '../../lib/highlight';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

const EXAMPLE_QUERIES = ['零拷贝', 'sendfile', 'mmap', 'epoll'];

// 搜索框里也把命中词标出来，结果列表扫一眼就知道命中了哪几个词
function renderHighlighted(text: string, pattern: RegExp | null) {
  if (!pattern) return text;

  return text.split(pattern).map((piece, index) =>
    // 带捕获组的 split：奇数位是命中的片段
    index % 2 === 1 ? (
      <mark key={index} className="search-hit">
        {piece}
      </mark>
    ) : (
      piece
    )
  );
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // null 表示项目索引还在加载，此时只显示知识笔记的结果
  const [projectDocs, setProjectDocs] = useState<SearchDoc[] | null>(null);

  // 打开时才拉项目正文（约 685KB），不拖累首屏
  useEffect(() => {
    if (!open || projectDocs) return;
    let isCurrent = true;
    ensureProjectDocs().then((docs) => {
      if (isCurrent) setProjectDocs(docs);
    });
    return () => {
      isCurrent = false;
    };
  }, [open, projectDocs]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // 弹窗打开时锁住背后页面的滚动
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // 弹窗关着的时候什么都不算：建知识索引要解析 29 个 Markdown 文件，
  // 不该让没点过搜索的人也承担这份开销
  const docs = useMemo(
    () => (open ? [...getKnowledgeDocs(), ...(projectDocs ?? [])] : []),
    [open, projectDocs]
  );
  const hits = useMemo(() => searchDocs(docs, query), [docs, query]);
  const pattern = useMemo(() => createHighlightPattern(query), [query]);
  const isIndexing = projectDocs === null;

  // 关键词变了就把选中项拉回第一条
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 用键盘上下移动时，让选中项始终留在可视区域内
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, hits]);

  if (!open) return null;

  const openHit = (hit: SearchHit) => {
    const params = new URLSearchParams();
    // 小节锚点交给详情页滚动定位；原查询词用来在正文里标高亮
    if (hit.sectionId) params.set('section', hit.sectionId);
    if (query.trim()) params.set('q', query.trim());
    const search = params.toString();

    navigate({ pathname: hit.route, search: search ? `?${search}` : '' });
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (hits.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // 关键词刚变、setActiveIndex(0) 的 effect 还没跑时，activeIndex 可能越界
      openHit(hits[activeIndex] ?? hits[0]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索笔记"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden border border-[var(--border)] bg-[var(--card-bg)] shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
      >
        {/* 输入区 */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search
            size={17}
            className="shrink-0 text-[var(--text-faint)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题和正文，比如 零拷贝、sendfile"
            aria-label="搜索关键词"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭搜索"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-secondary)]"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* 没输入关键词时给几个例子，避免弹窗一片空白 */}
          {query.trim() === '' && (
            <div className="px-4 py-5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                搜索范围
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                知识笔记和项目笔记的正文，按小节拆分，可以直接跳到命中的那一段。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLE_QUERIES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setQuery(example)}
                    className="border border-[var(--border)] bg-[var(--hover-bg)] px-2.5 py-1 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--accent)]"
                  >
                    {example}
                  </button>
                ))}
              </div>
              {isIndexing && (
                <p className="mt-4 font-mono text-[11px] text-[var(--text-faint)]">
                  正在加载项目笔记索引…
                </p>
              )}
            </div>
          )}

          {query.trim() !== '' && hits.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                没有匹配的章节
              </p>
              <p className="mt-2 text-xs text-[var(--text-faint)]">
                换个关键词试试；多个词用空格分开表示「都要出现」。
              </p>
            </div>
          )}

          {hits.map((hit, index) => (
            <button
              key={hit.key}
              type="button"
              data-active={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => openHit(hit)}
              className={`block w-full border-b border-[var(--border-light)] px-4 py-3 text-left transition-colors ${
                index === activeIndex ? 'bg-[var(--hover-bg)]' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded bg-[var(--accent-light)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent-text)]">
                  {hit.categoryLabel}
                </span>
                <span className="min-w-0 truncate text-xs text-[var(--text-faint)]">
                  {hit.noteTitle}
                </span>
                {hit.sectionId && (
                  <>
                    <span className="shrink-0 text-[var(--text-faint)]">›</span>
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">
                      {renderHighlighted(hit.sectionLabel, pattern)}
                    </span>
                  </>
                )}
              </div>
              {hit.snippet && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
                  {renderHighlighted(hit.snippet, pattern)}
                </p>
              )}
            </button>
          ))}
        </div>

        {/* 底部：结果数和快捷键提示 */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
          <span className="flex items-center gap-1.5">
            <FileText size={12} aria-hidden="true" />
            {query.trim() === ''
              ? 'type to search'
              : `${hits.length}${hits.length >= MAX_SEARCH_RESULTS ? '+' : ''} section${
                  hits.length === 1 ? '' : 's'
                }`}
            {isIndexing && <span className="normal-case">· 项目笔记加载中</span>}
          </span>
          <span className="hidden items-center gap-3 sm:flex">
            <span>↑↓ 选择</span>
            <span className="flex items-center gap-1">
              <CornerDownLeft size={11} aria-hidden="true" /> 打开
            </span>
            <span>esc 关闭</span>
          </span>
        </div>
      </div>
    </div>
  );
}
