import { readEffectiveHermesMainModelId } from "@/lib/hermes-config";

export const dynamic = "force-dynamic";

/** Effective main LLM id: active stack preset, else `config.yaml`, else env (footer when stream model is cosmetic). */
export async function GET() {
  const model = await readEffectiveHermesMainModelId();
  return Response.json({ model });
}
