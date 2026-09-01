import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function Layout() {
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }) }, [location.pathname])
  return <div className="min-h-screen bg-[#f7f9fc] text-slate-800"><Header onMenuClick={() => setSidebarOpen(true)} /><div className="mx-auto grid min-h-[calc(100vh-68px)] max-w-[1440px] lg:grid-cols-[252px_minmax(0,1fr)]"><Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} /><main className="min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-10"><div className="mx-auto max-w-[1060px]"><Outlet /></div></main></div></div>
}
