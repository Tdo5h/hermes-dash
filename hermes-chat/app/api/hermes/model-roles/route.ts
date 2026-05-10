import { getHermesModelRolesPayload } from "@/lib/hermes-model-roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getHermesModelRolesPayload();
  return Response.json(payload);
}
