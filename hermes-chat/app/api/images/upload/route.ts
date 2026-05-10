import { saveDataUrlAsWebchatImage } from "@/lib/images";

export async function POST(req: Request) {
  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string" || !image.trim().startsWith("data:")) {
      return Response.json({ error: "Invalid image data" }, { status: 400 });
    }

    const { id, filePath } = await saveDataUrlAsWebchatImage(image);
    return Response.json({ id, url: `/api/images/${id}`, toolPath: filePath });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    console.error("[images/upload] error:", msg);
    const isUser =
      /invalid (data url|image data)/i.test(msg) ||
      msg === "Invalid data URL" ||
      msg === "Unrecognized image format";
    const userMsg =
      msg === "Unrecognized image format"
        ? "Unrecognized image format"
        : "Invalid image data";
    return Response.json(
      { error: isUser ? userMsg : "Upload failed" },
      { status: isUser ? 400 : 500 }
    );
  }
}
