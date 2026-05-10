import { getAgentDisplayName } from "@/lib/agent-display-name";

export async function GET() {
  return Response.json({ name: getAgentDisplayName() });
}
