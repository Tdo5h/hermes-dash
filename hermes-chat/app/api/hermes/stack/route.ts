import { NextResponse } from "next/server";
import {
  hermesGatewayAdminFetch,
  isHermesStackModelEditsEnabled,
} from "@/lib/hermes-gateway-admin";

export const dynamic = "force-dynamic";

/**
 * GET — proxy to gateway `/api/stack/model-state` (config + presets + jobs).
 * POST — same with JSON body; requires HERMES_ALLOW_STACK_MODEL_EDITS.
 */
export async function GET() {
  try {
    const res = await hermesGatewayAdminFetch("/api/stack/model-state", {
      method: "GET",
      timeoutMs: 20_000,
    });
    const text = await res.text();
    try {
      const data = text.trim()
        ? (JSON.parse(text) as Record<string, unknown>)
        : {};
      return NextResponse.json(
        { allowEdits: isHermesStackModelEditsEnabled(), ...data },
        { status: res.ok ? 200 : res.status }
      );
    } catch {
      return NextResponse.json(
        {
          ok: false,
          allowEdits: isHermesStackModelEditsEnabled(),
          error: text.trim()
            ? `Invalid JSON from gateway: ${text.slice(0, 200)}`
            : "Empty response from gateway",
        },
        { status: 502 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        allowEdits: isHermesStackModelEditsEnabled(),
        error: `Gateway request failed: ${msg}`,
      },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  if (!isHermesStackModelEditsEnabled()) {
    return NextResponse.json(
      { error: "Set HERMES_ALLOW_STACK_MODEL_EDITS=1 on the chat service to enable writes." },
      { status: 403 }
    );
  }
  let body: unknown = {};
  try {
    const t = await req.text();
    if (t) body = JSON.parse(t) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const res = await hermesGatewayAdminFetch("/api/stack/model-state", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      timeoutMs: 45_000,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text.trim() ? (JSON.parse(text) as unknown) : {};
    } catch {
      return NextResponse.json(
        { error: "Gateway returned non-JSON", text: text.slice(0, 400) },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { ok: res.ok, data, status: res.status },
      { status: res.ok ? 200 : res.status }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `Gateway request failed: ${msg}` },
      { status: 503 }
    );
  }
}
