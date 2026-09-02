import { useState, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import hljs from 'highlight.js/lib/core'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import {
  Check,
  Clipboard,
} from 'lucide-react'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'

hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('go', go)
hljs.registerAliases(['c++', 'cc', 'hpp'], { languageName: 'cpp' })
hljs.registerAliases('golang', { languageName: 'go' })

interface MarkdownRendererProps {
  markdown: string
}

interface CodeBlockProps {
  className?: string
  children?: ReactNode
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

export function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
    >
      {markdown}
    </ReactMarkdown>
  )
}
