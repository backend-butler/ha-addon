import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import { App } from "./App";
import { installHaTheme } from "./haTheme";
import { installViewport } from "./viewport";
import "./styles.css";
import "./attach.css";
import "./slash.css";
import "./viewport.css";

installHaTheme();
installViewport();

/** A render crash shows its message instead of unmounting to a blank screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <pre role="alert" className="msg-error" style={{ margin: 16, whiteSpace: "pre-wrap" }}>
        {`Backend Butler hit an error.\n\n${this.state.error.stack ?? this.state.error.message}\n\n${navigator.userAgent}`}
      </pre>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <div data-app style={{ display: "contents" }}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </div>,
);
