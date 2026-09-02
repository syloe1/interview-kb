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
import { Mq } from './pages/Mq'
import { Algorithm } from './pages/Algorithm'
import { Interview } from './pages/Interview'
import { KnowledgeDetail } from './pages/KnowledgeDetail'
import { K8s } from './pages/K8s'
import { Linux } from './pages/Linux'

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
          <Route path="/go/:noteId" element={<KnowledgeDetail category="go" />} />
          <Route path="/cpp" element={<Cpp />} />
          <Route path="/cpp/:noteId" element={<KnowledgeDetail category="cpp" />} />
          <Route path="/database" element={<Database />} />
          <Route path="/database/:noteId" element={<KnowledgeDetail category="database" />} />
          <Route path="/fundamentals" element={<Fundamentals />} />
          <Route path="/mq" element={<Mq />} />
          <Route path="/mq/:noteId" element={<KnowledgeDetail category="mq" />} />
          <Route path="/algorithms" element={<Algorithm />} />
          <Route path="/algorithms/:noteId" element={<KnowledgeDetail category="algorithms" />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/interview/:noteId" element={<KnowledgeDetail category="interview" />} />
          <Route path="/k8s" element={<K8s />} />
          <Route path="/k8s/:noteId" element={<KnowledgeDetail category="k8s" />} />
          <Route path="/linux" element={<Linux />} />
          <Route path="/linux/:noteId" element={<KnowledgeDetail category="linux" />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
