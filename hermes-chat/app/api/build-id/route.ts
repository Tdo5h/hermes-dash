import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

async function readNextBuildIdFromDisk(): Promise<string> {
  try {
    const raw = await readFile(join(process.cwd(), ".next/BUILD_ID"), "utf-8");
    return raw.trim();
  } catch {
    return "";
  }
}

/**
 * Prefer NEXT_PUBLIC_APP_BUILD_ID (Docker/CI); else Next's `.next/BUILD_ID` so
 * BuildVersionSync can detect deploys even when the env var is unset.
 */
export async function GET() {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_BUILD_ID ?? "").trim();
  const buildId = fromEnv || (await readNextBuildIdFromDisk());
  return Response.json(
    { buildId },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
