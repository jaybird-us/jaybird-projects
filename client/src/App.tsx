import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from 'sonner';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppLayout } from '@/layouts/AppLayout';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { Analytics } from '@/pages/Analytics';
import { UserSettings } from '@/pages/UserSettings';
import { Configuration } from '@/pages/Configuration';
import { Documents } from '@/pages/Documents';
import { Dependencies } from '@/pages/Dependencies';
import { Resources } from '@/pages/Resources';
import { Milestones } from '@/pages/Milestones';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Landing />} />

          {/* Protected app routes */}
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectNumber" element={<ProjectDetail />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="documents" element={<Documents />} />
            <Route path="dependencies" element={<Dependencies />} />
            <Route path="resources" element={<Resources />} />
            <Route path="milestones" element={<Milestones />} />
            <Route path="settings" element={<UserSettings />} />
            <Route path="configuration" element={<Configuration />} />
          </Route>
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
