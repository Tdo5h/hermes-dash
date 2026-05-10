import {
  deletePublishedBuildApp,
  renamePublishedBuildApp,
} from "@/lib/builds-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_NAME_LEN = 200;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const buildId = decodeURIComponent(id).trim();
  if (!buildId) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  let body: { name?: unknown };
  try {
    body = (await req.json()) as { name?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = typeof body.name === "string" ? body.name : "";
  if (!raw.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  if (raw.length > MAX_NAME_LEN) {
    return Response.json(
      { error: `name must be at most ${MAX_NAME_LEN} characters` },
      { status: 400 }
    );
  }
  try {
    const { name } = await renamePublishedBuildApp(buildId, raw);
    return Response.json({ ok: true, name });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not rename";
    if (msg === "Build not found in manifest") {
      return Response.json({ error: msg }, { status: 404 });
    }
    if (/BUILDS_MANIFEST_PATH|not set/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const buildId = decodeURIComponent(id).trim();
  if (!buildId) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  let fallbackName: string | null = null;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      const body =
        parsed && typeof parsed === "object"
          ? (parsed as { name?: unknown })
          : {};
      fallbackName =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : null;
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await deletePublishedBuildApp(buildId, {
      name: fallbackName,
    });
    return Response.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not delete";
    if (msg === "Build not found in manifest") {
      return Response.json({ error: msg }, { status: 404 });
    }
    if (/BUILDS_MANIFEST_PATH|not set/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
