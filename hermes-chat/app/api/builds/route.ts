import { loadBuildListApps } from "@/lib/builds-manifest";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const apps = await loadBuildListApps();
    return Response.json(
      { apps },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not load builds list";
    return Response.json(
      { apps: [] as unknown[], loadError: msg },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
