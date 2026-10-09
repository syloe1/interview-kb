// 搜索索引：把知识笔记和项目笔记按二级标题切成「章节」再建索引。
//
// 为什么按章节而不是按整篇：这个站的痛点不是「找不到哪一篇」，
// 而是「知道看过 sendfile，但不知道在哪篇超长笔记的哪一段」。
// 一篇 cc.md 有 56KB、面试题.md 有 151KB，只给到笔记级结果等于让人再 Ctrl+F 一次。
import { categoryLabels, knowledgeMarkdown } from './knowledgeNotes';
import { loadAllProjectMarkdown } from './projectNotes';
import { projects } from './projects';
import {
  getFileNameFromPath,
  getNoteTitle,
  splitIntoSections,
  type MarkdownSection,
} from '../lib/markdown';

export interface SearchHit {
  /** 列表 key，形如 'go/go#零拷贝' */
  key: string;
  /** 展示用：「Go」/「面试」/「项目」 */
  categoryLabel: string;
  noteTitle: string;
  sectionLabel: string;
  /** 详情页路由，不带 ?section= */
  route: string;
  /** 小节锚点；空字符串表示跳到笔记开头 */
  sectionId: string;
  /** 命中位置附近的一段正文 */
  snippet: string;
  score: number;
}

export interface SearchDoc {
  categoryLabel: string;
  noteTitle: string;
  route: string;
  sectionLabel: string;
  sectionId: string;
  text: string;
}

interface ScoredDoc {
  doc: SearchDoc;
  key: string;
  score: number;
  snippet: string;
}

/** 单次搜索最多返回多少条。超过之后只保留得分最高的，界面上会显示成 "20+" */
export const MAX_SEARCH_RESULTS = 20;

// 命中标题比命中正文更有价值：搜「零拷贝」时，标题就叫「零拷贝」的小节应该排最前
const SCORE_SECTION_LABEL = 10;
const SCORE_NOTE_TITLE = 4;
const SCORE_BODY_OCCURRENCE = 1;
const MAX_BODY_SCORE = 5;

const SNIPPET_RADIUS = 60;

function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

// 截命中位置前后各一段，让结果行能直接看出上下文
function buildSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();

  let matchIndex = -1;
  let matchLength = 0;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = term.length;
    }
  }

  if (matchIndex === -1) {
    // 只命中了标题，正文没命中，就退回正文开头
    return text.length > SNIPPET_RADIUS * 2
      ? `${text.slice(0, SNIPPET_RADIUS * 2)}…`
      : text;
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${
    end < text.length ? '…' : ''
  }`;
}

function scoreDoc(doc: SearchDoc, terms: string[]): ScoredDoc | null {
  const sectionLabel = doc.sectionLabel.toLowerCase();
  const noteTitle = doc.noteTitle.toLowerCase();
  const body = doc.text.toLowerCase();

  let score = 0;

  for (const term of terms) {
    const inSection = sectionLabel.includes(term);
    const inTitle = noteTitle.includes(term);
    const bodyCount = countOccurrences(body, term);

    // 多个关键词是「与」的关系：有一个词整节都找不到，这条就不算命中
    if (!inSection && !inTitle && bodyCount === 0) return null;

    if (inSection) score += SCORE_SECTION_LABEL;
    if (inTitle) score += SCORE_NOTE_TITLE;
    score += Math.min(bodyCount, MAX_BODY_SCORE) * SCORE_BODY_OCCURRENCE;
  }

  return {
    doc,
    key: `${doc.route}#${doc.sectionId}`,
    score,
    snippet: buildSnippet(doc.text, terms),
  };
}

/** 在给定索引里搜索，返回按相关度排序的命中列表 */
export function searchDocs(docs: SearchDoc[], query: string): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const scored: ScoredDoc[] = [];
  for (const doc of docs) {
    const result = scoreDoc(doc, terms);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 分数相同时按「笔记 -> 小节在文中的先后」排，保证结果稳定
    return a.key.localeCompare(b.key, 'zh-CN');
  });

  return scored.slice(0, MAX_SEARCH_RESULTS).map(({ doc, key, score, snippet }) => ({
    key,
    categoryLabel: doc.categoryLabel,
    noteTitle: doc.noteTitle,
    sectionLabel: doc.sectionLabel,
    route: doc.route,
    sectionId: doc.sectionId,
    snippet,
    score,
  }));
}

// 知识笔记是 eager 打包的，构建时就已在内存里，可以同步建索引
function buildKnowledgeDocs(): SearchDoc[] {
  const docs: SearchDoc[] = [];

  for (const [path, markdown] of Object.entries(knowledgeMarkdown)) {
    const segments = path.split('/');
    const category = (segments.at(-2) ?? '').toLowerCase();
    // glob 是 **/*.md，理论上能匹配到直接放在 knowledge/ 根目录的文件。
    // 那种文件没有分类，也就没有路由，跳过。
    if (!category || category === 'knowledge') continue;

    const fileName = getFileNameFromPath(path);
    const noteTitle = getNoteTitle(markdown, fileName);
    const route = `/${category}/${fileName.toLowerCase()}`;
    const categoryLabel = categoryLabels[category] ?? category;

    for (const section of splitIntoSections(markdown, noteTitle)) {
      docs.push({
        categoryLabel,
        noteTitle,
        route,
        sectionLabel: section.label,
        sectionId: section.id,
        text: section.text,
      });
    }
  }

  return docs;
}

let knowledgeDocs: SearchDoc[] | null = null;

/**
 * 知识笔记索引，同步可用。
 * 首次调用才真正解析 Markdown（29 个文件、975 个章节），
 * 避免从不搜索的访客也在启动时付这份解析开销。
 */
export function getKnowledgeDocs(): SearchDoc[] {
  knowledgeDocs ??= buildKnowledgeDocs();
  return knowledgeDocs;
}

// markdown 文件名（小写、无扩展名）-> 项目元数据。
// projects.ts 里大多数项目 id 就等于文件名，少数中文文件名靠 fileName 字段对上。
function buildProjectByMarkdownKey() {
  const map = new Map<string, (typeof projects)[number]>();

  for (const project of projects) {
    const key = (project.fileName ?? `${project.id}.md`)
      .replace(/\.md$/i, '')
      .toLowerCase();
    map.set(key, project);
  }

  return map;
}

async function buildProjectDocs(): Promise<SearchDoc[]> {
  const markdowns = await loadAllProjectMarkdown();
  const projectByKey = buildProjectByMarkdownKey();
  const docs: SearchDoc[] = [];

  for (const [key, markdown] of Object.entries(markdowns)) {
    const project = projectByKey.get(key);
    // 有 Markdown 但没在 projects.ts 注册的文件没有路由，搜出来也点不进去
    if (!project) continue;

    const noteTitle = getNoteTitle(markdown, project.name);
    // 项目名、简介、标签、分类也算正文，搜「网关」能命中 API gateway 类项目
    const header = [
      project.name,
      project.category,
      project.description,
      ...project.tags,
    ].join(' ');

    const sections: MarkdownSection[] = splitIntoSections(markdown, noteTitle);
    sections.forEach((section, index) => {
      docs.push({
        categoryLabel: '项目',
        noteTitle,
        route: project.path,
        sectionLabel: section.label,
        sectionId: section.id,
        text: index === 0 ? `${header} ${section.text}` : section.text,
      });
    });
  }

  return docs;
}

let projectDocsPromise: Promise<SearchDoc[]> | null = null;

/** 按需加载项目笔记索引。第一次调用会下载全部项目正文，之后走缓存。 */
export function ensureProjectDocs(): Promise<SearchDoc[]> {
  if (!projectDocsPromise) {
    projectDocsPromise = buildProjectDocs();
  }
  return projectDocsPromise;
}
