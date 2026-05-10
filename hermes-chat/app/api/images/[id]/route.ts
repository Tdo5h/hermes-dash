import { readImage } from "@/lib/images";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let { id } = await params;
  try {
    id = decodeURIComponent(id);
  } catch {
    /* use raw */
  }
  const cut = id.search(/[?#]/);
  if (cut >= 0) id = id.slice(0, cut);

  if (!id || id.includes("..") || id.includes("/")) {
    return new Response("Not found", { status: 404 });
  }

  const result = await readImage(id);
  if (!result) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
