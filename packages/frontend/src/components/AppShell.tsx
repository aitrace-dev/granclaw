import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/dashboard', icon: '⬡', label: 'Dashboard' },
  { to: '/agents',    icon: '⬢', label: 'Agents' },
  { to: '/logs',      icon: '≡',  label: 'Logs' },
  { to: '/settings',  icon: '⚙',  label: 'Settings' },
];

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Sidebar */}
      <nav className="flex w-[60px] flex-shrink-0 flex-col items-center bg-surface-lowest py-4 gap-2">
        <div className="mb-4 font-display text-primary font-bold text-lg select-none">AB</div>
        {navItems.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              `relative flex h-10 w-10 items-center justify-center rounded text-xl transition-colors
               ${isActive
                 ? 'text-on-surface before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-secondary'
                 : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-low'
               }`
            }
          >
            {icon}
          </NavLink>
        ))}
      </nav>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface-low px-5">
          <span className="font-display font-semibold text-on-surface tracking-tight">
            agent-brother
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-secondary-container/20 px-3 py-1 text-xs font-mono text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" />
            system online
          </span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
