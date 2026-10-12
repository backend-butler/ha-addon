import { describe, expect, it } from "vitest";
import { pickPipeline, transcribe, type Pipeline } from "../../server/stt";

const P = (id: string, stt_engine: string | null): Pipeline => ({ id, name: id, stt_engine });

describe("pickPipeline", () => {
  const list = [P("local", "stt.faster_whisper"), P("g", "stt.google_ai_stt"), P("o", "stt.openai_stt"), P("none", null)];
  it("auto keeps the preferred pipeline when its engine is a cloud one", () => {
    expect(pickPipeline("auto", list, "g")?.id).toBe("g");
  });
  it("auto otherwise takes OpenAI, then Google AI, then ElevenLabs", () => {
    expect(pickPipeline("auto", list, "local")?.id).toBe("o");
    expect(pickPipeline("auto", [P("l", "stt.faster_whisper"), P("e", "stt.elevenlabs"), P("g", "stt.google_ai_stt")], "l")?.id).toBe("g");
  });
  it("auto falls back to the preferred pipeline, then any with an engine, then null", () => {
    expect(pickPipeline("auto", [P("a", "stt.whisper"), P("b", "stt.vosk")], "b")?.id).toBe("b");
    expect(pickPipeline("auto", [P("a", "stt.whisper")], null)?.id).toBe("a");
    expect(pickPipeline("auto", [P("x", null)], "x")).toBeNull();
  });
  it("an id selects that pipeline or nothing", () => {
    expect(pickPipeline("local", list, "o")?.id).toBe("local");
    expect(pickPipeline("missing", list, "o")).toBeNull();
  });
});

/** Scripted stand-in for HA's websocket. */
class FakeWs {
  sent: unknown[] = [];
  binaryType = "";
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(private script: (msg: any, ws: FakeWs) => void) {
    queueMicrotask(() => this.emit({ type: "auth_required" }));
  }
  emit(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  send(data: string | Uint8Array) {
    this.sent.push(data);
    if (typeof data === "string") this.script(JSON.parse(data), this);
    else this.script({ binary: data }, this);
  }
  close() {}
}

const config: any = { ha: { baseUrl: "http://supervisor/core", token: () => "t" }, sttPipeline: "auto" };

function haScript(onRun: (ws: FakeWs, frames: Uint8Array[]) => void) {
  const frames: Uint8Array[] = [];
  return (msg: any, ws: FakeWs) => {
    if (msg.type === "auth") ws.emit({ type: "auth_ok" });
    else if (msg.type === "assist_pipeline/pipeline/list")
      ws.emit({ id: msg.id, type: "result", success: true, result: { pipelines: [P("homer", "stt.openai_stt")], preferred_pipeline: "homer" } });
    else if (msg.type === "assist_pipeline/run") {
      expect(msg).toMatchObject({ pipeline: "homer", start_stage: "stt", end_stage: "stt", input: { sample_rate: 16000, no_vad: true } });
      ws.emit({ id: msg.id, type: "result", success: true, result: null });
      ws.emit({ id: msg.id, type: "event", event: { type: "run-start", data: { runner_data: { stt_binary_handler_id: 7 } } } });
    } else if (msg.binary) {
      frames.push(msg.binary);
      if (msg.binary.length === 1) onRun(ws, frames);
    }
  };
}

describe("transcribe", () => {
  it("streams the audio in handler-prefixed frames, ends with an empty frame, and returns stt-end text", async () => {
    let frames: Uint8Array[] = [];
    const audio = Buffer.alloc(20_000, 1);
    const text = await transcribe(config, audio, () =>
      new FakeWs(haScript((ws, f) => {
        frames = f;
        ws.emit({ id: 2, type: "event", event: { type: "stt-end", data: { stt_output: { text: " Turn on the lamp. " } } } });
      })) as never,
    );
    expect(text).toBe("Turn on the lamp.");
    expect(frames.every((f) => f[0] === 7)).toBe(true);
    expect(frames.slice(0, -1).reduce((n, f) => n + f.length - 1, 0)).toBe(audio.length);
    expect(frames.at(-1)!.length).toBe(1);
  });
  it("surfaces HA's pipeline error message", async () => {
    await expect(
      transcribe(config, Buffer.alloc(100), () =>
        new FakeWs(haScript((ws) => ws.emit({ id: 2, type: "event", event: { type: "error", data: { code: "stt-stream-failed", message: "Speech-to-text failed" } } }))) as never,
      ),
    ).rejects.toThrow("Speech-to-text failed");
  });
});
