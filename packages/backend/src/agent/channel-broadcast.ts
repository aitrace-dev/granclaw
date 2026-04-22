/**
 * channel-broadcast.ts
 *
 * Pure-ish helper around the "broadcast one message to all WS clients
 * subscribed to a channel" semantics used by the per-agent process.
 *
 * Kept standalone so the multi-tab sync contract — "every subscriber
 * receives every chunk" — is covered by a fast unit test instead of only
 * an integration one. The bug this guards against is the one Juan reported
 * in 2026-04: Tab A open, Tab B sends a message, Tab A never receives the
 * broadcast chunks. If the backend drops clients from the channel set on
 * disconnect (it does) but fails to re-add them on subscribe (it must not),
 * Tab A stays silently unsubscribed and the turn's chunks vanish.
 */

export interface WsLike {
  readyState: number;
  send(data: string): void;
}

export const WS_OPEN = 1;

/**
 * Serialize `data` once (JSON) and send to every client whose readyState
 * is WS_OPEN. Closing/closed clients are skipped silently — cleanup is
 * the subscribe/close handler's job, not the broadcaster's.
 */
export function broadcastToClients(clients: Iterable<WsLike>, data: unknown): number {
  const json = JSON.stringify(data);
  let sent = 0;
  for (const ws of clients) {
    if (ws.readyState === WS_OPEN) {
      ws.send(json);
      sent++;
    }
  }
  return sent;
}

/**
 * Get (or lazily create) the client set for `channelId`. Centralised so
 * process.ts doesn't reinvent the pattern and tests can share it.
 */
export function getOrCreateChannelSet(
  map: Map<string, Set<WsLike>>,
  channelId: string,
): Set<WsLike> {
  let set = map.get(channelId);
  if (!set) {
    set = new Set();
    map.set(channelId, set);
  }
  return set;
}
