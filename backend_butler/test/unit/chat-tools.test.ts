import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: any[] = [];
vi.mock("@anthropic-ai/claude-agent-sdk", async (orig) => {
  const real = await orig<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...real,
    query: (args: any) => {
      captured.push(args.options);
      return (async function* () {})();
    },
  };
});

const { runAgent } = await import("../../server/agent");
const { buildTools } = await import("../../server/chat");

const config: any = { dataDir: "/tmp/bb-test", configDir: "/tmp/bb-test-config", bundledSkillsDir: "/tmp/bb-test-bundled", model: "m", apiKey: () => "k" };

describe("agent tool surface", () => {
  beforeEach(() => (captured.length = 0));

  it("disables every built-in Claude Code tool and reads settings only from the app-owned config dir", async () => {
    process.env.SUPERVISOR_TOKEN = "supervisor-secret";
    await runAgent(config, { prompt: "hi", systemPrompt: "s" }, () => {});
    // Skill only: loads a SKILL.md body into the conversation. No Read/Bash/Write/WebFetch: no file access.
    expect(captured[0].tools).toEqual(["Skill"]);
    // "user" = CLAUDE_CONFIG_DIR, which lives in the app's data dir and only holds the skills link.
    expect(captured[0].settingSources).toEqual(["user"]);
    expect(captured[0].env.CLAUDE_CONFIG_DIR).toBe("/tmp/bb-test/claude");
    expect(captured[0].skills).toBe("all");
    // Omitted → "auto": a classifier approves writes and the approval card is skipped.
    expect(captured[0].permissionMode).toBe("default");
    expect(captured[0].env.ANTHROPIC_API_KEY).toBe("k");
    delete process.env.SUPERVISOR_TOKEN;
    expect(Object.keys(captured[0].env)).not.toContain("SUPERVISOR_TOKEN");
    expect(Object.values(captured[0].env)).not.toContain("supervisor-secret");
  });

  it("auto-allows only the ha read tools and loading a skill; call_service goes through the gate", () => {
    const { autoAllowed } = buildTools({ config, ha: {} as any, cache: {} as any, store: {} as any });
    expect(autoAllowed.sort()).toEqual(
      ["Skill", "mcp__ha__find_entities", "mcp__ha__get_automation", "mcp__ha__get_states", "mcp__ha__list_automations"],
    );
  });
});

describe("gated tool registration", () => {
  it("registers automation and script writes, none of them auto-allowed", async () => {
    const { buildTools: build } = await import("../../server/chat");
    const { server, autoAllowed } = build({ config, ha: {} as any, cache: {} as any, store: {} as any });
    // Private MCP SDK field; if it disappears this fails loudly rather than skipping.
    const names = Object.keys((server.instance as any)._registeredTools ?? {});
    expect(names.length).toBe(9);
    for (const n of ["upsert_automation", "delete_automation", "upsert_script", "delete_script"]) {
      expect(names).toContain(n);
      expect(autoAllowed).not.toContain(`mcp__ha__${n}`);
    }
  });
});
