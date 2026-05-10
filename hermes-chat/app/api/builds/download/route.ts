import archiver from "archiver";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "node:stream";
import { findBuildListAppById } from "@/lib/builds-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Browsers often block file:// pages from loading sibling HTML inside an iframe (slide decks). */
const READ_ME_FIRST = `HermesChat — viewing this folder on your computer
================================================

If the main index.html shows a broken slide or "may have been moved, edited, or deleted":
  This is normal for Chrome, Edge, and most browsers when you open HTML from disk (file://).
  Decks that use an IFRAME to show each slide need a small local web server.

Do this:
  1. Fully extract this ZIP (do not open files from inside the ZIP without extracting).
  2. Run the helper script in this folder:
       Windows: double-click start-local-server.bat
       Mac/Linux: in Terminal:  sh start-local-server.sh
     (Requires Python 3, or install Python from python.org)
  3. In your browser open:
       http://127.0.0.1:8765/index.html
     (If your deck uses another entry file, open that path instead.)

To stop the server: press Ctrl+C in the terminal window.

You can also run manually from this folder:
  python3 -m http.server 8765
`;

const START_BAT = [
  "@echo off",
  "cd /d \"%~dp0\"",
  "echo.",
  "echo Serving this folder at http://127.0.0.1:8765",
  "echo Open: http://127.0.0.1:8765/index.html",
  "echo Press Ctrl+C to stop the server.",
  "echo.",
  "where py >nul 2>nul && py -m http.server 8765 && goto :eof",
  "where python >nul 2>nul && python -m http.server 8765 && goto :eof",
  "where python3 >nul 2>nul && python3 -m http.server 8765 && goto :eof",
  "echo ERROR: Python not found. Install from https://www.python.org/downloads/",
  "pause",
].join("\r\n");

const START_SH = `#!/usr/bin/env sh
cd "$(dirname "$0")"
echo ""
echo "Serving this folder at http://127.0.0.1:8765"
echo "Open: http://127.0.0.1:8765/index.html"
echo "Press Ctrl+C to stop."
echo ""
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server 8765
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server 8765
else
  echo "Install Python 3, then run: python3 -m http.server 8765"
  exit 1
fi
`;


function asciiZipBaseName(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s || "build";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) {
    return Response.json({ error: "id query required" }, { status: 400 });
  }

  const entry = await findBuildListAppById(id);
  if (!entry) {
    return Response.json({ error: "Build not found" }, { status: 404 });
  }
  if (!entry.appFolder) {
    return Response.json(
      {
        error:
          "No local project folder for this build (external URL only). Open it in the browser to save from there.",
      },
      { status: 400 }
    );
  }

  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const abs = path.resolve(root, entry.appFolder);
  const rootResolved = path.resolve(root);
  const sep = path.sep;
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    return Response.json({ error: "Invalid path" }, { status: 500 });
  }

  try {
    const st = await stat(abs);
    if (!st.isDirectory()) {
      return Response.json({ error: "Build folder missing" }, { status: 404 });
    }
  } catch {
    return Response.json({ error: "Build folder missing" }, { status: 404 });
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const zipPrefix = entry.appFolder;
  archive.directory(abs, zipPrefix);

  archive.append(READ_ME_FIRST, { name: `${zipPrefix}/READ_ME_FIRST.txt` });
  archive.append(START_BAT, { name: `${zipPrefix}/start-local-server.bat` });
  archive.append(START_SH, { name: `${zipPrefix}/start-local-server.sh` });

  const filename = `${asciiZipBaseName(entry.name)}.zip`;
  const filenameStar = encodeURIComponent(`${entry.name}.zip`);

  void archive.finalize();

  const webStream = Readable.toWeb(archive);

  return new Response(webStream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${filenameStar}`,
    },
  });
}
