import type { EventPreference } from "./api";

export function preferenceSummary(preference: EventPreference): string {
  const strength = preference.priority === "HARD" ? "Required" : "Preference";
  if (preference.mine) {
    return preference.visibility === "PRIVATE" ? `${strength} · Private · You` : `${strength} · You`;
  }
  return `${strength} · ${preference.userName}`;
}

export function ConstraintsList({
  preferences,
  emptyText = "No constraints yet.",
}: {
  preferences: EventPreference[];
  emptyText?: string;
}) {
  return (
    <section className="event-form invite-section">
      <h2 className="events-heading">Constraints</h2>
      {preferences.length > 0 ? (
        <ul className="event-list">
          {preferences.map((preference) => (
            <li key={preference.id} className="event-list-item">
              <strong>{preference.label}</strong>
              <span>{preferenceSummary(preference)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lede">{emptyText}</p>
      )}
    </section>
  );
}
