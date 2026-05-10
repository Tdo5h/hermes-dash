import { NextResponse } from "next/server";

import { getHermesSetupStatus } from "@/lib/setup-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getHermesSetupStatus());
}
