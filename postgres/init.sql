-- HermesChat shared state (init runs once per empty Postgres data dir)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE chat_sessions (
  session_key text PRIMARY KEY,
  session_id text NOT NULL,
  label text,
  origin jsonb,
  updated_at bigint NOT NULL DEFAULT 0,
  chat_type text NOT NULL DEFAULT 'direct',
  project_id text,
  project_label text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_chat_sessions_session_id ON chat_sessions (session_id);

CREATE TABLE chat_messages (
  session_id text NOT NULL,
  ord integer NOT NULL,
  message jsonb NOT NULL,
  PRIMARY KEY (session_id, ord)
);

CREATE TABLE workspace_thread_pins (
  project_slug text PRIMARY KEY,
  pinned_session_id text NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  p256dh text NOT NULL,
  auth text NOT NULL
);

CREATE TABLE media_objects (
  id text PRIMARY KEY,
  rel_path text NOT NULL,
  sha256 text,
  mime text,
  size_bytes bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);

CREATE TABLE workspace_projects (
  slug text PRIMARY KEY,
  name text NOT NULL,
  created_at bigint NOT NULL,
  tree_initialized boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'private',
  tenant_id text
);

CREATE TABLE vault_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug text NOT NULL,
  relative_path text NOT NULL,
  file_name text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at bigint NOT NULL,
  asset_role text,
  context_project_slug text,
  UNIQUE (project_slug, relative_path)
);
CREATE INDEX idx_vault_assets_project ON vault_assets (project_slug);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  result jsonb,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_status_created ON jobs (status, created_at);

CREATE TABLE workspace_knowledge_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug text NOT NULL,
  doc_path text NOT NULL,
  content text NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (project_slug, doc_path)
);
CREATE INDEX idx_workspace_knowledge_docs_project ON workspace_knowledge_docs (project_slug);

CREATE TABLE vault_ingest_auto_state (
  project_slug text NOT NULL,
  source_relative_path text NOT NULL,
  auto_attempt_count integer NOT NULL DEFAULT 0,
  last_auto_attempt_at bigint,
  consecutive_failures integer NOT NULL DEFAULT 0,
  paused_until bigint,
  last_error text,
  log_line_appended_at bigint,
  updated_at bigint NOT NULL,
  PRIMARY KEY (project_slug, source_relative_path)
);
CREATE INDEX idx_vault_ingest_auto_state_project ON vault_ingest_auto_state (project_slug);
