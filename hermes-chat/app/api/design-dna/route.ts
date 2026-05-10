import { listOpenDesignDna } from "@/lib/open-design-dna";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const designDna = await listOpenDesignDna();
    return Response.json({ designDna });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
