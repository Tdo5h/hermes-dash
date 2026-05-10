import { loadSessionMessages } from "@/lib/hermes-chat-store";
import { getImageUrls } from "@/lib/sessions";

/**
 * One read of the transcript for sidebar list rows: image hint, transcript message
 * count, and prompt count used by the jump-to-next-prompt control.
 */
export async function transcriptSidebarEnrichment(sessionId: string): Promise<{
  hasImages: boolean;
  messageCount: number;
  promptCount: number;
}> {
  const id = (sessionId || "").trim();
  if (!id || id.length > 512) {
    return { hasImages: false, messageCount: 0, promptCount: 0 };
  }
  try {
    const messages = await loadSessionMessages(id);
    if (!Array.isArray(messages)) {
      return { hasImages: false, messageCount: 0, promptCount: 0 };
    }

    let hasImages = false;
    let messageCount = 0;
    let promptCount = 0;
    for (const m of messages) {
      if (m.role === "user" || m.role === "assistant") messageCount += 1;
      if (m.role === "user") promptCount += 1;
      if (!hasImages && getImageUrls(m.content).length > 0) hasImages = true;
    }
    return { hasImages, messageCount, promptCount };
  } catch {
    return { hasImages: false, messageCount: 0, promptCount: 0 };
  }
}
