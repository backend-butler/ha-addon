import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { ATTACHMENT_ID, IMAGE_TYPES, MAX_IMAGES, type ImageType, type ImageUpload } from "../shared/transcript.js";
import type { Config } from "./config.js";
import { sendJson } from "./http.js";

/** Anthropic's per-image cap. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Room for MAX_IMAGES base64 images (+33%) plus the message, for readJson. */
export const MAX_BODY_BYTES = Math.ceil((MAX_IMAGES * MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;

const EXT: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const TYPE_BY_EXT: Record<string, ImageType> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const CHAT_ID = /^[0-9a-f-]{36}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function attachmentsDir(dataDir: string): string {
  return join(dataDir, "attachments");
}

/** The first problem with an images field, or null if it is fine. `images` is untrusted JSON. */
export function validateImages(images: unknown): string | null {
  if (images === undefined) return null;
  if (!Array.isArray(images)) return "images must be a list";
  if (images.length > MAX_IMAGES) return `at most ${MAX_IMAGES} photos per message`;
  const seen = new Set<string>();
  for (const img of images as Partial<ImageUpload>[]) {
    if (!img || typeof img !== "object") return "each image must be an object";
    if (!IMAGE_TYPES.includes(img.mediaType as ImageType)) return "photos must be JPEG, PNG or WebP";
    if (typeof img.id !== "string" || !ATTACHMENT_ID.test(img.id)) return "invalid photo id";
    if (seen.has(img.id)) return "duplicate photo id";
    seen.add(img.id);
    const data = img.data;
    if (typeof data !== "string" || data.length % 4 !== 0 || !BASE64.test(data)) return "photo data must be base64";
    const bytes = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (bytes > MAX_IMAGE_BYTES) return "a photo is larger than 5 MB";
    if (bytes === 0) return "a photo is empty";
  }
  return null;
}

/** Does the file start like the type it claims? The declared media type alone proves nothing. */
export function looksLike(type: ImageType, bytes: Buffer): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
}

/** The first image whose bytes do not match its declared type, as an error for the client; null if all match. */
export function checkImageBytes(images: ImageUpload[]): string | null {
  for (const img of images) if (!looksLike(img.mediaType, Buffer.from(img.data.slice(0, 24), "base64"))) return "a photo is not a valid JPEG, PNG or WebP file";
  return null;
}

/** Write validated images to <dataDir>/attachments/<chatId>/<id>.<ext>. Never replaces a stored photo. */
export function saveImages(dataDir: string, chatId: string, images: ImageUpload[]): void {
  if (!images.length) return;
  const dir = join(attachmentsDir(dataDir), chatId);
  mkdirSync(dir, { recursive: true });
  for (const img of images) {
    try {
      writeFileSync(join(dir, `${img.id}.${EXT[img.mediaType]}`), Buffer.from(img.data, "base64"), { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; // ids are random UUIDs: a clash is a replay, keep the first
    }
  }
}

/** GET /api/chats/:id/attachments/:attachmentId → the stored photo (ids validated: no path tricks). */
export function handleAttachment(config: Config, chatId: string, attachmentId: string, res: ServerResponse): void {
  const notFound = () => sendJson(res, 404, { error: "not found" });
  if (!CHAT_ID.test(chatId) || !ATTACHMENT_ID.test(attachmentId)) return notFound();
  // Only chats that exist: a draft that never got saved has no attachments to show.
  if (!existsSync(join(config.dataDir, "chats", `${chatId}.json`))) return notFound();
  for (const [ext, type] of Object.entries(TYPE_BY_EXT)) {
    const file = join(attachmentsDir(config.dataDir), chatId, `${attachmentId}.${ext}`);
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    res.writeHead(200, {
      "content-type": type,
      "content-length": size,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "content-disposition": "inline",
    });
    const stream = createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return;
  }
  notFound();
}
