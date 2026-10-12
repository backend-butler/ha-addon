import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { wsUrl } from "./ha/client.js";
import { HaError } from "./ha/errors.js";
import { sendJson } from "./http.js";

/** 16 kHz mono 16-bit PCM: 32 000 bytes a second, so 4 MB ≈ 2 minutes (the mic stops at 60 s). */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const SAMPLE_RATE = 16_000;
/** Frames HA receives: one handler byte plus up to this much audio. */
const CHUNK_BYTES = 8_000;
const STT_TIMEOUT_MS = 30_000;

export interface Pipeline {
  id: string;
  name: string;
  stt_engine: string | null;
}

/** Cloud engines that transcribe well, best first (spike 2026-10-07: OpenAI 1.7 s, Google AI 1.2 s). */
const CLOUD_ENGINES = [/openai/i, /google/i, /elevenlabs/i];
const rank = (engine: string | null) => (engine ? CLOUD_ENGINES.findIndex((re) => re.test(engine)) : -1);

/**
 * `auto`: the preferred pipeline if its engine is a cloud one, else the first pipeline using OpenAI → Google AI →
 * ElevenLabs, else the preferred one. Anything else is a pipeline id. null = no pipeline can transcribe.
 */
export function pickPipeline(setting: string, pipelines: Pipeline[], preferred: string | null): Pipeline | null {
  if (setting && setting !== "auto") return pipelines.find((p) => p.id === setting) ?? null;
  const usable = pipelines.filter((p) => p.stt_engine);
  const pref = usable.find((p) => p.id === preferred);
  if (pref && rank(pref.stt_engine) >= 0) return pref;
  for (let i = 0; i < CLOUD_ENGINES.length; i++) {
    const hit = usable.find((p) => rank(p.stt_engine) === i);
    if (hit) return hit;
  }
  return pref ?? usable[0] ?? null;
}

/** Read the whole body before answering: replying early makes HA's ingress proxy return a 502. */
async function readAudio(req: IncomingMessage): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_AUDIO_BYTES) chunks.push(chunk as Buffer);
  }
  return size > MAX_AUDIO_BYTES ? "too-large" : Buffer.concat(chunks);
}

export async function handleStt(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const audio = await readAudio(req);
  if (audio === "too-large") return sendJson(res, 400, { error: "recording is too long" });
  if (audio.length < 2 || audio.length % 2) return sendJson(res, 400, { error: "no audio received" });
  try {
    const text = await transcribe(config, audio);
    sendJson(res, 200, { text });
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** One short-lived HA WebSocket: pick the pipeline, run its STT stage on the audio, return the text. */
export function transcribe(config: Config, audio: Buffer, open = (url: string) => new WebSocket(url)): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ws = open(wsUrl(config.ha.baseUrl));
    ws.binaryType = "arraybuffer";
    let done = false;
    const finish = (err: Error | null, text = "") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve(text);
    };
    const timer = setTimeout(() => finish(new HaError("Home Assistant speech-to-text timed out")), STT_TIMEOUT_MS);
    const send = (msg: Record<string, unknown>) => ws.send(JSON.stringify(msg));

    ws.onerror = () => finish(new HaError("could not reach Home Assistant for speech-to-text"));
    ws.onclose = () => finish(new HaError("Home Assistant closed the speech-to-text connection"));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === "auth_required") send({ type: "auth", access_token: config.ha.token() });
      else if (m.type === "auth_invalid") finish(new HaError(`HA websocket auth failed: ${m.message ?? "invalid token"}`));
      else if (m.type === "auth_ok") send({ id: 1, type: "assist_pipeline/pipeline/list" });
      else if (m.type === "result" && !m.success) finish(new HaError(m.error?.message ?? "speech-to-text failed"));
      else if (m.type === "result" && m.id === 1) {
        const list = m.result as { pipelines: Pipeline[]; preferred_pipeline: string | null };
        const pipeline = pickPipeline(config.sttPipeline, list.pipelines, list.preferred_pipeline);
        if (!pipeline)
          return finish(new HaError(
            config.sttPipeline === "auto"
              ? "No Assist pipeline has a speech-to-text engine. Add one in Settings → Voice assistants."
              : `No Assist pipeline with id "${config.sttPipeline}" (the stt_pipeline option).`,
          ));
        send({
          id: 2,
          type: "assist_pipeline/run",
          start_stage: "stt",
          end_stage: "stt",
          pipeline: pipeline.id,
          // Tap-to-stop decides the end, so HA must not cut the recording at the first pause.
          input: { sample_rate: SAMPLE_RATE, no_vad: true },
        });
      } else if (m.type === "event" && m.id === 2) {
        const { type, data } = m.event as { type: string; data?: any };
        if (type === "run-start") {
          const handler = data?.runner_data?.stt_binary_handler_id as number;
          for (let i = 0; i < audio.length; i += CHUNK_BYTES) ws.send(frame(handler, audio.subarray(i, i + CHUNK_BYTES)));
          ws.send(frame(handler)); // empty frame = end of audio
        } else if (type === "stt-end") finish(null, String(data?.stt_output?.text ?? "").trim());
        else if (type === "error") finish(new HaError(data?.message ?? data?.code ?? "speech-to-text failed"));
      }
    };
  });
}

function frame(handler: number, chunk: Buffer = Buffer.alloc(0)): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunk.length + 1);
  out[0] = handler;
  out.set(chunk, 1);
  return out;
}
