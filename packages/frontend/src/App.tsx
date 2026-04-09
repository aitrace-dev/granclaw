import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="agents/:id/chat" element={<ChatPage />} />
        <Route path="agents/:id/view/:view" element={<ChatPage />} />
        <Route path="agents/:id" element={<Navigate to="chat" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
