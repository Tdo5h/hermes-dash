import { buildHermesIdentityPayload } from "@/lib/hermes-identity-files";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(buildHermesIdentityPayload());
}
