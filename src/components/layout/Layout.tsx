import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
// useState	管理侧边栏开关状态
// useEffect	监听路由变化，执行副作用
// useLocation	获取当前 URL 信息
// Outlet	子路由渲染占位符

export function Layout() {
  // false → 侧边栏隐藏（移动端默认收起）
  // true  → 侧边栏显示
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  //路由监听 Effect
  useEffect(() => {
    setSidebarOpen(false); // 切换页面时自动关闭侧边栏
    window.scrollTo({
      // 滚动到页面顶部
      top: 0,
      behavior: 'instant', // 立即跳转（无动画）
    });
  }, [location.pathname]); // 依赖：路径变化时触发
  return (
    <div className="min-h-screen bg-[#f7f9fc] text-slate-800">
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <div className="mx-auto grid min-h-[calc(100vh-68px)] max-w-[1440px] lg:grid-cols-[252px_minmax(0,1fr)]">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[1060px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
