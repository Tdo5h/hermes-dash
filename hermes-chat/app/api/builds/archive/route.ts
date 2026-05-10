import {
  archivePublishedBuildApp,
  listArchivedBuildApps,
} from "@/lib/builds-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorStatus(message: string): number {
  if (/not found|missing/i.test(message)) return 404;
  if (/already|no local folder|invalid/i.test(message)) return 400;
  if (/BUILDS_MANIFEST_PATH|not set/i.test(message)) return 503;
  return 500;
}

export async function GET() {
  try {
    const apps = await listArchivedBuildApps();
    return Response.json({ apps });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not load archive";
    return Response.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = (await req.json()) as { id?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  try {
    const app = await archivePublishedBuildApp(id);
    return Response.json({ ok: true, app });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not archive";
    return Response.json({ error: msg }, { status: errorStatus(msg) });
  }
}
