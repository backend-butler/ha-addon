// Photo attachments in the composer. Task 19 implements this; Task 24 fixed the contract.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_IMAGES, type ImageUpload } from "../shared/transcript";

/** A photo picked but not sent yet. `previewUrl` is an object URL for the tray and the optimistic bubble. */
export interface PendingImage {
  upload: ImageUpload;
  previewUrl: string;
}

export interface Attachments {
  images: PendingImage[];
  /** Resize and encode picked files (≤1568 px, JPEG). Rejections land in `error`. */
  add: (files: FileList | File[]) => Promise<void>;
  remove: (id: string) => void;
  /** After a send: forget the pending list (object URLs stay alive for the bubble that shows them). */
  clear: () => void;
  error: string;
}

const MAX_EDGE = 1568;
const QUALITY = 0.85;

/** Scale (w, h) so the long edge is at most `max`; never upscales, never collapses an edge to 0. */
export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** 22 random chars from the ATTACHMENT_ID alphabet. crypto.randomUUID is missing over plain http, so not used. */
export function makeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return Array.from(bytes, (b) => ID_CHARS[b & 63]).join("");
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", QUALITY));
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function prepare(file: File): Promise<PendingImage> {
  const d = await decode(file);
  try {
    const { width, height } = fitSize(d.width, d.height, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(d.source, 0, 0, width, height);
    const blob = await toBlob(canvas);
    return {
      upload: { id: makeId(), mediaType: "image/jpeg", data: await toBase64(blob) },
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    d.close();
  }
}

export function useAttachments(): Attachments {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState("");
  // Mirrors the list plus photos still being encoded, so two quick picks cannot pass the cap together.
  const list = useRef<PendingImage[]>([]);
  const inflight = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const add = useCallback(async (files: FileList | File[]) => {
    const picked = Array.from(files);
    if (!picked.length) return;
    setError("");
    const photos = picked.filter((f) => f.type.startsWith("image/"));
    let msg = photos.length < picked.length ? "Only photos can be attached." : "";
    const room = Math.max(0, MAX_IMAGES - list.current.length - inflight.current);
    if (photos.length > room) msg = "Up to 4 photos per message.";
    const take = photos.slice(0, room);
    inflight.current += take.length;
    for (const file of take) {
      try {
        const img = await prepare(file);
        list.current = [...list.current, img];
        if (mounted.current) setImages(list.current);
      } catch {
        msg = "Couldn't read that photo.";
      } finally {
        inflight.current -= 1;
      }
    }
    if (msg && mounted.current) setError(msg);
  }, []);

  const remove = useCallback((id: string) => {
    const gone = list.current.find((i) => i.upload.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    list.current = list.current.filter((i) => i.upload.id !== id);
    setImages(list.current);
    setError("");
  }, []);

  const clear = useCallback(() => {
    list.current = [];
    setImages([]);
    setError("");
  }, []);

  return { images, add, remove, clear, error };
}
