import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Home } from './pages/Home'
import { Projects } from './pages/Projects'
import { Go } from './pages/Go'
import { Cpp } from './pages/Cpp'
import { Database } from './pages/Database'
import { Fundamentals } from './pages/Fundamentals'
import { NotFound } from './pages/NotFound'

const ProjectDetail = lazy(() => import('./pages/ProjectDetail').then((module) => ({ default: module.ProjectDetail })))

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Suspense fallback={<div className="py-16 text-center text-sm text-slate-400">Loading project notes...</div>}><ProjectDetail /></Suspense>} />
          <Route path="/go" element={<Go />} />
          <Route path="/cpp" element={<Cpp />} />
          <Route path="/database" element={<Database />} />
          <Route path="/fundamentals" element={<Fundamentals />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
