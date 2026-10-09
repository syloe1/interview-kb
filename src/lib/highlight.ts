// 把正文里命中的关键词包成 <mark>，给搜索结果跳转后的定位高亮用。
//
// 做成 rehype 插件而不是「渲染完再操作 DOM」：react-markdown 每次渲染都会重新解析，
// 手工往 text node 里插 <mark> 会破坏 React 管理的节点，之后任何一次更新都可能报
// "The node to be removed is not a child of this node"。这里改的是 hast 语法树，
// 生成出来的 <mark> 由 React 自己渲染，不会有这种冲突。
import type { Element, ElementContent, Root, Text } from 'hast';

// 代码块交给 highlight.js 用 dangerouslySetInnerHTML 渲染，插进去的 <mark> 会被覆盖掉，
// 所以干脆不进入 pre 内部，行为更可预期。
const SKIP_TAGS = new Set(['pre', 'script', 'style']);

function shouldSkip(tagName: string): boolean {
  return SKIP_TAGS.has(tagName);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createMark(value: string): Element {
  return {
    type: 'element',
    tagName: 'mark',
    properties: { className: ['search-hit'] },
    children: [{ type: 'text', value }],
  };
}

function splitTextNode(node: Text, pattern: RegExp): ElementContent[] {
  const pieces = node.value.split(pattern);
  if (pieces.length === 1) return [node];

  const nodes: ElementContent[] = [];
  pieces.forEach((piece, index) => {
    if (piece === '') return;
    // 正则带一个捕获组时，split 结果里的奇数位正好是被捕获的命中词（保留原始大小写）
    nodes.push(index % 2 === 1 ? createMark(piece) : { type: 'text', value: piece });
  });
  return nodes;
}

function highlightChildren(
  children: ElementContent[],
  pattern: RegExp
): ElementContent[] {
  return children.flatMap((child) => {
    if (child.type === 'text') return splitTextNode(child, pattern);

    if (child.type === 'element') {
      if (shouldSkip(child.tagName)) return [child];
      return [{ ...child, children: highlightChildren(child.children, pattern) }];
    }

    return [child];
  });
}

// 空查询时返回一个什么都不做的 transform，省得调用方再判空
const noop = () => () => {};

/**
 * 把查询拆成词后合成一个高亮正则：带一个捕获组，
 * split 出来的奇数位就是命中的片段。查询为空时返回 null。
 */
export function createHighlightPattern(query: string): RegExp | null {
  // 长词排前面：「零拷贝」和「零」同时在查询里时，要优先匹配长的那个
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (terms.length === 0) return null;

  return new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
}

/**
 * 生成一个 rehype 插件，把 query 里的每个词在正文中标记出来。
 *
 * 注意返回的必须是「attacher」而不是 transformer：unified 拿到插件后，
 * 会先用 options 调用它一次，再拿它返回的函数去处理语法树。
 * 如果这里直接交出去一个 (tree) => {...}，它会被当作 attacher 调用 —— 参数是 options
 * 而不是语法树，tree 就是 undefined，一挂载就崩。TypeScript 拦不住，因为 unified
 * 的插件类型很宽松。
 */
export function createHighlightPlugin(query: string) {
  const pattern = createHighlightPattern(query);
  if (!pattern) return noop;

  return () => (tree: Root) => {
    tree.children = tree.children.map((child) =>
      child.type === 'element' && !shouldSkip(child.tagName)
        ? { ...child, children: highlightChildren(child.children, pattern) }
        : child
    );
  };
}
