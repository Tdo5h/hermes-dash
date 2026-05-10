/**
 * One-time import from JSON session files into Postgres when tables are empty.
 * Run from container entrypoint when DATABASE_URL is set.
 */
import fs from "fs";
import path from "path";
import pg from "pg";

const { Client } = pg;

async function main() {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) process.exit(0);

  const dataDir = process.env.HERMES_CHAT_DATA_DIR?.trim() || "/var/hermes-chat";
  const sessionsPath = path.join(dataDir, "sessions.json");
  const messagesDir = path.join(dataDir, "messages");
  const threadsPath = path.join(dataDir, "workspace-threads.json");
  const pushPath = path.join(dataDir, "push-subscriptions.json");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query(
      `ALTER TABLE workspace_projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'`
    );
    await client.query(
      `ALTER TABLE workspace_projects ADD COLUMN IF NOT EXISTS tenant_id text`
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS vault_ingest_auto_state (
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
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_vault_ingest_auto_state_project ON vault_ingest_auto_state (project_slug)`
    );

    const c = await client.query("SELECT COUNT(*)::int AS n FROM chat_sessions");
    if ((c.rows[0]?.n ?? 0) > 0) {
      return;
    }

    if (!fs.existsSync(sessionsPath)) {
      return;
    }

    const store = JSON.parse(fs.readFile(sessionsPath, "utf-8"));
    for (const [sessionKey, val] of Object.entries(store)) {
      const v = val || {};
      const sessionId =
        (typeof v.sessionId === "string" && v.sessionId) ||
        (sessionKey.includes("webchat:")
          ? sessionKey.slice(sessionKey.lastIndexOf("webchat:") + 8)
          : sessionKey);
      await client.query(
        `INSERT INTO chat_sessions (session_key, session_id, label, origin, updated_at, chat_type, project_id, project_label, extra)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (session_key) DO NOTHING`,
        [
          sessionKey,
          sessionId,
          v.label ?? null,
          v.origin != null ? JSON.stringify(v.origin) : null,
          typeof v.updatedAt === "number" ? v.updatedAt : 0,
          typeof v.chatType === "string" ? v.chatType : "direct",
          v.projectId ?? null,
          v.projectLabel ?? null,
          JSON.stringify({}),
        ]
      );

      const msgPath = path.join(messagesDir, `${sessionId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
      if (fs.existsSync(msgPath)) {
        try {
          const mf = JSON.parse(fs.readFile(msgPath, "utf-8"));
          const arr = mf.messages;
          if (Array.isArray(arr)) {
            let ord = 0;
            for (const m of arr) {
              await client.query(
                `INSERT INTO chat_messages (session_id, ord, message) VALUES ($1,$2,$3::jsonb)
                 ON CONFLICT (session_id, ord) DO NOTHING`,
                [sessionId, ord, JSON.stringify(m)]
              );
              ord += 1;
            }
          }
        } catch {
          /* skip transcript */
        }
      }
    }

    if (fs.existsSync(threadsPath)) {
      const pins = JSON.parse(fs.readFile(threadsPath, "utf-8"));
      for (const [slug, row] of Object.entries(pins)) {
        const sid = row?.sessionId;
        if (typeof sid === "string" && sid) {
          await client.query(
            `INSERT INTO workspace_thread_pins (project_slug, pinned_session_id) VALUES ($1,$2) ON CONFLICT (project_slug) DO NOTHING`,
            [slug, sid]
          );
        }
      }
    }

    if (fs.existsSync(pushPath)) {
      const subs = JSON.parse(fs.readFile(pushPath, "utf-8"));
      if (Array.isArray(subs)) {
        for (const s of subs) {
          if (s?.endpoint && s.keys?.p256dh && s.keys?.auth) {
            await client.query(
              `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [s.endpoint, s.keys.p256dh, s.keys.auth]
            );
          }
        }
      }
    }

    const vaultRoot = process.env.HERMES_PROJECTS_FS_ROOT?.trim();
    if (vaultRoot && fs.existsSync(vaultRoot)) {
      const wc = await client.query("SELECT COUNT(*)::int AS n FROM workspace_projects");
      if ((wc.rows[0]?.n ?? 0) === 0) {
        for (const name of fs.readdirSync(vaultRoot)) {
          if (name.startsWith(".")) continue;
          const pj = path.join(vaultRoot, name, "project.json");
          if (fs.existsSync(pj)) {
            try {
              const j = JSON.parse(fs.readFile(pj, "utf-8"));
              const vis =
                j.visibility === "shared" ? "shared" : "private";
              await client.query(
                `INSERT INTO workspace_projects (slug, name, created_at, tree_initialized, visibility, tenant_id)
                 VALUES ($1,$2,$3,true,$4,null) ON CONFLICT (slug) DO NOTHING`,
                [
                  j.slug || name,
                  j.name || name,
                  typeof j.createdAt === "number" ? j.createdAt : Date.now(),
                  vis,
                ]
              );
            } catch {
              /* skip */
            }
          }
        }
      }
    }

    console.log("[pg-bootstrap] imported sessions from filesystem");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[pg-bootstrap]", e);
  process.exit(1);
});
