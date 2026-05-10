-- Apply manually if Postgres already initialized: docker exec -i hermes-postgres psql -U hermeschat -d hermeschat < postgres/migrations/02_workspace_knowledge_docs.sql

CREATE TABLE IF NOT EXISTS workspace_knowledge_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug text NOT NULL,
  doc_path text NOT NULL,
  content text NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (project_slug, doc_path)
);
CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_docs_project ON workspace_knowledge_docs (project_slug);
