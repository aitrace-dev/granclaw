import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { LogsPage } from './pages/LogsPage.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="agents/:id/chat" element={<ChatPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
