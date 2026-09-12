import { Link } from 'react-router-dom';
import { Mail, ExternalLink } from 'lucide-react';
import { navigationItems } from '../../data/navigation';
import { projects } from '../../data/projects';

export function Footer() {
  // 取前 5 个项目展示
  const featuredProjects = projects.slice(0, 5);
  // 取前 6 个分类展示
  const featuredCategories = navigationItems.slice(0, 6);

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--footer-bg)]">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* 第一栏：站点简介 */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 font-mono text-[11px] font-bold text-white">
                &gt;_
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                Interview-KB
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
              个人面试知识库，记录项目经历、技术知识和面试问题。把值得再次想起的内容，整理成可以快速检索的笔记。
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
              v0.1 · static knowledge base
            </p>
          </div>

          {/* 第二栏：项目 */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              项目
            </h3>
            <ul className="space-y-2.5">
              {featuredProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    to={project.path}
                    className="group inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                  >
                    {project.name}
                    <ExternalLink
                      size={11}
                      className="opacity-0 transition-opacity group-hover:opacity-60"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  to="/projects"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover:opacity-80"
                >
                  查看全部 {projects.length} 个项目 →
                </Link>
              </li>
            </ul>
          </div>

          {/* 第三栏：笔记分类 */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              笔记分类
            </h3>
            <ul className="space-y-2.5">
              {featuredCategories.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className="group inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                  >
                    {item.label}
                    <ExternalLink
                      size={11}
                      className="opacity-0 transition-opacity group-hover:opacity-60"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 第四栏：联系我 */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              联系我
            </h3>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="https://github.com/syloe1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://www.zhihu.com/people/4-23-8-17-89"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M5.721 0C2.251 0 0 2.25 0 5.719V18.28C0 21.751 2.252 24 5.721 24h12.56C21.751 24 24 21.75 24 18.281V5.72C24 2.249 21.75 0 18.281 0zm1.964 4.078c-.271.73-.5 1.434-.68 2.11h4.587c.545-.006.445 1.165.445 1.165H9.384a57.74 57.74 0 0 1-.102 3.498h3.41c-.132.82-.27 1.542-.413 2.167h-3.07c.03 1.29.074 2.355.133 3.195h-.866c-.346-1.69-.686-2.712-1.02-3.065-.335-.354-.75-.53-1.246-.53-.22 0-.457.058-.71.174v-.89c.348.06.68.09.997.09.45 0 .78-.15.993-.45.213-.3.31-.84.292-1.62H5.096c.036-1.08.074-2.175.114-3.284H3.794v-1.11c.54-.37.952-.77 1.236-1.2.284-.43.474-.85.57-1.26h2.085zm8.443.39c.37 0 .666.13.886.39.22.26.345.62.375 1.08v7.38c-.03.46-.15.82-.36 1.08-.21.26-.51.39-.89.39-.38 0-.68-.13-.9-.39-.22-.26-.34-.62-.36-1.08v-7.38c.02-.46.14-.82.36-1.08.22-.26.52-.39.9-.39zm-3.12 3.05h1.76v7.86h-1.76z"/>
                  </svg>
                  知乎
                </a>
              </li>
              <li>
                <a
                  href="mailto:example@email.com"
                  className="group inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                >
                  <Mail size={14} aria-hidden="true" />
                  Email
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* 底部版权栏 */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-[var(--border-light)] pt-6 sm:flex-row">
          <p className="text-xs text-[var(--text-faint)]">
            © {new Date().getFullYear()} Interview-KB. All rights reserved.
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
            Built with React + TypeScript + Vite
          </p>
        </div>
      </div>
    </footer>
  );
}
