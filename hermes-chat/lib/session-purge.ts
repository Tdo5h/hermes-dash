import { unlink } from "fs/promises";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { deleteChatMessagesForSessionId } from "@/lib/db/repositories";
import { deleteWebchatImageById } from "@/lib/images";
import {
  getMessagesJsonPath,
  loadSessionMessages,
  deleteSessionKeyFromStore,
} from "@/lib/hermes-chat-store";
import type { ChatMessage } from "@/lib/sessions";
import { getImageUrls, activeFilePath, statusFilePath } from "@/lib/sessions";
import { removeSessionFromAllWorkspaceThreadMaps } from "@/lib/workspace-thread";

function collectWebchatImageIdsFromMessages(messages: ChatMessage[]): string[] {
  const out = new Set<string>();
  const addFromString = (s: string) => {
    for (const m of s.matchAll(/\/api\/images\/([^\s)"'<>?#]+)/g)) {
      const id = m[1]?.split("?")[0]?.split("#")[0];
      if (id && !id.includes("..")) out.add(id);
    }
  };
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      addFromString(msg.content);
    } else {
      for (const p of msg.content) {
        if (p.type === "text" && p.text) addFromString(p.text);
        if (p.type === "image_url" && p.image_url?.url) {
          const u = p.image_url.url;
          if (u.startsWith("/api/images/")) {
            const id = u.replace(/^\/api\/images\//, "").split("?")[0];
            if (id && !id.includes("..")) out.add(id);
          }
        }
      }
    }
    for (const u of getImageUrls(msg.content)) {
      if (u.startsWith("/api/images/")) {
        const id = u.replace(/^\/api\/images\//, "").split("?")[0];
        if (id && !id.includes("..")) out.add(id);
      }
    }
  }
  return [...out];
}

/**
 * Irreversibly remove a session: messages, store row, status files, workspace map pins, transcript media.
 */
export async function purgeChatSessionData(
  sessionId: string,
  resolvedKey: string
): Promise<void> {
  const messages = await loadSessionMessages(sessionId);
  const imageIds = collectWebchatImageIdsFromMessages(messages);
  for (const id of imageIds) {
    await deleteWebchatImageById(id);
  }
  if (shouldUseChatDatabase()) {
    await deleteChatMessagesForSessionId(sessionId);
  }
  try {
    await unlink(getMessagesJsonPath(sessionId));
  } catch {
    /* no legacy file */
  }
  await removeSessionFromAllWorkspaceThreadMaps(sessionId);
  await deleteSessionKeyFromStore(resolvedKey);
  const statusKeys = new Set<string>([resolvedKey, `webchat:${sessionId}`]);
  for (const k of statusKeys) {
    try {
      await unlink(statusFilePath(k));
    } catch {
      /* no status for this key */
    }
  }
  try {
    await unlink(activeFilePath(sessionId));
  } catch {
    /* no active */
  }
}
