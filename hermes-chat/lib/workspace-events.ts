/** Fired after a workspace is created or vault list should refresh (sidebar). */
export const WORKSPACES_UPDATED_EVENT = "hermes-chat-workspaces-updated";

export function notifyWorkspacesUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WORKSPACES_UPDATED_EVENT));
}
