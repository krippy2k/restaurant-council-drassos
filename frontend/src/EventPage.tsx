import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addContact,
  addEventPreferences,
  decideWorkflow,
  fetchContacts,
  fetchEvent,
  fetchEventInvitations,
  fetchMe,
  interpretEventChange,
  inviteToEvent,
  startDeleteWorkflow,
  updateEvent,
  type Contact,
  type CouncilEvent,
  type EventInvitation,
  type EventPreference,
  type PublicUser,
  type WorkflowSnapshot,
} from "./api";
import { EventSummary, summaryFromEvent } from "./EventSummary";
import { ConstraintsList } from "./ConstraintsList";
import { milesFromMeters, splitEventDateTime } from "./formatEvent";

type EventPageProps = {
  onSignOut: () => void;
};

export function EventPage({ onSignOut }: EventPageProps) {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [event, setEvent] = useState<CouncilEvent | null>(null);
  const [mode, setMode] = useState<"form" | "chat">("chat");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteRun, setDeleteRun] = useState<WorkflowSnapshot | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [kidFriendly, setKidFriendly] = useState(false);
  const [chat, setChat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [invitations, setInvitations] = useState<EventInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteContactId, setInviteContactId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [preferences, setPreferences] = useState<EventPreference[]>([]);
  const [preferenceNote, setPreferenceNote] = useState("");
  const isOwner = Boolean(user && event && user.id === event.ownerId);

  function applyEvent(next: CouncilEvent) {
    const parts = splitEventDateTime(next.date);
    setEvent(next);
    setName(next.name);
    setDate(parts.date);
    setTime(parts.time);
    setLocationLabel(next.locationLabel ?? next.searchArea?.displayName ?? "");
    setRadiusMiles(milesFromMeters(next.searchArea?.radiusMeters));
    setKidFriendly(Boolean(next.constraints?.some((item) => item.type === "kid-friendly")));
  }

  useEffect(() => {
    fetchMe()
      .then((result) => setUser(result.user))
      .catch(() => onSignOut());
  }, [onSignOut]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    fetchEvent(eventId)
      .then((result) => {
        applyEvent(result.event);
        setPreferences(result.preferences ?? []);
        setConfirmDelete(false);
        setDeleteRun(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the event."));
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !isOwner) {
      return;
    }
    void Promise.all([fetchContacts(), fetchEventInvitations(eventId)])
      .then(([nextContacts, nextInvites]) => {
        setContacts(nextContacts.contacts);
        setInvitations(nextInvites.invitations);
      })
      .catch(() => undefined);
  }, [eventId, isOwner]);

  async function saveForm(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!event || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await updateEvent(event.id, {
        name,
        date,
        time,
        locationLabel,
        radiusMiles: Number(radiusMiles),
        kidFriendly,
      });
      applyEvent(result.event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event.");
    } finally {
      setBusy(false);
    }
  }

  async function submitChat(formEvent: FormEvent) {
    formEvent.preventDefault();
    const message = chat.trim();
    if (!event || !message || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setChat("");
    try {
      const result = await interpretEventChange(event.id, message);
      applyEvent(result.event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply that change.");
    } finally {
      setBusy(false);
    }
  }

  async function beginDelete() {
    if (!event || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const snapshot = await startDeleteWorkflow(event.id);
      if (snapshot.deleted || snapshot.status === "COMPLETED") {
        navigate("/");
        return;
      }
      if (snapshot.status !== "WAITING") {
        throw new Error(snapshot.error ?? "Could not start event deletion.");
      }
      setDeleteRun(snapshot);
      setConfirmDelete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start event deletion.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent() {
    if (!event || !deleteRun || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const snapshot = await decideWorkflow(deleteRun.runId, { outcome: "approved" });
      if (snapshot.deleted || snapshot.status === "COMPLETED") {
        navigate("/");
        return;
      }
      throw new Error(snapshot.error ?? "Could not delete the event.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the event.");
      setBusy(false);
    }
  }

  async function cancelDelete() {
    if (busy) {
      return;
    }
    const runId = deleteRun?.runId;
    setBusy(true);
    setError(null);
    try {
      if (runId) {
        await decideWorkflow(runId, { outcome: "rejected", reason: "Event deletion was cancelled." });
      }
    } catch {
      // The workflow ends as failed when the host cancels.
    } finally {
      setConfirmDelete(false);
      setDeleteRun(null);
      setBusy(false);
    }
  }

  async function reloadInvites() {
    if (!event) {
      return;
    }
    const [nextContacts, nextInvites] = await Promise.all([fetchContacts(), fetchEventInvitations(event.id)]);
    setContacts(nextContacts.contacts);
    setInvitations(nextInvites.invitations);
  }

  async function sendInvite(body: { email?: string; contactId?: string; contactName?: string }) {
    if (!event || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await inviteToEvent(event.id, body);
      setInviteEmail("");
      setInviteContactId("");
      await reloadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that invite.");
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addContact({ name: contactName, email: contactEmail });
      setContactName("");
      setContactEmail("");
      await reloadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that contact.");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences(formEvent: FormEvent) {
    formEvent.preventDefault();
    const message = preferenceNote.trim();
    if (!event || !message || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setPreferenceNote("");
    try {
      const result = await addEventPreferences(event.id, message);
      setPreferences(result.preferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save those constraints.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-app">
      <header className="topbar">
        <div>
          <h1>{event?.name ?? "Event"}</h1>
          <p className="lede">Review the details, then edit with the form or a chat note.</p>
        </div>
        <div className="topbar-meta">
          <Link className="ghost" to="/">
            Dashboard
          </Link>
          <Link className="ghost" to="/new">
            New event
          </Link>
          <span>{user ? user.name : "…"}</span>
          <button className="ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="event-page">
        {error ? <p className="error">{error}</p> : null}

        {event ? (
          <div className="open-council-row">
            <Link className="primary" to={`/events/${event.id}/council`}>
              Open Council
            </Link>
          </div>
        ) : null}
        {event ? <EventSummary {...summaryFromEvent(event)} /> : <p className="lede">Loading event…</p>}
        {event && user && !isOwner ? (
          <p className="lede">You were invited to this event. Accept or decline it from the dashboard.</p>
        ) : null}

        {event ? (
          <>
            <ConstraintsList
              preferences={preferences}
              emptyText="No personal constraints yet. Add dietary needs, a price cap, or similar."
            />
            <form className="composer event-form" onSubmit={savePreferences}>
              <textarea
                value={preferenceNote}
                onChange={(formEvent) => setPreferenceNote(formEvent.target.value)}
                placeholder="I can't eat gluten. Keep this private."
                required
              />
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Add constraint"}
              </button>
            </form>
          </>
        ) : null}

        {isOwner ? (
          <>
        <div className="mode-toggle" role="tablist" aria-label="Edit mode">
          <button
            className={mode === "form" ? "primary" : "ghost"}
            type="button"
            onClick={() => setMode("form")}
          >
            Form
          </button>
          <button
            className={mode === "chat" ? "primary" : "ghost"}
            type="button"
            onClick={() => setMode("chat")}
          >
            Chat
          </button>
        </div>

        {mode === "form" ? (
          <form className="event-form" onSubmit={saveForm}>
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              Date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
            <label>
              Location
              <input
                value={locationLabel}
                onChange={(event) => setLocationLabel(event.target.value)}
                required
              />
            </label>
            <label>
              Distance (miles)
              <input
                type="number"
                min={0.3}
                max={31}
                step={0.1}
                value={radiusMiles}
                onChange={(event) => setRadiusMiles(Number(event.target.value))}
                required
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={kidFriendly}
                onChange={(event) => setKidFriendly(event.target.checked)}
              />
              Kid Friendly
            </label>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </form>
        ) : (
          <form className="composer" onSubmit={submitChat}>
            <textarea
              value={chat}
              onChange={(event) => setChat(event.target.value)}
              placeholder="Make it 5 miles and 4pm."
              required
            />
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Updating…" : "Update"}
            </button>
          </form>
        )}

        <section className="event-form invite-section">
          <h2 className="events-heading">Invite people</h2>
          {contacts.length > 0 ? (
            <form
              className="invite-form"
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                void sendInvite({ contactId: inviteContactId });
              }}
            >
              <label>
                Invite a contact
                <select value={inviteContactId} onChange={(formEvent) => setInviteContactId(formEvent.target.value)} required>
                  <option value="">Choose a contact</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name} · {contact.email}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" type="submit" disabled={busy || !inviteContactId}>
                Invite
              </button>
            </form>
          ) : null}

          <form
            className="invite-form"
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              void sendInvite({ email: inviteEmail });
            }}
          >
            <label>
              Invite by email
              <input
                type="email"
                value={inviteEmail}
                onChange={(formEvent) => setInviteEmail(formEvent.target.value)}
                placeholder="guest@example.com"
                required
              />
            </label>
            <button className="primary" type="submit" disabled={busy}>
              Send invite
            </button>
          </form>

          <form className="invite-form" onSubmit={saveContact}>
            <label>
              Add contact name
              <input value={contactName} onChange={(formEvent) => setContactName(formEvent.target.value)} required />
            </label>
            <label>
              Add contact email
              <input
                type="email"
                value={contactEmail}
                onChange={(formEvent) => setContactEmail(formEvent.target.value)}
                required
              />
            </label>
            <button className="ghost" type="submit" disabled={busy}>
              Save contact
            </button>
          </form>

          {invitations.length > 0 ? (
            <ul className="event-list">
              {invitations.map((invite) => (
                <li key={invite.id} className="event-list-item">
                  <strong>{invite.email}</strong>
                  <span>
                    {invite.status}
                    {invite.rejectReason ? ` · ${invite.rejectReason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lede">No invites yet. Save a contact to invite them by name later.</p>
          )}
        </section>

        {event ? (
          <div className="delete-event">
            {confirmDelete ? (
              <>
                <p>Delete this event? This cannot be undone.</p>
                <div className="btn-row">
                  <button className="danger" type="button" disabled={busy} onClick={() => void removeEvent()}>
                    {busy ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelDelete()}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="danger" type="button" disabled={busy} onClick={() => void beginDelete()}>
                Delete Event
              </button>
            )}
          </div>
        ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
