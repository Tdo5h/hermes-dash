import Link from "next/link";
import { BuildFrameViewer } from "@/components/BuildFrameViewer";
import { findBuildListAppById } from "@/lib/builds-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BuildOpenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await findBuildListAppById(decodeURIComponent(id));

  if (!app) {
    return (
      <main className="flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)] p-4 text-foreground">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-lg font-semibold">Build not found</h1>
          <p className="text-sm text-muted-foreground">
            Hermes could not find this creation in the published builds list.
          </p>
          <Link
            href="/chat/builds"
            className="neu-raised inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium text-sidebar-foreground"
          >
            Back to creations
          </Link>
        </div>
      </main>
    );
  }

  const frameFile = app.emailHtmlUrl ? "email.html" : "index.html";
  const frameUrl = app.appFolder
    ? `/api/builds/static/${encodeURIComponent(app.id)}/${frameFile}?v=${encodeURIComponent(
        String(Math.round(app.updatedAt ?? app.createdAt ?? Date.now()))
      )}`
    : app.openUrl;

  return (
    <BuildFrameViewer
      buildId={app.id}
      name={app.name}
      frameUrl={frameUrl}
      openUrl={app.emailHtmlUrl ?? app.openUrl}
      emailComposeUrl={app.emailHtmlUrl ? "#send-email" : undefined}
      downloadUrl={
        app.appFolder
          ? `/api/builds/download?id=${encodeURIComponent(app.id)}`
          : undefined
      }
    />
  );
}
