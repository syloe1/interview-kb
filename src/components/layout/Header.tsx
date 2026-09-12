import { GitBranch, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../common/SearchBar';
// 接口契约， 任何使用Header组件的地方，必须传入一个OnMenuClick属性
//无参无返回函数
interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[68px] items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
      <div className="flex w-full items-center gap-3">
        <button
          aria-label="Open navigation"
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <Menu size={19} aria-hidden="true" />
        </button>

        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-slate-900"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 font-mono text-[11px] font-bold text-white">
            &gt;_
          </span>
          Interview-KB
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-5">
          <div className="hidden min-w-0 md:block">
            <SearchBar />
          </div>

          {/* 知乎链接 */}
          <a
            href="https://www.zhihu.com/people/4-23-8-17-89"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M5.721 0C2.251 0 0 2.25 0 5.719V18.28C0 21.751 2.252 24 5.721 24h12.56C21.751 24 24 21.75 24 18.281V5.72C24 2.249 21.75 0 18.281 0zm1.964 4.078c-.271.73-.5 1.434-.68 2.11h4.587c.545-.006.445 1.165.445 1.165H9.384a57.74 57.74 0 0 1-.102 3.498h3.41c-.132.82-.27 1.542-.413 2.167h-3.07c.03 1.29.074 2.355.133 3.195h-.866c-.346-1.69-.686-2.712-1.02-3.065-.335-.354-.75-.53-1.246-.53-.22 0-.457.058-.71.174v-.89c.348.06.68.09.997.09.45 0 .78-.15.993-.45.213-.3.31-.84.292-1.62H5.096c.036-1.08.074-2.175.114-3.284H3.794v-1.11c.54-.37.952-.77 1.236-1.2.284-.43.474-.85.57-1.26h2.085zm8.443.39c.37 0 .666.13.886.39.22.26.345.62.375 1.08v7.38c-.03.46-.15.82-.36 1.08-.21.26-.51.39-.89.39-.38 0-.68-.13-.9-.39-.22-.26-.34-.62-.36-1.08v-7.38c.02-.46.14-.82.36-1.08.22-.26.52-.39.9-.39zm-3.12 3.05h1.76v7.86h-1.76z"/>
            </svg>
            <span className="hidden sm:inline">知乎</span>
          </a>

          {/* 👇 只改这里：将 github.com/ 改为 github.com/syloe1 */}
          <a
            href="https://github.com/syloe1" // ← 改成你的 GitHub 主页
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <GitBranch size={16} aria-hidden="true" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}
