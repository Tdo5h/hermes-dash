import { NextResponse } from "next/server";
import { authorizeHermesGatewayToken } from "@/lib/internal-gateway-auth";
import { getDb } from "@/lib/db/client";
import {
  getWorkspaceProjectDb,
  upsertWorkspaceKnowledgeDocDb,
  listWorkspaceKnowledgeDocsDb,
  getWorkspaceKnowledgeDocDb,
} from "@/lib/db/repositories";
import {
  normalizeProjectSlug,
  normalizeWorkspaceKnowledgePath,
} from "@/lib/workspace-knowledge-path";

export async function GET(req: Request) {
  if (!authorizeHermesGatewayToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!getDb()) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const slug = normalizeProjectSlug(url.searchParams.get("projectSlug") ?? "");
  if (!slug) {
    return NextResponse.json({ error: "projectSlug required" }, { status: 400 });
  }
  const proj = await getWorkspaceProjectDb(slug);
  if (!proj) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  const docPathRaw = url.searchParams.get("docPath")?.trim() ?? "";
  if (docPathRaw) {
    const docPath = normalizeWorkspaceKnowledgePath(docPathRaw);
    if (!docPath) {
      return NextResponse.json({ error: "invalid docPath" }, { status: 400 });
    }
    const row = await getWorkspaceKnowledgeDocDb(slug, docPath);
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      projectSlug: slug,
      docPath: row.docPath,
      content: row.content,
      updatedAt: row.updatedAt,
    });
  }

  const rows = await listWorkspaceKnowledgeDocsDb(slug);
  return NextResponse.json({
    projectSlug: slug,
    documents: rows.map((r) => ({
      docPath: r.docPath,
      updatedAt: r.updatedAt,
      contentLength: r.content.length,
    })),
  });
}

export async function POST(req: Request) {
  if (!authorizeHermesGatewayToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!getDb()) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const slug = normalizeProjectSlug(String(o.projectSlug ?? ""));
  const docPath = normalizeWorkspaceKnowledgePath(String(o.docPath ?? ""));
  const content = typeof o.content === "string" ? o.content : "";

  if (!slug || !docPath) {
    return NextResponse.json({ error: "projectSlug and docPath required" }, { status: 400 });
  }
  const proj = await getWorkspaceProjectDb(slug);
  if (!proj) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  await upsertWorkspaceKnowledgeDocDb({
    projectSlug: slug,
    docPath,
    content,
    updatedAt: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    projectSlug: slug,
    docPath,
    contentLength: content.length,
    updatedAt: Date.now(),
  });
}
