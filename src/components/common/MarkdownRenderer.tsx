import { useMemo, useState, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import { Check, Clipboard } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { knowledgeImages } from '../../data/knowledgeNotes';
import { createHighlightPlugin } from '../../lib/highlight';
//语法高亮配置
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('go', go);
hljs.registerAliases(['c++', 'cc', 'hpp'], { languageName: 'cpp' });
hljs.registerAliases('golang', { languageName: 'go' });

interface MarkdownRendererProps {
  markdown: string;
  /** 传入搜索关键词时，正文里命中的片段会被包成 <mark class="search-hit"> */
  highlight?: string;
  /** 当前 Markdown 文件路径，用来解析 ![](相对图片)。不传则图片原样输出。 */
  sourcePath?: string;
}

// 把 Markdown 里的相对图片路径拼成 src/ 下的真实路径，再查 Vite 打包后的 URL。
// 例：sourcePath='../content/knowledge/cpp/cc/extension.md', src='image.png'
//     -> 'content/knowledge/cpp/cc/image.png'
function resolveImageSrc(sourcePath: string | undefined, src: string | undefined) {
  if (!src || !sourcePath) return src;
  // 网络图片、data URI、根路径开头的一律不处理
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(src)) return src;

  const baseDir = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
  const parts = `${baseDir}${src}`.split('/');
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  return knowledgeImages[normalized.join('/')] ?? src;
}

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}
//从 ReactNode 提取文本
function getTextContent(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(getTextContent).join('');
  }

  if (children && typeof children === 'object' && 'props' in children) {
    return getTextContent((children.props as { children?: ReactNode }).children);
  }

  return '';
}

function CodeBlock({ className, children }: CodeBlockProps) {
  const [isCopied, setCopied] = useState(false);
  const language = className?.match(/language-([^\s]+)/)?.[1]?.toLowerCase();
  const code = getTextContent(children).replace(/\n$/, '');

  if (!language) {
    return <code className={className}>{children}</code>;
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const isLanguageSupported = Boolean(hljs.getLanguage(language));
  const highlightedCode = isLanguageSupported
    ? hljs.highlight(code, { language }).value
    : '';

  return (
    <code className={`hljs ${className ?? ''}`} data-language={language}>
      <button
        type="button"
        className="code-copy-button"
        aria-label="Copy code"
        title="Copy code"
        onClick={copyCode}
      >
        {isCopied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Clipboard size={14} aria-hidden="true" />
        )}
      </button>
      {isLanguageSupported ? (
        <span dangerouslySetInnerHTML={{ __html: highlightedCode }} />
      ) : (
        children
      )}
    </code>
  );
}
export function MarkdownRenderer({
  markdown,
  highlight = '',
  sourcePath,
}: MarkdownRendererProps) {
  const rehypePlugins = useMemo(
    () => [rehypeSlug, createHighlightPlugin(highlight)],
    [highlight]
  );

  // 自定义组件映射；img 需要 sourcePath 才能把相对路径换成打包后的图片 URL
  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => <h1>{children}</h1>,
      code: CodeBlock,
      img: ({ src, alt, title }) => (
        <img
          src={resolveImageSrc(sourcePath, typeof src === 'string' ? src : undefined)}
          alt={alt ?? ''}
          title={title}
          loading="lazy"
        />
      ),
    }),
    [sourcePath]
  );

  return (
    <ReactMarkdown
      components={components}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
    >
      {markdown}
    </ReactMarkdown>
  );
}
