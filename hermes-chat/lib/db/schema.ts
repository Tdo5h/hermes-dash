import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  uuid,
  timestamp,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const chatSessions = pgTable("chat_sessions", {
  sessionKey: text("session_key").primaryKey(),
  sessionId: text("session_id").notNull(),
  label: text("label"),
  origin: jsonb("origin"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
  chatType: text("chat_type").notNull().default("direct"),
  projectId: text("project_id"),
  projectLabel: text("project_label"),
  extra: jsonb("extra").notNull().default({}),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    sessionId: text("session_id").notNull(),
    ord: integer("ord").notNull(),
    message: jsonb("message").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.ord] }),
  })
);

export const workspaceThreadPins = pgTable("workspace_thread_pins", {
  projectSlug: text("project_slug").primaryKey(),
  pinnedSessionId: text("pinned_session_id").notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
});

export const mediaObjects = pgTable("media_objects", {
  id: text("id").primaryKey(),
  relPath: text("rel_path").notNull(),
  sha256: text("sha256"),
  mime: text("mime"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const workspaceProjects = pgTable("workspace_projects", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  treeInitialized: boolean("tree_initialized").notNull().default(false),
  /** `private` = tenant-scoped vault; `shared` = VPN-wide wiki visible to all stacks. */
  visibility: text("visibility").notNull().default("private"),
  /** When `HERMES_CHAT_TENANT_ID` is set, private rows match this tenant; shared rows use null. */
  tenantId: text("tenant_id"),
});

export const vaultAssets = pgTable(
  "vault_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectSlug: text("project_slug").notNull(),
    relativePath: text("relative_path").notNull(),
    fileName: text("file_name").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    /** Upload intent: vault knowledge, layout template, or org-wide library (see ingest-message). */
    assetRole: text("asset_role"),
    /** When uploading into org-global, workspace slug the user uploaded from (LOG provenance). */
    contextProjectSlug: text("context_project_slug"),
  },
  (t) => ({
    uniq: uniqueIndex("vault_assets_slug_path").on(t.projectSlug, t.relativePath),
  })
);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  result: jsonb("result"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Wiki / extracted markdown mirrored in Postgres (survives vault FS permission issues).
 * Canonical source of truth for Q&A in HermesChat v1 is still disk: INDEX.md, SCHEMA.md,
 * wiki/ — do not let mirrors diverge (see `llm-wiki-conventions.ts`).
 */
export const workspaceKnowledgeDocs = pgTable(
  "workspace_knowledge_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectSlug: text("project_slug").notNull(),
    docPath: text("doc_path").notNull(),
    content: text("content").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("workspace_knowledge_docs_slug_path").on(t.projectSlug, t.docPath),
  })
);

/** Bounded auto-retry + circuit breaker for shared vault source→extracted gaps (Postgres only). */
export const vaultIngestAutoState = pgTable(
  "vault_ingest_auto_state",
  {
    projectSlug: text("project_slug").notNull(),
    sourceRelativePath: text("source_relative_path").notNull(),
    autoAttemptCount: integer("auto_attempt_count").notNull().default(0),
    lastAutoAttemptAt: bigint("last_auto_attempt_at", { mode: "number" }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    pausedUntil: bigint("paused_until", { mode: "number" }),
    lastError: text("last_error"),
    logLineAppendedAt: bigint("log_line_appended_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectSlug, t.sourceRelativePath] }),
  })
);
