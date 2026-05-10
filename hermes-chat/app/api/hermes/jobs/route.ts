import { NextResponse } from "next/server";
import { listHermesAutomations } from "@/lib/hermes-automations";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listHermesAutomations();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
