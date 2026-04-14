import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { capture } from './lib/telemetry.ts';
import { AppShell } from './components/AppShell.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TakeoverPage } from './pages/TakeoverPage.tsx';

export default function App() {
  const location = useLocation();
  useEffect(() => {
    capture('page_viewed', { path: location.pathname });
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="takeover/:token" element={<TakeoverPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        {/* Single splat route so ChatPage stays mounted across view switches —
            WebSocket, streaming state, and scroll position all survive
            navigation between chat/monitor/tasks/etc. */}
        <Route path="agents/:id/*" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
