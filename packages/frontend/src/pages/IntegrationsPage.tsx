/**
 * pages/IntegrationsPage.tsx
 *
 * Shared Integrations page. Renders nothing by default — the enterprise
 * bundle registers cards into the 'integrations.cards' slot at boot.
 * Gated at the router level by appConfig.enableIntegrations.
 */

import { useEffect, useState } from 'react';
import { renderSlot, _slotCountForTests } from '../lib/slots.js';
import { fetchAgents, type Agent } from '../lib/api.js';

export function IntegrationsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoaded(true));
  }, []);

  const cards = renderSlot('integrations.cards', { agents });
  const haveCards = _slotCountForTests('integrations.cards') > 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-2 font-display text-xl font-semibold">Integrations</h1>
      <p className="mb-6 text-sm text-on-surface-variant">
        Third-party services that augment what your agents can do.
      </p>

      {!loaded ? (
        <div className="text-on-surface-variant">Loading…</div>
      ) : !haveCards ? (
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-6 text-center text-on-surface-variant">
          No integrations available in this deployment.
        </div>
      ) : (
        <div className="space-y-4">{cards}</div>
      )}
    </div>
  );
}
