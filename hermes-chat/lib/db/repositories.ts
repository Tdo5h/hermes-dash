import { eq, notInArray, sql, desc, and, or, isNull } from "drizzle-orm";
import { getDb } from "./client";
import {
  chatSessions,
  chatMessages,
  workspaceThreadPins,
  pushSubscriptions,
  mediaObjects,
  workspaceProjects,
  vaultAssets,
  jobs,
  workspaceKnowledgeDocs,
  vaultIngestAutoState,
} from "./schema";
import type { ChatMessage } from "@/lib/sessions";

function mapStoreEntryToRow(sessionKey: string, val: unknown) {
  const v = (val || {}) as Record<string, unknown>;
  const sessionId =
    (typeof v.sessionId === "string" && v.sessionId) ||
    (sessionKey.includes("webchat:")
      ? sessionKey.slice(sessionKey.lastIndexOf("webchat:") + 8)
      : sessionKey);
  return {
    sessionKey,
    sessionId,
    label: typeof v.label === "string" ? v.label : null,
    origin: v.origin != null ? v.origin : null,
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
    chatType: typeof v.chatType === "string" ? v.chatType : "direct",
    projectId: typeof v.projectId === "string" ? v.projectId : null,
    projectLabel: typeof v.projectLabel === "string" ? v.projectLabel : null,
    extra: (() => {
      const known = new Set([
        "sessionId",
        "label",
        "origin",
        "updatedAt",
        "chatType",
        "projectId",
        "projectLabel",
      ]);
      const extra: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (!known.has(k)) extra[k] = x;
      }
      return extra;
    })(),
  };
}

function rowToStoreEntry(row: typeof chatSessions.$inferSelect): unknown {
  const base: Record<string, unknown> = {
    sessionId: row.sessionId,
    ...(row.label != null ? { label: row.label } : {}),
    ...(row.origin != null ? { origin: row.origin } : {}),
    updatedAt: row.updatedAt,
    chatType: row.chatType,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.projectLabel ? { projectLabel: row.projectLabel } : {}),
    ...((row.extra as Record<string, unknown>) || {}),
  };
  return base;
}

export async function readSessionsStoreDb(): Promise<Record<string, unknown>> {
  const db = getDb()!;
  const rows = await db.select().from(chatSessions);
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    out[r.sessionKey] = rowToStoreEntry(r);
  }
  return out;
}

export async function writeSessionsStoreDb(store: Record<string, unknown>): Promise<void> {
  const db = getDb()!;
  const keys = Object.keys(store);
  await db.transaction(async (tx) => {
    if (keys.length === 0) {
      await tx.delete(chatSessions);
      return;
    }
    await tx.delete(chatSessions).where(notInArray(chatSessions.sessionKey, keys));
    for (const [key, val] of Object.entries(store)) {
      const row = mapStoreEntryToRow(key, val);
      await tx
        .insert(chatSessions)
        .values(row)
        .onConflictDoUpdate({
          target: chatSessions.sessionKey,
          set: {
            sessionId: row.sessionId,
            label: row.label,
            origin: row.origin,
            updatedAt: row.updatedAt,
            chatType: row.chatType,
            projectId: row.projectId,
            projectLabel: row.projectLabel,
            extra: row.extra,
          },
        });
    }
  });
}

export async function loadSessionMessagesDb(sessionId: string): Promise<ChatMessage[]> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.ord);
  return rows.map((r) => r.message as ChatMessage);
}

export async function deleteChatMessagesForSessionId(sessionId: string): Promise<void> {
  const db = getDb()!;
  await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
}

export async function saveSessionMessagesDb(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  const db = getDb()!;
  await db.transaction(async (tx) => {
    await tx.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    let ord = 0;
    for (const m of messages) {
      await tx.insert(chatMessages).values({
        sessionId,
        ord,
        message: m as object,
      });
      ord += 1;
    }
  });
}

export async function sessionHasMessagesDb(sessionId: string): Promise<boolean> {
  const db = getDb()!;
  const row = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId));
  return (row[0]?.c ?? 0) > 0;
}

export async function searchMessagesContainDb(
  sessionId: string,
  needle: string
): Promise<boolean> {
  const msgs = await loadSessionMessagesDb(sessionId);
  const n = needle.toLowerCase();
  for (const m of msgs) {
    if (JSON.stringify(m).toLowerCase().includes(n)) return true;
  }
  return false;
}

export async function loadWorkspaceThreadMapDb(): Promise<
  Record<string, { sessionId: string }>
> {
  const db = getDb()!;
  const rows = await db.select().from(workspaceThreadPins);
  const out: Record<string, { sessionId: string }> = {};
  for (const r of rows) {
    out[r.projectSlug] = { sessionId: r.pinnedSessionId };
  }
  return out;
}

/** Replace entire pin map (matches JSON file write semantics). */
export async function replaceWorkspaceThreadMapDb(
  m: Record<string, { sessionId: string }>
): Promise<void> {
  const db = getDb()!;
  const keys = Object.keys(m);
  await db.transaction(async (tx) => {
    if (keys.length === 0) {
      await tx.delete(workspaceThreadPins);
      return;
    }
    await tx
      .delete(workspaceThreadPins)
      .where(notInArray(workspaceThreadPins.projectSlug, keys));
    for (const [slug, v] of Object.entries(m)) {
      await tx
        .insert(workspaceThreadPins)
        .values({ projectSlug: slug, pinnedSessionId: v.sessionId })
        .onConflictDoUpdate({
          target: workspaceThreadPins.projectSlug,
          set: { pinnedSessionId: v.sessionId },
        });
    }
  });
}

export async function listPushSubscriptionsDb(): Promise<
  { endpoint: string; keys: { p256dh: string; auth: string } }[]
> {
  const db = getDb()!;
  const rows = await db.select().from(pushSubscriptions);
  return rows.map((r) => ({
    endpoint: r.endpoint,
    keys: { p256dh: r.p256dh, auth: r.auth },
  }));
}

export async function addPushSubscriptionDb(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  const db = getDb()!;
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    })
    .onConflictDoNothing();
}

export async function removePushSubscriptionDb(endpoint: string): Promise<void> {
  const db = getDb()!;
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function insertMediaObjectDb(row: {
  id: string;
  relPath: string;
  sha256: string | null;
  mime: string | null;
  sizeBytes: number;
  createdAt: number;
}): Promise<void> {
  const db = getDb()!;
  await db
    .insert(mediaObjects)
    .values({
      id: row.id,
      relPath: row.relPath,
      sha256: row.sha256,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
    })
    .onConflictDoUpdate({
      target: mediaObjects.id,
      set: {
        relPath: row.relPath,
        sha256: row.sha256,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt,
      },
    });
}

export async function getMediaObjectDb(
  id: string
): Promise<typeof mediaObjects.$inferSelect | null> {
  const db = getDb()!;
  const rows = await db.select().from(mediaObjects).where(eq(mediaObjects.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function deleteMediaObjectById(id: string): Promise<void> {
  const db = getDb()!;
  await db.delete(mediaObjects).where(eq(mediaObjects.id, id));
}

export async function insertJobDb(
  type: string,
  payload: Record<string, unknown>
): Promise<string> {
  const db = getDb()!;
  const rows = await db.insert(jobs).values({ type, payload }).returning({ id: jobs.id });
  return rows[0]!.id;
}

export async function waitForJobDb(
  jobId: string,
  timeoutMs = 90_000
): Promise<Record<string, unknown> | null> {
  const db = getDb()!;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const st = rows[0]?.status;
    if (st === "completed") {
      const r = rows[0]?.result;
      return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    }
    if (st === "failed") {
      throw new Error(rows[0]?.error || "Bridge job failed");
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Bridge job timed out");
}

function currentTenantId(): string | null {
  const t = process.env.HERMES_CHAT_TENANT_ID?.trim();
  return t || null;
}

export async function listWorkspaceProjectsDb(): Promise<
  {
    slug: string;
    name: string;
    createdAt: number;
    visibility: "private" | "shared";
    tenantId: string | null;
  }[]
> {
  const db = getDb()!;
  const tenant = currentTenantId();
  const rows = tenant
    ? await db
        .select()
        .from(workspaceProjects)
        .where(
          or(
            eq(workspaceProjects.visibility, "shared"),
            eq(workspaceProjects.tenantId, tenant),
            isNull(workspaceProjects.tenantId)
          )
        )
        .orderBy(desc(workspaceProjects.createdAt))
    : await db
        .select()
        .from(workspaceProjects)
        .orderBy(desc(workspaceProjects.createdAt));
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    createdAt: r.createdAt,
    visibility: r.visibility === "shared" ? "shared" : "private",
    tenantId: r.tenantId ?? null,
  }));
}

/** Shared workspaces only (for Hermes prompt: extra readable slugs). */
export async function listSharedWorkspaceProjectsDb(): Promise<
  { slug: string; name: string }[]
> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(workspaceProjects)
    .where(eq(workspaceProjects.visibility, "shared"))
    .orderBy(desc(workspaceProjects.createdAt));
  return rows.map((r) => ({ slug: r.slug, name: r.name }));
}

export async function getWorkspaceProjectDb(
  slug: string
): Promise<{
  slug: string;
  name: string;
  createdAt: number;
  visibility: "private" | "shared";
  tenantId: string | null;
} | null> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(workspaceProjects)
    .where(eq(workspaceProjects.slug, slug))
    .limit(1);
  if (!rows[0]) return null;
  return {
    slug: rows[0].slug,
    name: rows[0].name,
    createdAt: rows[0].createdAt,
    visibility: rows[0].visibility === "shared" ? "shared" : "private",
    tenantId: rows[0].tenantId ?? null,
  };
}

export async function insertWorkspaceProjectDb(row: {
  slug: string;
  name: string;
  createdAt: number;
  treeInitialized: boolean;
  visibility: "private" | "shared";
  tenantId: string | null;
}): Promise<void> {
  const db = getDb()!;
  await db.insert(workspaceProjects).values({
    slug: row.slug,
    name: row.name,
    createdAt: row.createdAt,
    treeInitialized: row.treeInitialized,
    visibility: row.visibility,
    tenantId: row.tenantId,
  });
}

export async function updateWorkspaceProjectNameDb(
  slug: string,
  name: string
): Promise<void> {
  const db = getDb()!;
  await db
    .update(workspaceProjects)
    .set({ name })
    .where(eq(workspaceProjects.slug, slug));
}

export async function deleteWorkspaceProjectDb(slug: string): Promise<void> {
  const db = getDb()!;
  await db
    .delete(workspaceKnowledgeDocs)
    .where(eq(workspaceKnowledgeDocs.projectSlug, slug));
  await db.delete(vaultAssets).where(eq(vaultAssets.projectSlug, slug));
  await db
    .delete(vaultIngestAutoState)
    .where(eq(vaultIngestAutoState.projectSlug, slug));
  await db
    .delete(workspaceThreadPins)
    .where(eq(workspaceThreadPins.projectSlug, slug));
  await db.delete(workspaceProjects).where(eq(workspaceProjects.slug, slug));
}

export async function upsertWorkspaceKnowledgeDocDb(row: {
  projectSlug: string;
  docPath: string;
  content: string;
  updatedAt: number;
}): Promise<void> {
  const db = getDb()!;
  await db
    .insert(workspaceKnowledgeDocs)
    .values({
      projectSlug: row.projectSlug,
      docPath: row.docPath,
      content: row.content,
      updatedAt: row.updatedAt,
    })
    .onConflictDoUpdate({
      target: [workspaceKnowledgeDocs.projectSlug, workspaceKnowledgeDocs.docPath],
      set: {
        content: row.content,
        updatedAt: row.updatedAt,
      },
    });
}

export async function listWorkspaceKnowledgeDocsDb(projectSlug: string): Promise<
  { docPath: string; content: string; updatedAt: number }[]
> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(workspaceKnowledgeDocs)
    .where(eq(workspaceKnowledgeDocs.projectSlug, projectSlug))
    .orderBy(workspaceKnowledgeDocs.docPath);
  return rows.map((r) => ({
    docPath: r.docPath,
    content: r.content,
    updatedAt: r.updatedAt,
  }));
}

export async function getWorkspaceKnowledgeDocDb(
  projectSlug: string,
  docPath: string
): Promise<{ docPath: string; content: string; updatedAt: number } | null> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(workspaceKnowledgeDocs)
    .where(
      and(eq(workspaceKnowledgeDocs.projectSlug, projectSlug), eq(workspaceKnowledgeDocs.docPath, docPath))
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { docPath: r.docPath, content: r.content, updatedAt: r.updatedAt };
}

export async function listVaultAssetsDb(projectSlug: string): Promise<
  {
    name: string;
    relativePath: string;
    size: number;
    sha256?: string;
    assetRole: string | null;
  }[]
> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(vaultAssets)
    .where(
      and(eq(vaultAssets.projectSlug, projectSlug), eq(vaultAssets.status, "materialized"))
    )
    .orderBy(vaultAssets.fileName);
  return rows.map((r) => ({
    name: r.fileName,
    relativePath: r.relativePath,
    size: Number(r.sizeBytes),
    sha256: r.sha256,
    assetRole:
      typeof r.assetRole === "string" && r.assetRole.trim()
        ? r.assetRole.trim()
        : null,
  }));
}

/** `asset_role` for a materialized source, if Postgres-backed. */
export async function getVaultAssetRoleByPathDb(
  projectSlug: string,
  relativePath: string
): Promise<string | null> {
  const db = getDb()!;
  const rows = await db
    .select({ assetRole: vaultAssets.assetRole })
    .from(vaultAssets)
    .where(
      and(
        eq(vaultAssets.projectSlug, projectSlug),
        eq(vaultAssets.relativePath, relativePath),
        eq(vaultAssets.status, "materialized")
      )
    )
    .limit(1);
  const r = rows[0]?.assetRole;
  return typeof r === "string" && r.trim() ? r.trim() : null;
}

export type VaultIngestAutoStateRow = {
  projectSlug: string;
  sourceRelativePath: string;
  autoAttemptCount: number;
  lastAutoAttemptAt: number | null;
  consecutiveFailures: number;
  pausedUntil: number | null;
  lastError: string | null;
  logLineAppendedAt: number | null;
  updatedAt: number;
};

export async function getVaultIngestAutoStateDb(
  projectSlug: string,
  sourceRelativePath: string
): Promise<VaultIngestAutoStateRow | null> {
  const db = getDb()!;
  const rows = await db
    .select()
    .from(vaultIngestAutoState)
    .where(
      and(
        eq(vaultIngestAutoState.projectSlug, projectSlug),
        eq(vaultIngestAutoState.sourceRelativePath, sourceRelativePath)
      )
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    projectSlug: r.projectSlug,
    sourceRelativePath: r.sourceRelativePath,
    autoAttemptCount: r.autoAttemptCount,
    lastAutoAttemptAt: r.lastAutoAttemptAt ?? null,
    consecutiveFailures: r.consecutiveFailures,
    pausedUntil: r.pausedUntil ?? null,
    lastError: r.lastError ?? null,
    logLineAppendedAt: r.logLineAppendedAt ?? null,
    updatedAt: r.updatedAt,
  };
}

export async function resetVaultIngestAfterSuccessDb(
  projectSlug: string,
  sourceRelativePath: string,
  now: number
): Promise<void> {
  const db = getDb()!;
  await db
    .insert(vaultIngestAutoState)
    .values({
      projectSlug,
      sourceRelativePath,
      autoAttemptCount: 0,
      lastAutoAttemptAt: null,
      consecutiveFailures: 0,
      pausedUntil: null,
      lastError: null,
      logLineAppendedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [vaultIngestAutoState.projectSlug, vaultIngestAutoState.sourceRelativePath],
      set: {
        autoAttemptCount: 0,
        consecutiveFailures: 0,
        lastError: null,
        pausedUntil: null,
        updatedAt: now,
      },
    });
}

export async function recordVaultIngestFailureCircuitDb(
  projectSlug: string,
  sourceRelativePath: string,
  errMsg: string,
  circuitMaxFailures: number,
  pauseMs: number,
  now: number
): Promise<void> {
  const db = getDb()!;
  const existing = await getVaultIngestAutoStateDb(projectSlug, sourceRelativePath);
  const nextFail = (existing?.consecutiveFailures ?? 0) + 1;
  const shouldPause =
    circuitMaxFailures > 0 && nextFail >= circuitMaxFailures;
  const pauseUntil = shouldPause ? now + pauseMs : existing?.pausedUntil ?? null;
  await db
    .insert(vaultIngestAutoState)
    .values({
      projectSlug,
      sourceRelativePath,
      autoAttemptCount: existing?.autoAttemptCount ?? 0,
      lastAutoAttemptAt: existing?.lastAutoAttemptAt ?? null,
      consecutiveFailures: nextFail,
      pausedUntil: pauseUntil,
      lastError: errMsg.slice(0, 500),
      logLineAppendedAt: existing?.logLineAppendedAt ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [vaultIngestAutoState.projectSlug, vaultIngestAutoState.sourceRelativePath],
      set: {
        consecutiveFailures: nextFail,
        pausedUntil: pauseUntil,
        lastError: errMsg.slice(0, 500),
        updatedAt: now,
      },
    });
}

/** Bump auto-attempt counter after scheduling an automatic re-ingest. */
export async function bumpVaultIngestAutoAttemptDb(
  projectSlug: string,
  sourceRelativePath: string,
  now: number
): Promise<void> {
  const db = getDb()!;
  const existing = await getVaultIngestAutoStateDb(projectSlug, sourceRelativePath);
  const nextCount = (existing?.autoAttemptCount ?? 0) + 1;
  await db
    .insert(vaultIngestAutoState)
    .values({
      projectSlug,
      sourceRelativePath,
      autoAttemptCount: nextCount,
      lastAutoAttemptAt: now,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      pausedUntil: existing?.pausedUntil ?? null,
      lastError: existing?.lastError ?? null,
      logLineAppendedAt: existing?.logLineAppendedAt ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [vaultIngestAutoState.projectSlug, vaultIngestAutoState.sourceRelativePath],
      set: {
        autoAttemptCount: sql`${vaultIngestAutoState.autoAttemptCount} + 1`,
        lastAutoAttemptAt: now,
        updatedAt: now,
      },
    });
}

export async function markVaultIngestLogAppendedDb(
  projectSlug: string,
  sourceRelativePath: string,
  now: number
): Promise<void> {
  const db = getDb()!;
  await db
    .insert(vaultIngestAutoState)
    .values({
      projectSlug,
      sourceRelativePath,
      autoAttemptCount: 0,
      lastAutoAttemptAt: null,
      consecutiveFailures: 0,
      pausedUntil: null,
      lastError: null,
      logLineAppendedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [vaultIngestAutoState.projectSlug, vaultIngestAutoState.sourceRelativePath],
      set: {
        logLineAppendedAt: now,
        updatedAt: now,
      },
    });
}

/** Manual Re-ingest: allow auto-retry + architect again after circuit pause. */
export async function clearVaultIngestPauseForManualDb(
  projectSlug: string,
  sourceRelativePath: string,
  now: number
): Promise<void> {
  const db = getDb()!;
  await db
    .insert(vaultIngestAutoState)
    .values({
      projectSlug,
      sourceRelativePath,
      autoAttemptCount: 0,
      lastAutoAttemptAt: null,
      consecutiveFailures: 0,
      pausedUntil: null,
      lastError: null,
      logLineAppendedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [vaultIngestAutoState.projectSlug, vaultIngestAutoState.sourceRelativePath],
      set: {
        autoAttemptCount: 0,
        lastAutoAttemptAt: null,
        consecutiveFailures: 0,
        pausedUntil: null,
        lastError: null,
        logLineAppendedAt: null,
        updatedAt: now,
      },
    });
}

export async function pruneOrphanSessionsDb(
  maxAgeMs: number,
  now: number
): Promise<void> {
  const db = getDb()!;
  const cutoff = now - maxAgeMs;
  const oldRows = await db
    .select()
    .from(chatSessions)
    .where(sql`${chatSessions.updatedAt} < ${cutoff}`);
  for (const r of oldRows) {
    const hasMsg = await sessionHasMessagesDb(r.sessionId);
    const hasLabel = Boolean(r.label?.trim());
    if (!hasMsg || !hasLabel) {
      await db.delete(chatSessions).where(eq(chatSessions.sessionKey, r.sessionKey));
    }
  }
}
