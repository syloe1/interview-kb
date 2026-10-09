// Markdown 的公共解析工具：标题锚点、右侧目录、按小节切分、标题和摘要提取。
// 页面渲染、目录和搜索索引都从这里取，避免三处各写一遍解析逻辑。
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export interface OutlineItem {
  /** 锚点 id，和 rehype-slug 渲染出的 id 一致 */
  id: string;
  label: string;
}

export interface MarkdownSection {
  /** 小节标题；第一个标题之前的内容用笔记标题 */
  label: string;
  /** 锚点 id，空字符串表示「跳到笔记开头」，没有对应标题 */
  id: string;
  /** 小节正文的纯文本，搜索和片段截取用 */
  text: string;
}

// 搜索的落点粒度：h2 和 h3 各自单独成节。
// 只切到 h2 的话，cc.md（56KB）那种大节会把底下的「io_uring 零拷贝」一起吞掉，
// 跳过去还得自己往下滚；切到 h3 后各节正文中位数从 169 字符降到 118 字符。
const SECTION_MAX_DEPTH = 3;

function parse(markdown: string) {
  return unified().use(remarkParse).parse(markdown);
}

// 把多个节点的纯文本拼成一行，搜索时不用关心换行和多余空格
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// 注意：rehype-slug 会给 h1~h6 所有标题按出现顺序生成锚点，
// 同名标题会依次得到 name、name-1、name-2。
// 所以这里也必须把每一级标题都喂给同一个 slugger —— 只对 h2 调 slug()，
// 遇到 h1 和某个 h2 同名时算出来的 id 就会和页面上的对不上，跳转会跳空。
export function getTableOfContents(markdown: string): OutlineItem[] {
  const slugger = new GithubSlugger();
  const items: OutlineItem[] = [];

  visit(parse(markdown), 'heading', (node) => {
    // 锚点必须拿「没裁剪过」的原串去算：github-slugger 会把首尾空格也变成 '-'。
    // 比如 qt.md 的 "## ` <QTextStream>`：..."，标题正文以空格开头，
    // 页面上渲染出的 id 就是 "-qtextstreamqt-..."，trim 过之后算出来会对不上。
    // 裁剪后的版本只用来判断空标题和做显示。
    const raw = toString(node);
    const label = raw.trim();
    // 源文件里偶尔有光秃秃的 "##"，rehype-slug 会给它 id=""，
    // 而 getElementById('') 永远拿不到元素，这种标题进目录只会点了没反应
    if (!label) return;

    const id = slugger.slug(raw);
    if (node.depth === 2) {
      items.push({ id, label });
    }
  });

  return items;
}

// 按二级标题把一篇笔记切成若干小节，给搜索索引用。
// 切出来的 id 和 getTableOfContents 同源，所以搜索结果能直接跳过去。
export function splitIntoSections(
  markdown: string,
  noteTitle: string
): MarkdownSection[] {
  const tree = parse(markdown);
  const slugger = new GithubSlugger();
  const sections: MarkdownSection[] = [];

  let buffer: string[] = [];
  let currentLabel = noteTitle;
  let currentId = '';

  const flush = () => {
    const text = normalizeWhitespace(buffer.join(' '));
    buffer = [];
    // 开篇小节（id 为空）如果一点正文都没有，就没什么可搜的
    if (!text && !currentId) return;
    sections.push({ label: currentLabel, id: currentId, text });
  };

  for (const node of tree.children) {
    if (node.type === 'heading') {
      // 同 getTableOfContents：算锚点用原串，判空和显示用裁剪过的
      const raw = toString(node);
      const label = raw.trim();
      // 空标题没有可用锚点，跳过；它后面的正文归到上一个小节里
      if (!label) continue;

      const id = slugger.slug(raw);

      if (node.depth <= SECTION_MAX_DEPTH) {
        flush();
        currentLabel = label;
        currentId = id;
        continue;
      }
      // 更深的标题（h4 及以下）归到所属小节，标题文字也算进正文
      buffer.push(label);
      continue;
    }

    buffer.push(toString(node));
  }
  flush();

  return sections;
}

/** 从文件路径取不带扩展名的文件名，如 '../content/knowledge/go/go.md' -> 'go' */
export function getFileNameFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? '';
}

/** 取正文里第一个一级标题作为笔记标题，没有就退回文件名 */
export function getNoteTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

/** 取第一段非标题、非引用、非代码的正文，作为列表页的摘要 */
export function getNoteSummary(markdown: string): string {
  const summary = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !line.startsWith('#') &&
        !line.startsWith('>') &&
        !line.startsWith('```') &&
        !line.startsWith('<!--')
    );

  return summary || '这篇笔记暂时还没有摘要。';
}
