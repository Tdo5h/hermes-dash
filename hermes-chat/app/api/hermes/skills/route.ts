import { NextResponse } from "next/server";
import { listHermesUserSkills } from "@/lib/hermes-user-skills";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listHermesUserSkills();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
