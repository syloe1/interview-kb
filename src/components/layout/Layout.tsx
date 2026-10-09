import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Footer } from './Footer';
import { ScrollProgress } from './ScrollProgress';
import { SearchDialog } from '../common/SearchDialog';
// useState	管理侧边栏开关状态
// useEffect	监听路由变化，执行副作用
// useLocation	获取当前 URL 信息
// Outlet	子路由渲染占位符

export function Layout() {
  // false → 侧边栏隐藏（移动端默认收起）
  // true  → 侧边栏显示
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  // 搜索弹窗挂在这里而不是 Header 内部：Header 带 backdrop-blur，
  // 而 backdrop-filter 会让 position: fixed 的后代以 Header 为参照系，弹窗会定位错乱。
  // 顺便也和侧边栏一样，状态由 Layout 统一持有。
  const [isSearchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  // Ctrl/Cmd + K 打开搜索，监听挂在 window 上，页面任何位置按键都有效
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 从搜索结果跳进某个小节时 URL 上会带 ?section=，滚动交给详情页自己处理，
  // 这里不能把人拽回页顶（否则详情页刚滚到位就又被拉回去了）
  const hasSectionTarget = new URLSearchParams(location.search).has('section');

  //路由监听 Effect
  useEffect(() => {
    setSidebarOpen(false); // 切换页面时自动关闭侧边栏
    if (hasSectionTarget) return;
    window.scrollTo({
      // 滚动到页面顶部
      top: 0,
      behavior: 'instant', // 立即跳转（无动画）
    });
  }, [location.pathname, location.search, hasSectionTarget]); // 依赖：路径或查询串变化时触发

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <ScrollProgress />
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onSearchOpen={() => setSearchOpen(true)}
      />
      <div className="mx-auto grid min-h-[calc(100vh-68px)] max-w-[1440px] lg:grid-cols-[252px_minmax(0,1fr)]">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[1060px]">
            <Outlet />
          </div>
        </main>
      </div>
      <Footer />

      <SearchDialog open={isSearchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
