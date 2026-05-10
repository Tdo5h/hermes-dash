import {
  listCreatePatterns,
  saveCreatePattern,
} from "@/lib/create-patterns";
import { parseCreateProductionBrief } from "@/lib/create-production-types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const outputId = url.searchParams.get("outputId")?.trim() || undefined;
  try {
    const patterns = await listCreatePatterns(outputId);
    return Response.json({ patterns });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not load Create patterns";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: {
    name?: unknown;
    createBrief?: unknown;
    persist?: unknown;
    resultNotes?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const createBrief = parseCreateProductionBrief(body.createBrief);
  if (!createBrief) {
    return Response.json({ error: "createBrief required" }, { status: 400 });
  }
  try {
    const pattern = await saveCreatePattern({
      createBrief,
      ...(body.persist ? { persist: body.persist } : {}),
      ...(typeof body.name === "string" && body.name.trim()
        ? { name: body.name.trim() }
        : {}),
      ...(typeof body.resultNotes === "string" && body.resultNotes.trim()
        ? { resultNotes: body.resultNotes.trim() }
        : {}),
    });
    return Response.json({ pattern });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not save Create pattern";
    return Response.json({ error: msg }, { status: 500 });
  }
}
