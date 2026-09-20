import type { CouncilEvent, CreateEventCommand, EventConstraint } from "./api";
import { formatEventWhen, formatMiles, milesFromMeters } from "./formatEvent";

export function EventSummary({
  name,
  date,
  location,
  radiusMiles,
  constraints,
}: {
  name: string;
  date?: string;
  location: string;
  radiusMiles: number;
  constraints?: EventConstraint[];
}) {
  const when = formatEventWhen(date);
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
      {constraints?.length ? (
        <p className="event-row">
          <span className="event-label">Constraints</span>
          {constraints.map((constraint) => constraint.label).join(", ")}
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
