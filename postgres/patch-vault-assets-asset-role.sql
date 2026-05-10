-- Run once on existing Postgres volumes that predate asset_role / context_project_slug.
-- Or: from repo root, ./scripts/apply-vault-assets-patch.sh [--rebuild]
ALTER TABLE vault_assets ADD COLUMN IF NOT EXISTS asset_role text;
ALTER TABLE vault_assets ADD COLUMN IF NOT EXISTS context_project_slug text;
