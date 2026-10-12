import { randomUUID } from "node:crypto";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Emit } from "./sse.js";
import type { DiffLine } from "./yaml.js";

export interface ApprovalRequest {
  title: string;
  summary: string;
  preview: { kind: "yaml"; text: string } | { kind: "diff"; lines: DiffLine[] };
}

/** A tool that needs approval. prepare() validates and builds the preview, or returns an error for the agent. */
export interface GatedTool {
  /** Full SDK tool name, e.g. mcp__ha__upsert_automation */
  name: string;
  /**
   * The input as the tool's handler will receive it (the SDK zod-parses raw input with the tool's shape).
   * Grants are keyed on this so a stray key the parser strips cannot make an approved call miss.
   */
  normalize(input: Record<string, unknown>): unknown;
  prepare(input: Record<string, unknown>): Promise<ApprovalRequest | { error: string }>;
  /** Inputs that run without a card (call_service's everyday device control). The tool must re-check them itself. */
  autoAllow?(input: Record<string, unknown>): boolean;
}

type Decision = "allow" | "deny";

/** Pending decisions across requests: the card's POST /api/approval arrives on a different connection. */
const pending = new Map<string, (d: Decision) => void>();

export function decide(id: string, allow: boolean): boolean {
  const resolve = pending.get(id);
  if (!resolve) return false;
  resolve(allow ? "allow" : "deny");
  return true;
}

/** Stable key for a tool call, so an approval can only be spent on exactly what was shown. */
export function callKey(name: string, input: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  return `${name}:${JSON.stringify(canon(input))}`;
}

export class ApprovalGate {
  /** key → number of approved, not yet executed calls (identical parallel calls each get their own). */
  private readonly granted = new Map<string, number>();
  private readonly tools: Map<string, GatedTool>;

  constructor(
    tools: GatedTool[],
    private readonly emit: Emit,
    private readonly timeoutMs = 5 * 60_000,
  ) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  /** SDK permission callback. Non-gated tools that reach here are denied. */
  readonly canUseTool: CanUseTool = async (toolName, input, { signal, toolUseID }): Promise<PermissionResult> => {
    const tool = this.tools.get(toolName);
    if (!tool) return { behavior: "deny", message: `${toolName} is not available.` };
    if (tool.autoAllow?.(input)) return { behavior: "allow", updatedInput: input };

    const prepared = await tool.prepare(input).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    if ("error" in prepared) {
      return { behavior: "deny", message: `Not sent for approval: ${prepared.error}` };
    }

    const id = randomUUID();
    this.emit("approval", { id, toolUseId: toolUseID, ...prepared });
    const decision = await new Promise<Decision>((resolve) => {
      const finish = (d: Decision) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(d);
      };
      const timer = setTimeout(() => finish("deny"), this.timeoutMs);
      pending.set(id, finish);
      signal.addEventListener("abort", () => finish("deny"));
    });
    this.emit("approval_result", { id, allow: decision === "allow" });

    if (decision === "allow") {
      const key = callKey(toolName, tool.normalize(input));
      this.granted.set(key, (this.granted.get(key) ?? 0) + 1);
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: "The user declined this change. Ask what they would like instead." };
  };

  /** Called inside a gated tool before it writes. One approval = one execution of exactly that input. */
  consume(toolName: string, input: unknown): boolean {
    const key = callKey(toolName, input);
    const n = this.granted.get(key) ?? 0;
    if (n === 0) return false;
    if (n === 1) this.granted.delete(key);
    else this.granted.set(key, n - 1);
    return true;
  }
}
