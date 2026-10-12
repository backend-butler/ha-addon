import { useCallback, useEffect, useRef, useState } from "react";
import { transcribe } from "./api";

export const TARGET_RATE = 16_000;
export const MAX_SECONDS = 60;

/** Average each output sample's span of input samples (a cheap low-pass), then clamp to 16-bit. */
export function toPcm16(chunks: Float32Array[], inRate: number, outRate = TARGET_RATE): Int16Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    input.set(c, off);
    off += c.length;
  }
  const ratio = inRate / outRate;
  const out = new Int16Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** The browser only exposes the mic on HTTPS (WebKit hides `mediaDevices` entirely on plain http). */
export function micAvailable(w: Pick<Window, "isSecureContext" | "navigator">): boolean {
  return w.isSecureContext && typeof w.navigator.mediaDevices?.getUserMedia === "function";
}

/** review = transcript lands in the message box; auto = the caller sends it as soon as it arrives. */
export type VoiceMode = "review" | "auto";

export type VoiceState = "idle" | "starting" | "recording" | "transcribing";

interface Rec {
  stream: MediaStream;
  ctx: AudioContext;
  node: ScriptProcessorNode;
  chunks: Float32Array[];
  timer: number;
}

/** Tap to start, tap to stop (or 60 s): the transcript goes to `onText` with the mode it was started in. */
export function useVoice(onText: (text: string, mode: VoiceMode) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const rec = useRef<Rec | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const modeRef = useRef<VoiceMode>("review");

  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return null;
    rec.current = null;
    clearInterval(r.timer);
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    return r;
  }, []);

  const stop = useCallback(async () => {
    const r = release();
    if (!r) return;
    const pcm = toPcm16(r.chunks, r.ctx.sampleRate);
    if (pcm.length < TARGET_RATE / 4) {
      setState("idle");
      setError("That was too short. Tap the mic, speak, then tap again.");
      return;
    }
    setState("transcribing");
    try {
      const { text } = await transcribe(pcm);
      if (text) onTextRef.current(text, modeRef.current);
      else setError("Didn't catch anything. Try again a little closer to the mic.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState("idle");
    }
  }, [release]);

  const start = useCallback(async () => {
    setError(null);
    setState("starting");
    // Created inside the tap: iOS only lets audio start from a user gesture.
    const ctx = new AudioContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      void ctx.close();
      setState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setDenied(true);
        setError("Microphone access was denied. Allow it for Home Assistant in your device settings to use voice.");
      } else setError(`Couldn't start the microphone: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(ctx.destination); // a processor only runs while connected; it outputs silence
    const began = Date.now();
    setSeconds(0);
    const timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop();
    }, 250);
    rec.current = { stream, ctx, node, chunks, timer };
    setState("recording");
  }, [stop]);

  // Leaving the chat (unmount) stops the mic without sending anything.
  useEffect(() => {
    return () => {
      void release();
    };
  }, [release]);

  return {
    state,
    seconds,
    error,
    denied,
    dismiss: () => setError(null),
    toggle: () => {
      if (state === "recording") void stop();
      else if (state === "idle") {
        modeRef.current = "review";
        void start();
      }
    },
    /** Start in the given mode (no-op unless idle). Must run inside a tap: the browser gates the mic on a gesture. */
    begin: (mode: VoiceMode) => {
      if (state !== "idle") return;
      modeRef.current = mode;
      void start();
    },
  };
}
