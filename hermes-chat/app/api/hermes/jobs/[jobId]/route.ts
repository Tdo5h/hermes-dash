import { NextResponse } from "next/server";
import {
  hermesGatewayAdminFetch,
  isHermesStackModelEditsEnabled,
} from "@/lib/hermes-gateway-admin";

export const dynamic = "force-dynamic";

const JOB_ID_RE = /^[a-f0-9]{12}$/;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  if (!isHermesStackModelEditsEnabled()) {
    return NextResponse.json(
      { error: "Set HERMES_ALLOW_STACK_MODEL_EDITS=1 to enable job updates." },
      { status: 403 }
    );
  }
  const { jobId } = await params;
  if (!jobId || !JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const res = await hermesGatewayAdminFetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      timeoutMs: 30_000,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text.trim() ? (JSON.parse(text) as unknown) : {};
    } catch {
      return NextResponse.json(
        { error: "Non-JSON from gateway", text: text.slice(0, 300) },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Gateway request failed: ${msg}` },
      { status: 503 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  if (!isHermesStackModelEditsEnabled()) {
    return NextResponse.json(
      { error: "Set HERMES_ALLOW_STACK_MODEL_EDITS=1 to enable job deletes." },
      { status: 403 }
    );
  }
  const { jobId } = await params;
  if (!jobId || !JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  try {
    const res = await hermesGatewayAdminFetch(`/api/jobs/${jobId}`, {
      method: "DELETE",
      timeoutMs: 30_000,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text.trim() ? (JSON.parse(text) as unknown) : { ok: res.ok };
    } catch {
      return NextResponse.json(
        { error: "Non-JSON from gateway", text: text.slice(0, 300) },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Gateway request failed: ${msg}` },
      { status: 503 }
    );
  }
}
