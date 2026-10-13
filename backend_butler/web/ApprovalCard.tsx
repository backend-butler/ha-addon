import { useId, useState } from "react";

import type { Approval } from "../shared/transcript";

const EXPIRED = "Butler stopped waiting for this answer. Ask it to prepare the change again.";
const UNREACHABLE = "Couldn't send your answer. Check your connection, then try again.";

export function ApprovalCard({ approval }: { approval: Approval }) {
  const [sending, setSending] = useState<"allow" | "deny" | null>(null);
  const [err, setErr] = useState("");
  const ids = useId();
  const waiting = approval.allowed === undefined;
  const outline = approval.outline?.filter((s) => s.items.length) ?? [];

  async function decide(allow: boolean) {
    setSending(allow ? "allow" : "deny");
    setErr("");
    try {
      const r = await fetch("api/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: approval.id, allow }),
      });
      if (!r.ok) setErr(r.status === 404 ? EXPIRED : `Butler couldn't record your answer (error ${r.status}). Try again.`);
    } catch {
      setErr(UNREACHABLE);
    } finally {
      setSending(null);
    }
  }

  const p = approval.preview;
  const code = (
    <pre className="approval-preview">
      {p.kind === "yaml"
        ? p.text
        : p.lines.map((l, i) => (
            <span key={i} className={l.op === "+" ? "diff-add" : l.op === "-" ? "diff-del" : "diff-same"}>
              <span className="diff-op" aria-hidden="true">
                {l.op === " " ? "" : l.op === "+" ? "+" : "−"}
              </span>
              {l.op !== " " && <span className="visually-hidden">{l.op === "+" ? "added: " : "removed: "}</span>}
              {l.text}
              {"\n"}
            </span>
          ))}
    </pre>
  );

  const state = waiting ? "approval-waiting" : approval.allowed ? "approval-allowed" : "approval-denied";
  return (
    <section aria-labelledby={`${ids}-t`} aria-describedby={`${ids}-s`} className={`approval ${state}`}>
      <div className="approval-head">
        <h3 id={`${ids}-t`}>{approval.title}</h3>
        {!waiting && <span className="approval-badge">{approval.allowed ? "Approved" : "Declined"}</span>}
      </div>
      <p id={`${ids}-s`} className="approval-summary">
        {approval.summary}
      </p>
      {outline.length > 0 && (
        <dl className="outline">
          {outline.map((s) => (
            <div key={s.label} className="outline-row">
              <dt>{s.label}</dt>
              <dd>
                <ul>
                  {s.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {/* With a plain reading above, a new config's YAML is one tap away; a diff always shows, it is the change itself. */}
      {outline.length > 0 && p.kind === "yaml" ? (
        <details className="approval-code">
          <summary>Show YAML</summary>
          {code}
        </details>
      ) : (
        code
      )}
      {waiting && (
        <>
          <div className="approval-actions">
            <button className="ghost" disabled={sending !== null} aria-describedby={`${ids}-t`} onClick={() => void decide(false)}>
              {sending === "deny" ? "Declining…" : "Decline"}
            </button>
            <button className="primary" disabled={sending !== null} aria-describedby={`${ids}-t`} onClick={() => void decide(true)}>
              {sending === "allow" ? "Approving…" : "Approve"}
            </button>
          </div>
          <p className="approval-note">Leaving this chat declines it.</p>
        </>
      )}
      {err && (
        <p className="approval-error" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
