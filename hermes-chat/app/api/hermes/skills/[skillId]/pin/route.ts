import { NextResponse } from "next/server";
import { setHermesUserSkillPinned } from "@/lib/hermes-user-skills";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ skillId: string }> }
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const pinned = (body as { pinned?: unknown })?.pinned;
  if (typeof pinned !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "`pinned` must be true or false." },
      { status: 400 }
    );
  }
  const { skillId } = await params;
  const result = await setHermesUserSkillPinned(skillId, pinned);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
