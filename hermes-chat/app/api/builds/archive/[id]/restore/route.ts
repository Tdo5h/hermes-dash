import { restoreArchivedBuildApp } from "@/lib/builds-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorStatus(message: string): number {
  if (/not found|missing/i.test(message)) return 404;
  if (/already|invalid/i.test(message)) return 400;
  if (/BUILDS_MANIFEST_PATH|not set/i.test(message)) return 503;
  return 500;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const buildId = decodeURIComponent(id).trim();
  if (!buildId) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  try {
    const app = await restoreArchivedBuildApp(buildId);
    return Response.json({ ok: true, app });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not restore";
    return Response.json({ error: msg }, { status: errorStatus(msg) });
  }
}
