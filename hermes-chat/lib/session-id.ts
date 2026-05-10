/**
 * Matches UUID-shaped ids for /chat/[sessionId] (including every `crypto.randomUUID()` variant).
 * Used to treat "new chat before first persisted row" as 200 + empty messages, not 404.
 */
export function isLikelyChatSessionId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id.trim()
  );
}
