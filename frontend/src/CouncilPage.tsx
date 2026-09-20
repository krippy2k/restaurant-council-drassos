import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchEvent,
  fetchEventChat,
  fetchMe,
  fetchRestaurants,
  sendEventChat,
  startCouncil,
  fetchCouncilProgress,
  type CouncilEvent,
  type CouncilProgress,
  type CouncilRestaurant,
  type EventChatMessage,
  type EventPreference,
  type PublicUser,
} from "./api";
import { ConstraintsList } from "./ConstraintsList";
import { RestaurantCard } from "./RestaurantCard";

type CouncilPageProps = {
  onSignOut: () => void;
};

export function CouncilPage({ onSignOut }: CouncilPageProps) {
  const { eventId = "" } = useParams();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [event, setEvent] = useState<CouncilEvent | null>(null);
  const [preferences, setPreferences] = useState<EventPreference[]>([]);
  const [messages, setMessages] = useState<EventChatMessage[]>([]);
  const [restaurants, setRestaurants] = useState<CouncilRestaurant[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [progress, setProgress] = useState<CouncilProgress | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

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
        setEvent(result.event);
        setPreferences(result.preferences ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the council."));
    void loadChat(eventId);
    fetchRestaurants(eventId)
      .then((result) => {
        setRestaurants(result.restaurants);
        setSearchedAt(result.searchedAt);
      })
      .catch(() => undefined);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadChat(eventId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [eventId]);

  useEffect(() => {
    const node = scroller.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  async function loadChat(id: string) {
    try {
      const result = await fetchEventChat(id);
      setMessages(result.messages);
    } catch {
      // Keep the last transcript if a poll fails.
    }
  }

  async function beginCouncil() {
    if (!eventId || starting) {
      return;
    }
    setStarting(true);
    setError(null);
    setRestaurants([]);
    setSearchedAt(null);
    setProgress({ eventId, status: "RUNNING", agent: "Council Clerk", tool: "Starting" });
    const poll = () => {
      fetchCouncilProgress(eventId)
        .then((result) => {
          if (result.progress) {
            setProgress(result.progress);
          }
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 400);
    try {
      const result = await startCouncil(eventId);
      setRestaurants(result.restaurants);
      setSearchedAt(result.searchedAt);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Council.");
    } finally {
      window.clearInterval(timer);
      setStarting(false);
    }
  }

  async function submitChat(formEvent?: FormEvent) {
    formEvent?.preventDefault();
    const message = draft.trim();
    if (!eventId || !message || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const result = await sendEventChat(eventId, message);
      setMessages(result.messages);
    } catch (err) {
      setDraft(message);
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitChat();
    }
  }

  const picks = restaurants.filter((restaurant) => restaurant.picked);
  const alsoConsidered = restaurants.filter((restaurant) => !restaurant.picked);

  return (
    <div className="chat-app">
      <header className="topbar">
        <div>
          <h1>{event ? `${event.name} council` : "Council"}</h1>
          <p className="lede">Review constraints, talk with the group, then search for restaurants.</p>
        </div>
        <div className="topbar-meta">
          {eventId ? (
            <Link className="ghost" to={`/events/${eventId}`}>
              Event
            </Link>
          ) : null}
          <Link className="ghost" to="/">
            Dashboard
          </Link>
          <span>{user ? user.name : "…"}</span>
          <button className="ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="council-page">
        {error ? <p className="error">{error}</p> : null}

        <ConstraintsList
          preferences={preferences}
          emptyText="No constraints yet. Add them on the event page."
        />

        <section className="council-chat event-form">
          <h2 className="events-heading">Chat</h2>
          <div className="council-transcript" ref={scroller}>
            {messages.length === 0 ? (
              <p className="lede">No messages yet. Say hello to the table.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={message.mine ? "bubble user" : "bubble council"}>
                  <span className="who">{message.mine ? "You" : message.userName}</span>
                  {message.body}
                </div>
              ))
            )}
          </div>
          <form className="composer" onSubmit={(formEvent) => void submitChat(formEvent)}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Write a message. Enter sends, Shift+Enter starts a new line."
              required
            />
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </form>
        </section>

        <section className="event-form invite-section">
          <div className="open-council-row">
            <button className="primary" type="button" disabled={starting} onClick={() => void beginCouncil()}>
              {starting ? "Convening…" : "Convene the Council"}
            </button>
          </div>
          {starting && progress ? (
            <p className="council-live">
              <strong>{progress.agent}</strong>
              <span>{progress.tool}</span>
            </p>
          ) : null}
          {starting ? null : restaurants.length > 0 ? (
            <>
              {picks.length > 0 ? (
                <>
                  <h2 className="events-heading">Council Picks</h2>
                  <ul className="event-list restaurant-list">
                    {picks.map((restaurant) => (
                      <RestaurantCard
                        key={restaurant.placeId}
                        restaurant={restaurant}
                        eventId={eventId}
                        eventDate={event?.date}
                        timezone={event?.timezone}
                        onRestaurantChange={(next) =>
                          setRestaurants((current) =>
                            current.map((item) => (item.placeId === next.placeId ? next : item)),
                          )
                        }
                      />
                    ))}
                  </ul>
                </>
              ) : null}
              {alsoConsidered.length > 0 ? (
                <>
                  <h2 className="events-heading">Also considered</h2>
                  <ul className="event-list restaurant-list">
                    {alsoConsidered.map((restaurant) => (
                      <RestaurantCard
                        key={restaurant.placeId}
                        restaurant={restaurant}
                        eventId={eventId}
                        eventDate={event?.date}
                        timezone={event?.timezone}
                        onRestaurantChange={(next) =>
                          setRestaurants((current) =>
                            current.map((item) => (item.placeId === next.placeId ? next : item)),
                          )
                        }
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="lede">
              {searchedAt
                ? "No restaurants in the search area survived the required constraints."
                : "Convene the Council to search nearby restaurants and drop confirmed mismatches."}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
