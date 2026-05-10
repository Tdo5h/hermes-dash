import { randomUUID } from "crypto";
import { readSessionsStore, writeSessionsStore } from "@/lib/hermes-chat-store";
import { readProject } from "@/lib/project-service";
import {
  createCreativeStudioSessionLabel,
  creativeStudioIntentLabel,
  isCreativeStudioIntent,
  type CreativeStudioSessionPayload,
} from "@/lib/creative-studio-session";
import { parseCreateProductionBrief } from "@/lib/create-production-types";
import { ensureCreateKanbanSession } from "@/lib/hermes-kanban";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    intent?: unknown;
    seedPrompt?: unknown;
    createBrief?: unknown;
    referenceVaultSlug?: unknown;
    referenceVaultName?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const intentRaw = typeof body.intent === "string" ? body.intent.trim() : "";
  if (!intentRaw || !isCreativeStudioIntent(intentRaw)) {
    return Response.json({ error: "intent required" }, { status: 400 });
  }
  const seedRaw =
    typeof body.seedPrompt === "string" ? body.seedPrompt.trim() : "";
  const refSlugRaw =
    typeof body.referenceVaultSlug === "string"
      ? body.referenceVaultSlug.trim()
      : "";
  const refNameRaw =
    typeof body.referenceVaultName === "string"
      ? body.referenceVaultName.trim()
      : "";
  const createBrief = parseCreateProductionBrief(body.createBrief);
  let referenceVault: { slug: string; name: string } | undefined;
  if (refSlugRaw) {
    const proj = await readProject(refSlugRaw);
    if (!proj) {
      return Response.json({ error: "Unknown reference vault" }, { status: 400 });
    }
    const name = (refNameRaw || proj.name).trim() || proj.slug;
    referenceVault = { slug: proj.slug, name };
  }
  const sessionId = randomUUID();
  const label = creativeStudioIntentLabel(intentRaw);
  const kanban = await ensureCreateKanbanSession({
    sessionId,
    intent: intentRaw,
    label,
    ...(seedRaw ? { seedPrompt: seedRaw } : {}),
    ...(referenceVault?.name ? { referenceVaultName: referenceVault.name } : {}),
  }).catch((e) => {
    console.warn("[create-session] create kanban:", e);
    return null;
  });

  const payload: CreativeStudioSessionPayload = {
    intent: intentRaw,
    ...(seedRaw ? { seedPrompt: seedRaw } : {}),
    ...(createBrief ? { createBrief } : {}),
    ...(referenceVault
      ? {
          referenceVaultSlug: referenceVault.slug,
          referenceVaultName: referenceVault.name,
        }
      : {}),
    ...(kanban
      ? {
          kanbanBoardSlug: kanban.boardSlug,
          kanbanBoardName: kanban.boardName,
          ...(kanban.rootTaskId ? { kanbanRootTaskId: kanban.rootTaskId } : {}),
          ...(kanban.taskIds.length > 0 ? { kanbanTaskIds: kanban.taskIds } : {}),
        }
      : {}),
  };

  const sessionKey = `webchat:${sessionId}`;
  const store = await readSessionsStore();
  store[sessionKey] = {
    sessionId,
    label: createCreativeStudioSessionLabel(payload),
    chatType: "creative_studio",
    creativeStudio: payload,
    updatedAt: Date.now(),
  };
  await writeSessionsStore(store);

  return Response.json({ sessionId });
}
