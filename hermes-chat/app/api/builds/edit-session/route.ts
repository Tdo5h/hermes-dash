import { randomUUID } from "crypto";
import {
  findBuildListAppById,
  listEntryToBuildEditPayload,
} from "@/lib/builds-manifest";
import { touchPublishedBuildApp } from "@/lib/builds-admin";
import { readSessionsStore, writeSessionsStore } from "@/lib/hermes-chat-store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = (await req.json()) as { id?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawId = typeof body.id === "string" ? body.id.trim() : "";
  if (!rawId) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  let entry = await findBuildListAppById(rawId);
  if (!entry) {
    return Response.json({ error: "Build not found" }, { status: 404 });
  }

  try {
    await touchPublishedBuildApp(rawId);
    entry = (await findBuildListAppById(rawId)) ?? entry;
  } catch (error) {
    console.warn("[builds/edit-session] touch manifest:", error);
  }

  const sessionId = randomUUID();
  const sessionKey = `webchat:${sessionId}`;
  const buildEdit = listEntryToBuildEditPayload(entry);

  const store = await readSessionsStore();
  store[sessionKey] = {
    sessionId,
    label: entry.name,
    chatType: "build_edit",
    buildEdit,
    updatedAt: Date.now(),
  };
  await writeSessionsStore(store);

  return Response.json({ sessionId });
}
