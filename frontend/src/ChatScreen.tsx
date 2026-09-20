import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  decideWorkflow,
  fetchMe,
  startWorkflow,
  type CreateEventCommand,
  type PublicUser,
  type WorkflowSnapshot,
} from "./api";
import { EventSummary, summaryFromCommand } from "./EventSummary";

type ChatMessage = { id: string; command: CreateEventCommand };

type ChatScreenProps = {
  onSignOut: () => void;
};

export function ChatScreen({ onSignOut }: ChatScreenProps) {
  const navigate = useNavigate();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [draft, setDraft] = useState("");
  const [changeText, setChangeText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = snapshot?.status === "WAITING" && Boolean(snapshot.command);

  useEffect(() => {
    fetchMe()
      .then((result) => setUser(result.user))
      .catch(() => onSignOut());
  }, [onSignOut]);

  function applySnapshot(next: WorkflowSnapshot) {
    if (next.event) {
      navigate(`/events/${next.event.id}`);
      return;
    }
    setSnapshot(next.status === "WAITING" ? next : null);
    if (next.command && next.status === "WAITING") {
      setMessages([{ id: crypto.randomUUID(), command: next.command }]);
      return;
    }
    setMessages([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || waiting) {
      return;
    }

    setBusy(true);
    setError(null);
    setDraft("");

    try {
      applySnapshot(await startWorkflow(message));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The workflow failed.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!snapshot || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      applySnapshot(await decideWorkflow(snapshot.runId, { outcome: "approved" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the event.");
    } finally {
      setBusy(false);
    }
  }

  async function requestChanges() {
    const feedback = changeText.trim();
    if (!snapshot || !feedback || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setChangeText("");
    try {
      applySnapshot(await decideWorkflow(snapshot.runId, { outcome: "changes_requested", feedback }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply those changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-app">
      <header className="topbar">
        <div>
          <h1>Restaurant Council</h1>
          <p className="lede">Describe an event. Review the proposal, then accept it or ask for changes.</p>
        </div>
        <div className="topbar-meta">
          <Link className="ghost" to="/">
            Dashboard
          </Link>
          <span>{user ? user.name : "…"}</span>
          <button className="ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="chat-layout">
        <div className="transcript">
          {messages.length === 0 ? (
            <div className="empty">
              <h2>The table is open</h2>
              <p>
                Describe the restaurant event you want. An agent will draft a proposal. You can accept
                it or request changes before anything is saved.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="bubble council">
                <span className="who">Proposed event</span>
                <EventSummary {...summaryFromCommand(message.command)} />
              </div>
            ))
          )}
        </div>

        <div className="chat-controls">
          {error ? <p className="error">{error}</p> : null}

          {waiting ? (
            <div className="review-actions">
              <textarea
                value={changeText}
                onChange={(event) => setChangeText(event.target.value)}
                placeholder="Request a change, e.g. make it 5 miles and 4pm."
              />
              <div className="btn-row">
                <button className="primary" type="button" disabled={busy} onClick={() => void accept()}>
                  {busy ? "Working…" : "Accept & create"}
                </button>
                <button
                  className="ghost"
                  type="button"
                  disabled={busy || !changeText.trim()}
                  onClick={() => void requestChanges()}
                >
                  Request changes
                </button>
              </div>
            </div>
          ) : (
            <form className="composer" onSubmit={handleSubmit}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Find somewhere kid friendly within 10 miles of Bamford Park Saturday at 3pm."
                required
              />
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Interpreting…" : "Submit"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
