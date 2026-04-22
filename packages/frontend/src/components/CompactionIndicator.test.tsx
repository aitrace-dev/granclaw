/**
 * CompactionIndicator.test.tsx
 *
 * Covers the rendering contract the ChatPage relies on:
 *   - Renders nothing when neither active nor completed.
 *   - Shows the spinner + "Compacting context…" label while active.
 *   - Collapses to a static "Context compacted" row after the end chunk.
 *   - Prefixes with "Nx" when more than one compaction completed in a
 *     single turn (rare but possible on very long turns).
 *
 * These cover the user's explicit UX request ("as if it is like a tool
 * usage") without verifying tailwind class names, which would be brittle.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompactionIndicator } from './CompactionIndicator.tsx';
import { LanguageProvider } from '../lib/i18n.tsx';

function renderIt(props: React.ComponentProps<typeof CompactionIndicator>) {
  return render(
    <LanguageProvider>
      <CompactionIndicator {...props} />
    </LanguageProvider>,
  );
}

describe('CompactionIndicator', () => {
  it('renders nothing when idle (no active / completed)', () => {
    const { container } = renderIt({});
    expect(container.firstChild).toBeNull();
  });

  it('shows the active state while a compaction is in flight', () => {
    renderIt({ active: true });
    expect(screen.getByTestId('compaction-active')).toBeInTheDocument();
    expect(screen.queryByTestId('compaction-done')).not.toBeInTheDocument();
    // Label must be visible — the user asked for this signal explicitly.
    expect(screen.getByText(/compacting context/i)).toBeInTheDocument();
  });

  it('shows the completed state once one compaction has finished', () => {
    renderIt({ completed: 1 });
    expect(screen.getByTestId('compaction-done')).toBeInTheDocument();
    expect(screen.queryByTestId('compaction-active')).not.toBeInTheDocument();
    expect(screen.getByText(/context compacted/i)).toBeInTheDocument();
  });

  it('prefixes the count when multiple compactions completed in one turn', () => {
    renderIt({ completed: 3 });
    expect(screen.getByText(/3×/)).toBeInTheDocument();
    expect(screen.getByText(/context compacted/i)).toBeInTheDocument();
  });

  it('prefers the active state when both flags are set (mid-cycle render)', () => {
    // On the 2nd compaction of a turn, completed=1 AND active=true can
    // coexist for one render. Active must win so the spinner shows and
    // the user doesn't see the stale "compacted" label flash back.
    renderIt({ active: true, completed: 1 });
    expect(screen.getByTestId('compaction-active')).toBeInTheDocument();
    expect(screen.queryByTestId('compaction-done')).not.toBeInTheDocument();
  });
});
