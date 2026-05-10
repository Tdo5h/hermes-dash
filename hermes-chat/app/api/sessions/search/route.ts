import { readFile } from "fs/promises";
import { isHeartbeatNoiseLabel } from "@/lib/heartbeat-noise";
import { getHermesChatSessionsJsonPath } from "@/lib/hermes-chat-paths";
import { getMessagesJsonPath, readSessionsStore } from "@/lib/hermes-chat-store";
import { dedupeSessionsForSidebar } from "@/lib/sidebar-sessions";
import { transcriptSidebarEnrichment } from "@/lib/session-transcript-flags";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { searchMessagesContainDb } from "@/lib/db/repositories";

const SESSIONS_PATH = getHermesChatSessionsJsonPath();

const MAX_RESULTS = 30;

function isWebchatKey(key: string): boolean {
  return key.startsWith("webchat:") || key.includes(":webchat:");
}

function extractWebchatId(key: string): string {
  const idx = key.lastIndexOf("webchat:");
  return idx >= 0 ? key.slice(idx + 8) : key;
}

async function searchTranscript(sessionId: string, query: string): Promise<boolean> {
  if (shouldUseChatDatabase()) {
    return searchMessagesContainDb(sessionId, query);
  }
  try {
    const raw = await readFile(getMessagesJsonPath(sessionId), "utf-8");
    return raw.toLowerCase().includes(query);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  if (!q || q.length < 2) {
    return Response.json([]);
  }

  try {
    const data = shouldUseChatDatabase()
      ? await readSessionsStore()
      : ((await readFile(SESSIONS_PATH, "utf-8").then((raw) =>
          JSON.parse(raw)
        )) as Record<string, unknown>);

    const rawCandidates = Object.entries(data)
      .filter(([key, value]) => {
        if (!isWebchatKey(key)) return false;
        const v = value as { label?: string; origin?: { label?: string } };
        return !!(v.label || v.origin?.label);
      })
      .map(([key, value]) => {
        const v = value as {
          sessionId?: string;
          label?: string;
          origin?: { label?: string };
          updatedAt?: number;
          chatType?: string;
          projectId?: string;
        };
        const chatType = (v.chatType || "direct") as string;
        const projectId =
          typeof v.projectId === "string" && v.projectId.trim()
            ? v.projectId.trim()
            : null;
        return {
          key,
          id: v.sessionId as string,
          webchatId: isWebchatKey(key) ? extractWebchatId(key) : null,
          label:
            (v.label ||
              v.origin?.label ||
              key.split(":").pop() ||
              "Chat") as string,
          updatedAt: (v.updatedAt || 0) as number,
          chatType,
          projectId,
          processing: false,
        };
      })
      .filter((s) => !isHeartbeatNoiseLabel(s.label))
      .filter(
        (s) =>
          s.chatType !== "workspace" &&
          s.chatType !== "build_edit" &&
          s.chatType !== "creative_studio" &&
          !(s as { projectId?: string | null }).projectId
      );

    const candidates = dedupeSessionsForSidebar(rawCandidates).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );

    const results: typeof candidates = [];

    for (const session of candidates) {
      if (results.length >= MAX_RESULTS) break;

      if (session.label.toLowerCase().includes(q)) {
        results.push(session);
        continue;
      }

      if (session.id && (await searchTranscript(session.id, q))) {
        results.push(session);
      }
    }

    const enriched = await Promise.all(
      results.map(async (s) => {
        const sid = String(s.webchatId || s.id);
        const { hasImages, messageCount, promptCount } = sid
          ? await transcriptSidebarEnrichment(sid)
          : { hasImages: false, messageCount: 0, promptCount: 0 };
        return { ...s, hasImages, messageCount, promptCount };
      })
    );

    return Response.json(enriched);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
