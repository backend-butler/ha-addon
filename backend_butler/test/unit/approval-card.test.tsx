import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalCard } from "../../web/ApprovalCard";

describe("ApprovalCard", () => {
  it("shows the YAML in full next to the outline, never behind a toggle: the outline reads only the top level", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard
        approval={{
          id: "a",
          title: "Create automation “Evening”",
          summary: "Adds a new automation and reloads automations.",
          preview: { kind: "yaml", text: "then:\n  - action: lock.unlock\n" },
          outline: [{ label: "Then", items: ["Run steps only if a condition holds"] }],
        }}
      />,
    );
    expect(html).toContain("Run steps only if a condition holds");
    expect(html).toMatch(/<pre class="approval-preview">[^<]*lock\.unlock/);
    expect(html).not.toContain("<details");
  });
});
