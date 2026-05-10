import path from "path";
import { readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { getHermesChatDataDir } from "@/lib/hermes-config";
import {
  readSessionsStore,
  writeSessionsStore,
  resolveSessionKey,
} from "@/lib/hermes-chat-store";
import { readProject } from "@/lib/project-service";
import { sessionHasAnyMessages } from "@/lib/hermes-chat-store";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  loadWorkspaceThreadMapDb,
  replaceWorkspaceThreadMapDb,
} from "@/lib/db/repositories";
import {
  type BuildEditSessionPayload,
  parseBuildEditPayload,
} from "@/lib/builds-manifest";
import {
  type CreativeStudioSessionPayload,
  parseCreativeStudioPayload,
} from "@/lib/creative-studio-session";

type ThreadMap = Record<string, { sessionId: string }>;

function threadsPath(): string {
  return path.join(getHermesChatDataDir(), "workspace-threads.json");
}

async function loadMap(): Promise<ThreadMap> {
  if (shouldUseChatDatabase()) {
    return loadWorkspaceThreadMapDb();
  }
  try {
    const raw = await readFile(threadsPath(), "utf-8");
    return JSON.parse(raw) as ThreadMap;
  } catch {
    return {};
  }
}

async function saveMap(m: ThreadMap): Promise<void> {
  if (shouldUseChatDatabase()) {
    await replaceWorkspaceThreadMapDb(m);
    return;
  }
  await writeFile(threadsPath(), JSON.stringify(m, null, 2), "utf-8");
}

function extractWebchatIdFromKey(key: string): string | null {
  const idx = key.lastIndexOf("webchat:");
  if (idx < 0) return null;
  return key.slice(idx + 8);
}

export type WorkspaceSessionRow = {
  sessionId: string;
  sessionKey: string;
  label: string;
  updatedAt: number;
};

/**
 * All HermesChat sessions bound to this vault (project slug).
 */
export async function listWorkspaceSessions(
  projectSlug: string
): Promise<WorkspaceSessionRow[]> {
  const store = await readSessionsStore();
  const byId = new Map<string, WorkspaceSessionRow>();

  for (const [key, value] of Object.entries(store)) {
    const v = value as {
      sessionId?: string;
      chatType?: string;
      projectId?: string;
      label?: string;
      origin?: { label?: string };
      updatedAt?: number;
    };
    if (v.chatType !== "workspace") continue;
    if (v.projectId !== projectSlug) continue;

    const sid =
      (typeof v.sessionId === "string" && v.sessionId) ||
      extractWebchatIdFromKey(key);
    if (!sid) continue;

    const label =
      v.label ||
      v.origin?.label ||
      extractWebchatIdFromKey(key) ||
      "Chat";
    const updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : 0;
    const row: WorkspaceSessionRow = {
      sessionId: sid,
      sessionKey: key,
      label,
      updatedAt,
    };

    const prev = byId.get(sid);
    if (!prev || row.updatedAt > prev.updatedAt) {
      byId.set(sid, row);
    }
  }

  return [...byId.values()]
    .map((r) => ({
      ...r,
      sessionKey:
        resolveSessionKey(
          store as Record<string, unknown>,
          `webchat:${r.sessionId}`
        ) || `webchat:${r.sessionId}`,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Most recently touched workspace session with no messages (for deduping uploads / draft).
 */
export async function findReusableEmptyWorkspaceSession(
  projectSlug: string
): Promise<WorkspaceSessionRow | null> {
  const sessions = await listWorkspaceSessions(projectSlug);
  for (const row of sessions) {
    if (!(await sessionHasAnyMessages(row.sessionId))) {
      return row;
    }
  }
  return null;
}

/**
 * Create a new empty workspace chat under this vault.
 */
export async function createWorkspaceSession(projectSlug: string): Promise<{
  sessionId: string;
  sessionKey: string;
}> {
  const project = await readProject(projectSlug);
  if (!project) throw new Error("Workspace not found");

  const sessionId = randomUUID();
  const sessionKey = `webchat:${sessionId}`;
  const store = await readSessionsStore();
  store[sessionKey] = {
    sessionId,
    label: "New chat",
    projectId: projectSlug,
    projectLabel: project.name,
    updatedAt: Date.now(),
    chatType: "workspace",
  };
  await writeSessionsStore(store);

  const map = await loadMap();
  if (!map[projectSlug]?.sessionId) {
    map[projectSlug] = { sessionId };
    await saveMap(map);
  }

  return { sessionId, sessionKey };
}

/**
 * Prefer pinned id from workspace-threads.json if that session still exists;
 * else most recently updated workspace session; else create first session.
 */
export async function getDefaultWorkspaceSession(projectSlug: string): Promise<{
  sessionId: string;
  sessionKey: string;
}> {
  const project = await readProject(projectSlug);
  if (!project) throw new Error("Workspace not found");

  const list = await listWorkspaceSessions(projectSlug);
  const map = await loadMap();
  const pinnedId = map[projectSlug]?.sessionId;

  if (pinnedId) {
    const hit = list.find((r) => r.sessionId === pinnedId);
    if (hit) {
      await ensureWorkspaceRowMetadata(hit.sessionKey, projectSlug, project.name);
      return { sessionId: hit.sessionId, sessionKey: hit.sessionKey };
    }
    const store = await readSessionsStore();
    const sk = `webchat:${pinnedId}`;
    if (!store[sk]) {
      store[sk] = {
        sessionId: pinnedId,
        label: project.name,
        projectId: projectSlug,
        projectLabel: project.name,
        updatedAt: Date.now(),
        chatType: "workspace",
      };
      await writeSessionsStore(store);
    } else {
      const cur = store[sk] as Record<string, unknown>;
      store[sk] = {
        ...cur,
        sessionId: pinnedId,
        projectId: projectSlug,
        projectLabel: project.name,
        chatType: "workspace",
        updatedAt: Date.now(),
      };
      await writeSessionsStore(store);
    }
    const resolved =
      resolveSessionKey(store as Record<string, unknown>, sk) || sk;
    return { sessionId: pinnedId, sessionKey: resolved };
  }

  if (list.length > 0) {
    const top = list[0];
    await ensureWorkspaceRowMetadata(top.sessionKey, projectSlug, project.name);
    return { sessionId: top.sessionId, sessionKey: top.sessionKey };
  }

  return createWorkspaceSession(projectSlug);
}

async function ensureWorkspaceRowMetadata(
  sessionKey: string,
  projectSlug: string,
  projectName: string
): Promise<void> {
  const store = await readSessionsStore();
  const key =
    resolveSessionKey(store as Record<string, unknown>, sessionKey) || sessionKey;
  const cur = (store[key] as Record<string, unknown>) || {};
  store[key] = {
    ...cur,
    projectId: projectSlug,
    projectLabel: projectName,
    chatType: "workspace",
  };
  await writeSessionsStore(store);
}

/**
 * Default workspace thread for /chat/workspace/:slug and vault flows.
 */
export async function getOrCreateWorkspaceThread(projectSlug: string): Promise<{
  sessionId: string;
  sessionKey: string;
}> {
  return getDefaultWorkspaceSession(projectSlug);
}

export async function getProjectIdForSession(
  sessionKey: string
): Promise<{ projectId: string | null; projectLabel: string | null }> {
  const store = await readSessionsStore();
  const key = resolveSessionKey(store, sessionKey) || sessionKey;
  const cur = store[key] as
    | { projectId?: string; projectLabel?: string }
    | undefined;
  return {
    projectId: typeof cur?.projectId === "string" ? cur.projectId : null,
    projectLabel:
      typeof cur?.projectLabel === "string" ? cur.projectLabel : null,
  };
}

/**
 * Build-edit chats (Builds tab → Edit) carry structured metadata for the gateway preamble.
 */
export async function getBuildEditForSession(
  sessionKey: string
): Promise<BuildEditSessionPayload | null> {
  const store = await readSessionsStore();
  const key = resolveSessionKey(store, sessionKey) || sessionKey;
  const cur = store[key] as
    | { buildEdit?: unknown; chatType?: string }
    | undefined;
  if (cur?.chatType !== "build_edit") return null;
  return parseBuildEditPayload(cur.buildEdit);
}

/**
 * Create-tab chats (HermesChat Create → New create) carry intent metadata for the gateway preamble.
 */
export async function getCreativeStudioForSession(
  sessionKey: string
): Promise<CreativeStudioSessionPayload | null> {
  const store = await readSessionsStore();
  const key = resolveSessionKey(store, sessionKey) || sessionKey;
  const cur = store[key] as
    | { creativeStudio?: unknown; chatType?: string }
    | undefined;
  if (cur?.chatType !== "creative_studio") return null;
  return parseCreativeStudioPayload(cur.creativeStudio);
}

/**
 * Remove this session from workspace default-thread maps (FS `workspace-threads.json` or DB `workspace_thread_pins`).
 */
export async function removeSessionFromAllWorkspaceThreadMaps(
  sessionId: string
): Promise<void> {
  if (shouldUseChatDatabase()) {
    const m = await loadWorkspaceThreadMapDb();
    const next: Record<string, { sessionId: string }> = {};
    for (const [k, v] of Object.entries(m)) {
      if (v.sessionId !== sessionId) next[k] = v;
    }
    await replaceWorkspaceThreadMapDb(next);
  } else {
    const m = await loadMap();
    const next: ThreadMap = {};
    for (const [k, v] of Object.entries(m)) {
      if (v.sessionId !== sessionId) next[k] = v;
    }
    await saveMap(next);
  }
}
