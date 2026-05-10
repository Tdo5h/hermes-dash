import { writeFile, readFile, mkdir, unlink } from "fs/promises";
import path from "path";
import crypto, { createHash } from "crypto";
import { getHermesChatDataDir } from "@/lib/hermes-config";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  insertMediaObjectDb,
  getMediaObjectDb,
  deleteMediaObjectById,
} from "@/lib/db/repositories";

/** Uploaded chat images: same base as session files (`HERMES_CHAT_DATA_DIR`), so Docker’s `nextjs` user can write (not `~/.openclaw/…`, which breaks when HOME is `/nonexistent`). */
function mediaDir(): string {
  return path.join(getHermesChatDataDir(), "media", "webchat");
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/jfif": "jpg",
  "image/png": "png",
  "image/x-png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "image/x-tiff": "tiff",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfi: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  ico: "image/x-icon",
  cur: "image/x-icon",
};

async function recordWebchatMedia(
  id: string,
  filePath: string,
  buf: Buffer,
  mime: string | null
): Promise<void> {
  if (!shouldUseChatDatabase()) return;
  const rel = path.relative(getHermesChatDataDir(), filePath).replace(/\\/g, "/");
  await insertMediaObjectDb({
    id,
    relPath: rel,
    sha256: createHash("sha256").update(buf).digest("hex"),
    mime,
    sizeBytes: buf.length,
    createdAt: Date.now(),
  });
}

export function imageIdToPath(id: string): string {
  return path.join(mediaDir(), id);
}

/** Best-effort delete of a webchat upload (file on disk + DB row when enabled). */
export async function deleteWebchatImageById(id: string): Promise<void> {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) return;
  if (shouldUseChatDatabase()) {
    const row = await getMediaObjectDb(id);
    if (row) {
      const full = path.join(getHermesChatDataDir(), row.relPath);
      await unlink(full).catch(() => {});
      await deleteMediaObjectById(id);
    } else {
      await unlink(imageIdToPath(id)).catch(() => {});
    }
    return;
  }
  await unlink(imageIdToPath(id)).catch(() => {});
}

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] || "application/octet-stream";
}

export async function saveBase64Image(dataUrl: string): Promise<{ id: string; filePath: string }> {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("Invalid data URL");

  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  const buf = Buffer.from(base64, "base64");
  if (!buf.length) throw new Error("Invalid image data");

  const ext = MIME_TO_EXT[mime] || sniffImageExt(buf);
  if (!ext) throw new Error("Unrecognized image format");

  const dir = mediaDir();
  const id = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(dir, id);

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, buf);
  await recordWebchatMedia(id, filePath, buf, mime);

  return { id, filePath };
}

/**
 * Persist a browser FileReader data URL: normal `data:image/...` or opaque `data:application/octet-stream`
 * / `data:;base64,...` when the OS leaves `File.type` empty (common on some pickers).
 */
export async function saveDataUrlAsWebchatImage(
  dataUrl: string
): Promise<{ id: string; filePath: string }> {
  const trimmed = dataUrl.trim();
  if (/^data:image\//i.test(trimmed)) {
    return saveBase64Image(trimmed);
  }
  const m = trimmed.match(/^data:([^;,]*);base64,([\s\S]+)$/i);
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1].trim().toLowerCase();
  const b64 = m[2].replace(/\s/g, "");
  if (mime.startsWith("image/")) {
    return saveBase64Image(trimmed);
  }
  if (mime !== "" && mime !== "application/octet-stream") {
    throw new Error("Invalid image data");
  }
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw new Error("Invalid image data");
  return saveBufferAsWebchatImage(buf, null);
}

export async function readImage(id: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const ext = path.extname(id).slice(1);
  if (shouldUseChatDatabase()) {
    const row = await getMediaObjectDb(id);
    if (row) {
      const full = path.join(getHermesChatDataDir(), row.relPath);
      try {
        const buffer = await readFile(full);
        const mime =
          row.mime?.split(";")[0]?.trim().toLowerCase() || mimeForExt(ext);
        return { buffer, mime };
      } catch {
        /* fall through to path by id */
      }
    }
  }
  const filePath = path.join(mediaDir(), id);
  try {
    const buffer = await readFile(filePath);
    return { buffer, mime: mimeForExt(ext) };
  } catch {
    return null;
  }
}

/** Persist remote image bytes under `media/webchat` (same as uploads). */
export async function saveBufferAsWebchatImage(
  buffer: Buffer,
  contentType: string | null
): Promise<{ id: string; filePath: string }> {
  const rawMime = contentType?.split(";")[0]?.trim().toLowerCase() || "";
  const fromMime = rawMime ? MIME_TO_EXT[rawMime] : undefined;
  const fromSniff = sniffImageExt(buffer);
  const ext = fromMime || fromSniff;
  if (!ext) {
    throw new Error("Unrecognized image format");
  }
  const dir = mediaDir();
  const id = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(dir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, buffer);
  const mimeStored = rawMime || mimeForExt(ext);
  await recordWebchatMedia(id, filePath, buffer, mimeStored || null);
  return { id, filePath };
}

function sniffImageExt(buf: Buffer): string | null {
  if (buf.length >= 4) {
    const head = buf.subarray(0, Math.min(buf.length, 256)).toString("utf8").trimStart();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
      return "svg";
    }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "png";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "webp";

  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";

  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a))
  ) {
    return "tiff";
  }

  if (
    buf.length >= 6 &&
    buf[0] === 0x00 &&
    buf[1] === 0x00 &&
    (buf[2] === 0x01 || buf[2] === 0x02) &&
    buf[3] === 0x00
  ) {
    return "ico";
  }

  const iso = sniffIsobmffImageExt(buf);
  if (iso) return iso;

  return null;
}

/** AVIF / HEIC (ISO BMFF): `ftyp` box at offset 4. */
function sniffIsobmffImageExt(buf: Buffer): string | null {
  if (buf.length < 32) return null;
  if (
    buf[4] !== 0x66 ||
    buf[5] !== 0x74 ||
    buf[6] !== 0x79 ||
    buf[7] !== 0x70
  ) {
    return null;
  }
  const brand = buf.subarray(8, 12).toString("ascii").toLowerCase();
  if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
  if (
    brand.startsWith("heic") ||
    brand.startsWith("heix") ||
    brand.startsWith("hevc") ||
    brand.startsWith("hevx") ||
    brand.startsWith("mif1") ||
    brand.startsWith("msf1")
  ) {
    return "heic";
  }
  return null;
}
