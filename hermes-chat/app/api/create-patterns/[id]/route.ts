import { deleteCreatePattern } from "@/lib/create-patterns";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const clean = id.trim();
  if (!clean) return Response.json({ error: "id required" }, { status: 400 });
  try {
    const deleted = await deleteCreatePattern(clean);
    if (!deleted) return Response.json({ error: "Pattern not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not delete Create pattern";
    return Response.json({ error: msg }, { status: 500 });
  }
}
