import { useState } from "react";

import type { Approval } from "../shared/transcript";

export function ApprovalCard({ approval }: { approval: Approval }) {
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const waiting = approval.allowed === undefined;

  async function decide(allow: boolean) {
    setSending(true);
    setErr("");
    try {
      const r = await fetch("api/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: approval.id, allow }),
      });
      if (!r.ok) setErr(r.status === 404 ? "This request expired." : `Failed (${r.status})`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSending(false);
    }
  }

  const p = approval.preview;
  return (
    <div role="group" aria-label={approval.title} className={`approval ${waiting ? "approval-waiting" : approval.allowed ? "approval-allowed" : "approval-denied"}`}>
      <div className="approval-head">
        <strong>{approval.title}</strong>
        {!waiting && <span className="approval-badge">{approval.allowed ? "Approved" : "Declined"}</span>}
      </div>
      <p className="approval-summary">{approval.summary}</p>
      <pre className="approval-preview">
        {p.kind === "yaml"
          ? p.text
          : p.lines.map((l, i) => (
              <span key={i} className={l.op === "+" ? "diff-add" : l.op === "-" ? "diff-del" : undefined}>
                {l.op} {l.text}
                {"\n"}
              </span>
            ))}
      </pre>
      {waiting && (
        <div className="approval-actions">
          <button className="ghost" disabled={sending} onClick={() => void decide(false)}>
            Deny
          </button>
          <button className="primary" disabled={sending} onClick={() => void decide(true)}>
            Approve
          </button>
        </div>
      )}
      {err && (
        <div className="msg-error" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}
