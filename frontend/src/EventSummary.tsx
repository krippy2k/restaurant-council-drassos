import type { CouncilEvent, CreateEventCommand, EventConstraint } from "./api";
import { formatEventWhen, formatEventWhenLabel, formatMiles, milesFromMeters } from "./formatEvent";

export function EventSummary({
  name,
  date,
  location,
  radiusMiles,
  constraints,
  compact = false,
}: {
  name: string;
  date?: string;
  location: string;
  radiusMiles: number;
  constraints?: EventConstraint[];
  compact?: boolean;
}) {
  const when = formatEventWhen(date);
  const constraintLabels = constraints?.map((constraint) => constraint.label).filter(Boolean) ?? [];
  if (compact) {
    const facts = [formatEventWhenLabel(date), location, formatMiles(radiusMiles)];
    return (
      <div className="event-card event-card-compact">
        <strong>{name}</strong>
        <p className="event-compact-line">{facts.join(" · ")}</p>
        {constraintLabels.length > 0 ? <p className="event-compact-line event-meta">{constraintLabels.join(" · ")}</p> : null}
      </div>
    );
  }
  return (
    <div className="event-card">
      <strong>{name}</strong>
      {when.date ? (
        <p className="event-row">
          <span className="event-label">Date</span>
          {when.date}
        </p>
      ) : null}
      {when.time ? (
        <p className="event-row">
          <span className="event-label">Time</span>
          {when.time}
        </p>
      ) : null}
      <p className="event-row">
        <span className="event-label">Location</span>
        {location}
      </p>
      <p className="event-row">
        <span className="event-label">Distance</span>
        {formatMiles(radiusMiles)}
      </p>
      {constraintLabels.length ? (
        <p className="event-row">
          <span className="event-label">Constraints</span>
          {constraintLabels.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export function summaryFromCommand(command: CreateEventCommand) {
  return {
    name: command.name,
    date: command.date,
    location: command.searchArea.displayName || command.locationLabel,
    radiusMiles: command.radiusMiles,
    constraints: command.constraints,
  };
}

export function summaryFromEvent(event: CouncilEvent) {
  return {
    name: event.name,
    date: event.date,
    location: event.searchArea?.displayName || event.locationLabel || "No location",
    radiusMiles: milesFromMeters(event.searchArea?.radiusMeters),
    constraints: event.constraints,
  };
}
