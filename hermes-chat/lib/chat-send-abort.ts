/** In-flight `processChatSend` runs keyed by `sessionKey` — user stop aborts the gateway fetch. */

const inflight = new Map<string, AbortController>();
const userStopKeys = new Set<string>();

export function registerChatSendAbort(sessionKey: string): AbortController {
  const c = new AbortController();
  inflight.set(sessionKey, c);
  return c;
}

export function unregisterChatSendAbort(sessionKey: string) {
  inflight.delete(sessionKey);
}

/** User requested stop — aborts the active Hermes fetch for this session key, if any. */
export function userStopChatSend(sessionKey: string): boolean {
  const c = inflight.get(sessionKey);
  if (!c) return false;
  userStopKeys.add(sessionKey);
  c.abort();
  inflight.delete(sessionKey);
  return true;
}

export function consumeUserStop(sessionKey: string): boolean {
  const v = userStopKeys.has(sessionKey);
  userStopKeys.delete(sessionKey);
  return v;
}
