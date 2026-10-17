import type { ReactNode } from "react";
import { type Activity, type Status, type ToolPart, toolName } from "./transcriptActivity";
import { BulbIcon, FanIcon, FlowIcon, PlayIcon, PowerIcon, SearchIcon, SpeakerIcon, ThermoIcon, VacuumIcon } from "./icons";

const DOMAIN_ICONS: Record<string, () => ReactNode> = {
  light: BulbIcon,
  switch: PowerIcon,
  input_boolean: PowerIcon,
  fan: FanIcon,
  climate: ThermoIcon,
  water_heater: ThermoIcon,
  humidifier: ThermoIcon,
  media_player: SpeakerIcon,
  vacuum: VacuumIcon,
  script: PlayIcon,
  scene: PlayIcon,
};

/** The raw call, for anyone who wants to see exactly what ran: literal content, so monospace. */
function RawCall({ part }: { part: ToolPart }) {
  return (
    <div className="raw-call">
      <div className="raw-call-name">{toolName(part)}</div>
      <pre>{JSON.stringify(part.input, null, 2)}</pre>
      {part.result !== undefined && <pre className={part.isError ? "raw-call-error" : undefined}>{part.result}</pre>}
    </div>
  );
}

function StatusMark({ status }: { status: Status }) {
  if (status === "running") return <span className="act-spinner" aria-hidden="true" />;
  return null;
}

/** States that mean "active", so their chip reads as lit. */
const ON = /^(on|open|playing|cleaning|heat|cool|heat cool|auto|dry|fan only)\b/;

/** First line of a failure, short enough to read in a row. */
const reason = (p: ToolPart) => {
  const line = (p.result ?? "").split("\n")[0].trim();
  return line.length > 180 ? `${line.slice(0, 179)}…` : line;
};

export function ActivityRow({ activity: a }: { activity: Activity }) {
  if (a.kind === "lookups") {
    return (
      <details className={`act act-lookups act-${a.status}`}>
        <summary>
          <span className="act-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <span className="act-label">
            {a.label}
            {a.status === "running" && "…"}
          </span>
          {a.failed > 0 && <span className="act-flag">{a.failed} failed</span>}
          <StatusMark status={a.status} />
          <span className="act-more">Details</span>
        </summary>
        <div className="act-raw">
          {a.parts.map((p) => (
            <RawCall key={p.id} part={p} />
          ))}
        </div>
      </details>
    );
  }

  const Icon = a.kind === "control" ? (DOMAIN_ICONS[a.domain] ?? PowerIcon) : FlowIcon;
  return (
    <div className={`act act-outcome act-${a.status}`}>
      <div className="act-main">
        <span className="act-icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="act-label">
          {a.label}
          {a.status === "running" && "…"}
          {a.kind === "control" && a.entities.length > 0 && (
            <span className="act-entities">
              {a.entities.map((e) => (
                <span key={e.id} className="act-entity">
                  {e.name}
                  {e.state && <span className={`state-chip${ON.test(e.state) ? " state-on" : ""}`}>{e.state}</span>}
                </span>
              ))}
            </span>
          )}
        </span>
        <StatusMark status={a.status} />
      </div>
      {a.status === "failed" && <p className="act-reason">{reason(a.part)}</p>}
      <div className="act-foot">
        {a.kind === "config" && a.editUrl && (
          <a className="act-link" href={a.editUrl} target="_top">
            Open in Home Assistant
          </a>
        )}
        <details className="act-details">
          <summary>Details</summary>
          <RawCall part={a.part} />
        </details>
      </div>
    </div>
  );
}
