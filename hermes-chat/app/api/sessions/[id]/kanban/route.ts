import {
  getStoreEntryForWebchatId,
  readSessionsStore,
} from "@/lib/hermes-chat-store";
import { parseCreativeStudioPayload } from "@/lib/creative-studio-session";
import { readCreateKanbanSnapshot } from "@/lib/hermes-kanban";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const clientKey = url.searchParams.get("k");
  const store = await readSessionsStore();
  const { entry } = getStoreEntryForWebchatId(
    store,
    id,
    clientKey || undefined
  );
  const creativeStudio = parseCreativeStudioPayload(
    (entry as { creativeStudio?: unknown } | null | undefined)?.creativeStudio
  );
  const boardSlug = creativeStudio?.kanbanBoardSlug?.trim();
  if (!boardSlug) {
    const snapshot = creativeStudio?.kanbanSnapshot ?? null;
    return Response.json(
      snapshot
        ? {
            ...snapshot,
            cleaned: true,
            cleanedAt: creativeStudio?.kanbanCleanedAt ?? snapshot.cleanedAt ?? null,
            cleanupStatus:
              creativeStudio?.kanbanCleanupStatus ?? snapshot.cleanupStatus ?? null,
          }
        : { boardSlug: null, tasks: [] }
    );
  }
  const snapshot = await readCreateKanbanSnapshot(boardSlug).catch(() => null);
  return Response.json(
    snapshot ??
      creativeStudio?.kanbanSnapshot ?? {
        boardSlug,
        tasks: [],
      }
  );
}
