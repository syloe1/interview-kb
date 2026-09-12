import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, BookOpen, Code2, Database } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

export function Hero() {
  return (
    <section className="relative -mx-4 -mt-8 overflow-hidden bg-slate-900 sm:-mx-6 lg:-mx-10 lg:-mt-10">
      {/* 科技感背景：网格 + 径向光晕 */}
      <div className="absolute inset-0">
        {/* 基础渐变 */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
        {/* 网格线 */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        {/* 径向光晕 */}
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#2e5d94] opacity-20 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 h-80 w-80 rounded-full bg-[#3b82f6] opacity-10 blur-3xl" />
      </div>

      {/* 内容容器 */}
      <div className="relative flex min-h-[calc(100vh-68px)] flex-col px-6 py-8 sm:px-10 lg:px-14">
        {/* 顶部悬浮导航 */}
        <nav className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 font-mono text-[11px] font-bold text-white">
              &gt;_
            </span>
            <span className="text-sm font-semibold tracking-[-0.01em] text-white">
              Interview-KB
            </span>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <Link to="/projects" className="text-sm text-slate-300 transition-colors hover:text-white">
              项目
            </Link>
            <Link to="/go" className="text-sm text-slate-300 transition-colors hover:text-white">
              Go
            </Link>
            <Link to="/database" className="text-sm text-slate-300 transition-colors hover:text-white">
              Database
            </Link>
            <Link to="/fundamentals" className="text-sm text-slate-300 transition-colors hover:text-white">
              八股
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-slate-300 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              v0.1
            </span>
          </div>
        </nav>

        {/* 主内容区：右侧大标题 */}
        <div className="flex flex-1 items-center">
          <div className="grid w-full gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            {/* 左侧：特性标签 */}
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm">
                <Sparkles size={13} className="text-[#60a5fa]" />
                后端面试知识库
              </div>
              <div className="space-y-3">
                {[
                  { icon: BookOpen, text: '14 个项目经历与架构设计' },
                  { icon: Code2, text: 'Go / C++ 技术栈深度笔记' },
                  { icon: Database, text: '数据库、分布式、操作系统八股' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-slate-400">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                      <item.icon size={14} className="text-[#60a5fa]" />
                    </span>
                    {item.text}
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧：超大标题 */}
            <div className="text-right">
              <h1 className="text-5xl font-bold leading-[0.95] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
                Interview
                <br />
                <span className="bg-gradient-to-r from-[#60a5fa] to-[#93c5fd] bg-clip-text text-transparent">
                  -KB
                </span>
              </h1>
              <p className="mt-5 text-base font-medium text-slate-400 sm:text-lg">
                Personal Interview Knowledge Base
              </p>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500 lg:ml-auto lg:mr-0">
                把值得再次想起的内容，整理成可以快速检索的笔记。
                <br />
                项目经历 · 技术知识 · 面试问题
              </p>

              {/* 按钮组 */}
              <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
                <Link
                  to="/projects"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2e5d94] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1e4a7a]"
                >
                  浏览项目
                  <ArrowRight size={15} />
                </Link>
                <a
                  href="https://github.com/syloe1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  GitHub 仓库
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* 底部 Alert 通知条 */}
        <div className="mt-8">
          <Alert variant="success" className="border-white/10 bg-white/5 text-slate-200 backdrop-blur-sm [&>svg]:text-[#60a5fa]">
            <Sparkles className="h-4 w-4" />
            <AlertTitle className="text-white">持续更新中</AlertTitle>
            <AlertDescription className="text-slate-400">
              知识库正在逐步完善，Go / C++ / Database 分类已有内容，八股、MQ、算法题等板块 Coming Soon。欢迎 Star 关注。
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </section>
  );
}
