import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  decideRestaurant,
  verifyRestaurantConstraint,
  type ConstraintContactMethod,
  type ConstraintVerificationResult,
  type CouncilRestaurant,
  type RestaurantDecisionKind,
} from "./api";
import { hoursForEventDay } from "./formatEvent";
import { restaurantMenuHref, telHref } from "./restaurantLinks";

type RestaurantCardProps = {
  restaurant: CouncilRestaurant;
  eventId?: string;
  userId?: string;
  eventDate?: string;
  timezone?: string;
  onRestaurantChange?: (restaurant: CouncilRestaurant) => void;
  onFeedbackStart?: () => void;
  onCouncilResult?: (result: {
    restaurant: CouncilRestaurant;
    restaurants?: CouncilRestaurant[];
    searchedAt?: string;
  }) => void;
};

const priceLabels: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

function RatingStars({ rating }: { rating: number }) {
  const fill = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <span className="rating-stars" aria-hidden="true">
      <span className="rating-stars-empty">★★★★★</span>
      <span className="rating-stars-fill" style={{ width: `${fill}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

export function RestaurantCard({
  restaurant,
  eventId,
  userId,
  eventDate,
  timezone,
  onRestaurantChange,
  onFeedbackStart,
  onCouncilResult,
}: RestaurantCardProps) {
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState<NonNullable<CouncilRestaurant["constraintChecks"]>[number] | null>(null);
  const [deciding, setDeciding] = useState<RestaurantDecisionKind | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const eventHours = hoursForEventDay(restaurant.hours, eventDate, timezone);
  const price = restaurant.priceLevel ? priceLabels[restaurant.priceLevel] ?? restaurant.priceLevel : undefined;
  const menuHref = restaurantMenuHref(restaurant);

  function openPhoto() {
    lightbox.current?.showModal();
  }

  function closePhoto(click?: { target: EventTarget | null; currentTarget: EventTarget }) {
    if (click && click.target !== click.currentTarget) {
      return;
    }
    lightbox.current?.close();
  }

  async function chooseDecision(decision: RestaurantDecisionKind) {
    if (!eventId || deciding) {
      return;
    }
    setDeciding(decision);
    setDecisionError(null);
    onFeedbackStart?.();
    try {
      const result = await decideRestaurant(eventId, restaurant.placeId, decision);
      onCouncilResult?.(result);
      onRestaurantChange?.(result.restaurant);
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Could not save that decision.");
    } finally {
      setDeciding(null);
    }
  }

  const myDecision =
    restaurant.decisions?.find((item) => item.userId === userId)?.decision ??
    restaurant.userScores?.find((item) => item.userId === userId)?.decision;

  return (
    <li className="restaurant-card">
      <div className="restaurant-media">
        {restaurant.photoUrl ? (
          <button className="restaurant-photo-button" type="button" onClick={openPhoto}>
            <img className="restaurant-photo" src={restaurant.photoUrl} alt="" />
            <span className="sr-only">View full photo of {restaurant.name}</span>
          </button>
        ) : (
          <div className="restaurant-photo restaurant-photo-empty" aria-hidden="true" />
        )}
        {typeof restaurant.councilScore === "number" ? (
          <div className="restaurant-final-score">{restaurant.councilScore}%</div>
        ) : null}
        {typeof restaurant.rating === "number" || typeof restaurant.reviewCount === "number" ? (
          <div className="restaurant-rating">
            {typeof restaurant.rating === "number" ? (
              <span className="restaurant-rating-row" aria-label={`${restaurant.rating.toFixed(1)} out of 5`}>
                <span aria-hidden="true">{restaurant.rating.toFixed(1)}</span>
                <RatingStars rating={restaurant.rating} />
              </span>
            ) : null}
            {typeof restaurant.reviewCount === "number" ? (
              <span>
                {restaurant.reviewCount.toLocaleString()} review{restaurant.reviewCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        ) : null}
        <button
          className="ghost restaurant-details-toggle"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Hide Details" : "View Details"}
        </button>
      </div>
      {restaurant.photoUrl ? (
        <dialog
          ref={lightbox}
          className="photo-lightbox"
          aria-label={`${restaurant.name} photo`}
          onClick={(event) => closePhoto(event)}
        >
          <img src={restaurant.photoUrl} alt={restaurant.name} />
          <form method="dialog">
            <button className="ghost" type="submit">
              Close
            </button>
          </form>
        </dialog>
      ) : null}
      <div className="restaurant-copy">
        <strong>{restaurant.name}</strong>
        <span>{restaurant.address ?? "Address unknown"}</span>
        {restaurant.phone ? (
          <a className="restaurant-phone" href={telHref(restaurant.phone)}>
            {restaurant.phone}
          </a>
        ) : null}
        {restaurant.website || menuHref ? (
          <div className="restaurant-links">
            {restaurant.website ? (
              <a className="ghost" href={restaurant.website} target="_blank" rel="noreferrer">
                Website
              </a>
            ) : null}
            {menuHref ? (
              <a className="ghost" href={menuHref} target="_blank" rel="noreferrer">
                View Menu
              </a>
            ) : null}
          </div>
        ) : null}
        <span>
          {eventHours
            ? eventHours
            : eventDate
              ? "Hours unknown for the event day"
              : "Set an event date to see hours for that day"}
        </span>
        {restaurant.constraintChecks && restaurant.constraintChecks.length > 0 ? (
          <ul className="restaurant-constraints">
            {restaurant.constraintChecks.map((check) => (
              <li
                key={check.id}
                className={`restaurant-constraint ${check.confirmed ? "restaurant-constraint-yes" : "restaurant-constraint-no"}`}
              >
                <span>{check.label}</span>
                {check.verifications && check.verifications.length > 0 ? (
                  check.verifications.map((item) => <span key={item.id}>{item.summary}</span>)
                ) : (
                  <span>{check.confirmed ? check.confirmation ?? "Confirmed" : "Not confirmed"}</span>
                )}
                {eventId && needsVerification(check) ? (
                  <button className="ghost restaurant-verify" type="button" onClick={() => setVerifying(check)}>
                    I'll Verify
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {restaurant.constraintFlags && restaurant.constraintFlags.length > 0 ? (
          <ul className="restaurant-flags">
            {restaurant.constraintFlags.map((flag) => (
              <li key={flag.id} className={`restaurant-flag restaurant-flag-${flag.status}`}>
                {flag.status === "mismatch" ? "Didn't match" : "Uncertain"}
                {" · "}
                {flag.label}
              </li>
            ))}
          </ul>
        ) : null}
        {restaurant.explanations && restaurant.explanations.length > 0 ? (
          <ul className="restaurant-explanations">
            {restaurant.explanations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {eventId ? (
          <div className="restaurant-actions">
            {(
              [
                ["approve", "Approve"],
                ["prefer", "Prefer"],
                ["dislike", "Dislike"],
                ["reject", "Reject"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                className={myDecision === kind ? "primary" : "ghost"}
                type="button"
                disabled={Boolean(deciding)}
                onClick={() => void chooseDecision(kind)}
              >
                {deciding === kind ? `${label}…` : label}
              </button>
            ))}
          </div>
        ) : null}
        {decisionError ? <p className="error">{decisionError}</p> : null}
      </div>
      {open ? (
        <div className="restaurant-details">
          {price ? <span>Price {price}</span> : null}
          {restaurant.openNow === true ? <span>Open now</span> : null}
          {restaurant.openNow === false ? <span>Closed now</span> : null}
          {restaurant.hours && restaurant.hours.length > 0 ? (
            <ul className="restaurant-hours">
              {restaurant.hours.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <span>Weekly hours unknown</span>
          )}
        </div>
      ) : null}
      {verifying && eventId ? (
        <VerifyConstraintDialog
          restaurant={restaurant}
          constraint={verifying}
          eventId={eventId}
          onClose={() => setVerifying(null)}
          onSaved={(result) => {
            setVerifying(null);
            onCouncilResult?.(result);
            onRestaurantChange?.(result.restaurant);
          }}
          onFeedbackStart={onFeedbackStart}
        />
      ) : null}
    </li>
  );
}

function needsVerification(check: NonNullable<CouncilRestaurant["constraintChecks"]>[number]): boolean {
  const latest = check.verifications?.at(-1);
  if (latest?.result === "meets" || latest?.result === "does_not_meet") {
    return false;
  }
  return !check.confirmed;
}

function VerifyConstraintDialog({
  restaurant,
  constraint,
  eventId,
  onClose,
  onSaved,
  onFeedbackStart,
}: {
  restaurant: CouncilRestaurant;
  constraint: NonNullable<CouncilRestaurant["constraintChecks"]>[number];
  eventId: string;
  onClose: () => void;
  onSaved: (result: {
    restaurant: CouncilRestaurant;
    restaurants?: CouncilRestaurant[];
    searchedAt?: string;
  }) => void;
  onFeedbackStart?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<ConstraintVerificationResult | "">("");
  const [method, setMethod] = useState<ConstraintContactMethod | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node?.open) {
      node?.showModal();
    }
    return () => {
      if (node?.open) {
        node.close();
      }
    };
  }, []);

  function onBackdropClick(event: { target: EventTarget | null; currentTarget: EventTarget }) {
    if (event.target !== event.currentTarget) {
      return;
    }
    onClose();
  }

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!result || !method || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    onFeedbackStart?.();
    try {
      const saved = await verifyRestaurantConstraint(eventId, restaurant.placeId, {
        constraintId: constraint.id,
        result,
        method,
        notes: notes.trim() || undefined,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that verification.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="verify-lightbox"
      aria-label={`Verify ${constraint.label} at ${restaurant.name}`}
      onClick={onBackdropClick}
    >
      <form className="verify-card" onSubmit={(event) => void submit(event)}>
        <h3>I'll Verify</h3>
        <p className="lede">
          Check whether {restaurant.name} meets <strong>{constraint.label}</strong>.
        </p>
        <div className="verify-contact">
          {restaurant.address ? <span>{restaurant.address}</span> : null}
          {restaurant.phone ? (
            <a href={`tel:${restaurant.phone.replace(/[^\d+]/g, "")}`}>{restaurant.phone}</a>
          ) : (
            <span>No phone number on file</span>
          )}
          {restaurant.email ? <a href={`mailto:${restaurant.email}`}>{restaurant.email}</a> : null}
          {restaurant.website ? (
            <a href={restaurant.website} target="_blank" rel="noreferrer">
              {restaurant.website}
            </a>
          ) : null}
        </div>
        <label>
          Result
          <select value={result} onChange={(event) => setResult(event.target.value as ConstraintVerificationResult)} required>
            <option value="">Select a result</option>
            <option value="meets">Confirmed to meet the constraint</option>
            <option value="does_not_meet">Confirmed not to meet the constraint</option>
            <option value="unknown">Still unknown</option>
          </select>
        </label>
        <label>
          Contact method
          <select value={method} onChange={(event) => setMethod(event.target.value as ConstraintContactMethod)} required>
            <option value="">Select a method</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="in-person">In-Person</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="verify-actions">
          <button className="ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
