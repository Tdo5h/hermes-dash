import { findBuildListAppById } from "@/lib/builds-manifest";
import { parseCreativeStudioPayload } from "@/lib/creative-studio-session";
import { readSessionsStore, writeSessionsStore } from "@/lib/hermes-chat-store";

export const dynamic = "force-dynamic";

/**
 * Link a creative_studio webchat session to a published manifest app so the chat
 * appears under that app in the Creations sidebar (with edit chats), not under "Create chats".
 */
export async function POST(req: Request) {
  let body: { sessionId?: unknown; buildId?: unknown };
  try {
    body = (await req.json()) as { sessionId?: unknown; buildId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const buildId = typeof body.buildId === "string" ? body.buildId.trim() : "";
  if (!sessionId || !buildId) {
    return Response.json(
      { error: "sessionId and buildId required" },
      { status: 400 }
    );
  }

  const app = await findBuildListAppById(buildId);
  if (!app) {
    return Response.json({ error: "Build not found in manifest" }, { status: 404 });
  }

  const key = `webchat:${sessionId}`;
  const store = await readSessionsStore();
  const row = store[key] as
    | {
        chatType?: string;
        creativeStudio?: unknown;
        buildEdit?: unknown;
        label?: string;
        updatedAt?: number;
      }
    | undefined;

  if (!row || row.chatType !== "creative_studio") {
    return Response.json(
      { error: "Session is not a Create (creative_studio) chat" },
      { status: 400 }
    );
  }
  if (row.buildEdit != null) {
    return Response.json({ error: "Invalid session shape" }, { status: 400 });
  }

  const cs = parseCreativeStudioPayload(row.creativeStudio);
  if (!cs) {
    return Response.json({ error: "Missing creative studio metadata" }, { status: 400 });
  }

  store[key] = {
    ...row,
    creativeStudio: {
      ...cs,
      publishedBuildId: app.id,
      publishedBuildName: app.name,
    },
    updatedAt: Date.now(),
  };
  await writeSessionsStore(store);

  return Response.json({ ok: true, buildId: app.id, name: app.name });
}
