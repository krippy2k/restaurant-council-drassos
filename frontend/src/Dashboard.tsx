import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchEvents, fetchInvitations, fetchMe, respondToInvitation, type CouncilEvent, type EventInvitation, type PublicUser } from "./api";
import { formatEventWhenLabel } from "./formatEvent";

type DashboardProps = {
  onSignOut: () => void;
};

export function Dashboard({ onSignOut }: DashboardProps) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [events, setEvents] = useState<CouncilEvent[] | null>(null);
  const [invitations, setInvitations] = useState<EventInvitation[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then((result) => setUser(result.user))
      .catch(() => onSignOut());
  }, [onSignOut]);

  useEffect(() => {
    fetchEvents()
      .then((result) => setEvents(result.events))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load events."));
    fetchInvitations()
      .then((result) => setInvitations(result.invitations))
      .catch(() => undefined);
  }, []);

  async function answerInvite(invitationId: string, outcome: "accepted" | "rejected") {
    if (inviteBusy) {
      return;
    }
    if (outcome === "rejected" && !rejectReason.trim()) {
      setError("Say why you are declining.");
      return;
    }
    setInviteBusy(true);
    setError(null);
    try {
      await respondToInvitation(invitationId, {
        outcome,
        reason: outcome === "rejected" ? rejectReason.trim() : undefined,
      });
      const [nextInvites, nextEvents] = await Promise.all([fetchInvitations(), fetchEvents()]);
      setInvitations(nextInvites.invitations);
      setEvents(nextEvents.events);
      setRejectingId(null);
      setRejectReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not answer that invitation.");
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="chat-app">
      <header className="topbar">
        <div>
          <h1>Restaurant Council</h1>
          <p className="lede">Your events. Open one to review or edit it.</p>
        </div>
        <div className="topbar-meta">
          <span>{user ? user.name : "…"}</span>
          <button className="ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="event-page">
        {error ? <p className="error">{error}</p> : null}

        {events === null ? (
          <p className="lede">Loading events…</p>
        ) : (
          <>
            {invitations.length > 0 ? (
              <section className="invite-section">
                <h2 className="events-heading">Invitations</h2>
                <ul className="event-list">
                  {invitations.map((invite) => (
                    <li key={invite.id} className="event-list-item">
                      <strong>{invite.eventName}</strong>
                      <span>{formatEventWhenLabel(invite.eventDate)}</span>
                      <span>
                        {invite.hostName} invited {invite.email}
                      </span>
                      {rejectingId === invite.id ? (
                        <div className="invite-actions">
                          <textarea
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            placeholder="Why are you declining?"
                          />
                          <div className="btn-row">
                            <button
                              className="danger"
                              type="button"
                              disabled={inviteBusy}
                              onClick={() => void answerInvite(invite.id, "rejected")}
                            >
                              Confirm decline
                            </button>
                            <button className="ghost" type="button" disabled={inviteBusy} onClick={() => setRejectingId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="btn-row">
                          <button
                            className="primary"
                            type="button"
                            disabled={inviteBusy}
                            onClick={() => void answerInvite(invite.id, "accepted")}
                          >
                            Accept
                          </button>
                          <button
                            className="ghost"
                            type="button"
                            disabled={inviteBusy}
                            onClick={() => {
                              setRejectingId(invite.id);
                              setRejectReason("");
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <h2 className="events-heading">My Events</h2>
            {events.length === 0 ? (
              <div className="empty">
                <p>Create one from a short description. It will show up here afterward.</p>
                <Link className="primary create-event" to="/new">
                  Create Event
                </Link>
              </div>
            ) : (
              <>
                <ul className="event-list">
                  {events.map((event) => {
                    const location = event.searchArea?.displayName || event.locationLabel || "No location";
                    return (
                      <li key={event.id}>
                        <Link className="event-list-item" to={`/events/${event.id}`}>
                          <strong>{event.name}</strong>
                          <span>{formatEventWhenLabel(event.date)}</span>
                          <span>{location}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Link className="primary create-event" to="/new">
                  Create Event
                </Link>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
