import { NextResponse } from "next/server";
import { deleteHermesUserSkill } from "@/lib/hermes-user-skills";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ skillId: string }> }
) {
  const { skillId } = await params;
  const result = await deleteHermesUserSkill(skillId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
