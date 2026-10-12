import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { query, type CanUseTool, type McpServerConfig, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ImageType } from "../shared/transcript.js";
import type { Config } from "./config.js";
import type { Emit } from "./sse.js";

export interface RunOptions {
  /** A plain string for text-only turns; one user message (image blocks + text) when photos are attached. */
  prompt: string | AsyncIterable<SDKUserMessage>;
  systemPrompt: string;
  resume?: string;
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: string[];
  canUseTool?: CanUseTool;
  signal?: AbortSignal;
}

export interface RunResult {
  sessionId?: string;
  ok: boolean;
}

export const NO_KEY_MESSAGE =
  "No Anthropic API key is configured. Set it in Settings → Apps → Backend Butler → Configuration.";

/**
 * Run one agent turn and translate SDK messages into UI events:
 *   text {delta} · tool {id,name,input} · tool_result {id,isError,text} · done {sessionId,costUsd} · error {message}
 */
export async function runAgent(config: Config, opts: RunOptions, emit: Emit): Promise<RunResult> {
  const apiKey = config.apiKey();
  if (!apiKey) {
    emit("error", { message: NO_KEY_MESSAGE });
    return { ok: false };
  }
  const claudeDir = join(config.dataDir, "claude");
  const workDir = join(config.dataDir, "workspace");
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  syncSkills(claudeDir, [config.bundledSkillsDir, join(config.configDir, "skills")]);

  const abortController = new AbortController();
  opts.signal?.addEventListener("abort", () => abortController.abort());

  let sessionId: string | undefined;
  let ok = false;
  try {
    const stream = query({
      prompt: opts.prompt,
      options: {
        model: config.model,
        systemPrompt: opts.systemPrompt,
        resume: opts.resume,
        // Only Skill, which loads a SKILL.md body into the conversation. No Bash, Read, Write, WebFetch, …: the agent
        // has no file access, so bundled skills are self-contained.
        tools: ["Skill"],
        mcpServers: opts.mcpServers,
        allowedTools: opts.allowedTools,
        canUseTool: opts.canUseTool,
        // Must be explicit: when omitted the SDK starts in "auto" mode, where a model classifier approves
        // tool calls itself and canUseTool (our approval card) is only asked when it is unsure.
        permissionMode: "default",
        // "user" = CLAUDE_CONFIG_DIR, which the app owns: it only holds the skills link (no settings, no CLAUDE.md).
        // Needed for skill discovery; [] finds none (Task 14 spike). Skills are instructions only: tools stay [].
        settingSources: ["user"],
        skills: "all",
        includePartialMessages: true,
        maxTurns: 25,
        cwd: workDir,
        abortController,
        // `env` replaces the child's environment entirely.
        env: {
          PATH: process.env.PATH,
          HOME: config.dataDir,
          ANTHROPIC_API_KEY: apiKey,
          CLAUDE_CONFIG_DIR: claudeDir,
          CLAUDE_AGENT_SDK_CLIENT_APP: "backend-butler/0.1.0",
          DISABLE_AUTOUPDATER: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        stderr: (line) => console.error("[claude]", line.trimEnd()),
      },
    });
    for await (const msg of stream) {
      sessionId = msg.session_id ?? sessionId;
      ok = translate(msg, emit) ?? ok;
    }
  } catch (err) {
    emit("error", { message: err instanceof Error ? err.message : String(err) });
    ok = false;
  }
  return { sessionId, ok };
}

/** Emit UI events for one SDK message. Returns true/false on a result message. */
export function translate(msg: SDKMessage, emit: Emit): boolean | undefined {
  switch (msg.type) {
    case "stream_event": {
      const ev = msg.event;
      if (msg.parent_tool_use_id === null && ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        emit("text", { delta: ev.delta.text });
      }
      return undefined;
    }
    case "assistant": {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") emit("tool", { id: block.id, name: block.name, input: block.input });
      }
      return undefined;
    }
    case "user": {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const text = typeof block.content === "string"
              ? block.content
              : (block.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
            emit("tool_result", { id: block.tool_use_id, isError: Boolean(block.is_error), text });
          }
        }
      }
      return undefined;
    }
    case "result": {
      if (msg.subtype === "success" && !msg.is_error) {
        emit("done", { sessionId: msg.session_id, costUsd: msg.total_cost_usd });
        return true;
      }
      const errors = "errors" in msg ? msg.errors : [];
      const message = errors?.length ? errors.join("; ") : "result" in msg ? String(msg.result) : msg.subtype;
      emit("error", { message });
      emit("done", { sessionId: msg.session_id, costUsd: msg.total_cost_usd });
      return false;
    }
    default:
      return undefined;
  }
}

/**
 * The SDK finds skills at CLAUDE_CONFIG_DIR/skills/<name>. Link every skill from `roots` there, later roots
 * overriding earlier ones (bundled first, then the user's folder), and drop links to skills that are gone.
 */
export function syncSkills(claudeDir: string, roots: string[]): void {
  const dir = join(claudeDir, "skills");
  // Before bundled skills, this was one link to the user's folder.
  if (isLink(dir)) rmSync(dir);
  mkdirSync(dir, { recursive: true });
  const wanted = new Map<string, string>();
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) if (existsSync(join(root, name, "SKILL.md"))) wanted.set(name, join(root, name));
  }
  for (const name of readdirSync(dir)) if (!wanted.has(name)) rmSync(join(dir, name), { recursive: true, force: true });
  for (const [name, target] of wanted) {
    const link = join(dir, name);
    if (isLink(link)) rmSync(link);
    symlinkSync(target, link, "dir");
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** A single-message prompt stream: image blocks first, then the text. Yields once and returns, which ends the input. */
export async function* imagePrompt(images: { mediaType: ImageType; data: string }[], text: string): AsyncGenerator<SDKUserMessage> {
  const content = [
    ...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })),
    { type: "text" as const, text },
  ];
  yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}
