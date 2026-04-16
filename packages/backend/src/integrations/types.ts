/**
 * integrations/types.ts
 *
 * Shared types for the integrations framework. Kept in one file so the
 * dependency graph from service code, routes, and DB modules all agrees on
 * the wire shape.
 */

/** Global (per-install) integration configuration row. */
export interface Integration {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Per-agent (per-workspace) activation state for an integration. */
export interface AgentIntegration {
  integrationId: string;
  active: boolean;
  /** External resource id owned by the integration provider (e.g. a cloud-browser profile id).
   *  Persists across deactivations so reactivation reuses the same resource. */
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
