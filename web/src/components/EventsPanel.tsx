import type { SimEvent } from "@dron/shared";
import { fmtClock } from "../format";

interface Props {
  events: readonly SimEvent[];
}

export function EventsPanel({ events }: Props) {
  const recent = [...events].reverse();

  return (
    <article className="card panel">
      <div className="card-head">
        <h2>Bitácora de vuelo</h2>
        <span className="chip">{events.length}</span>
      </div>

      {recent.length === 0 ? (
        <p className="empty">Sin eventos todavía. El motor registra aquí cada decisión.</p>
      ) : (
        <ol className="events">
          {recent.map((event) => (
            <li key={event.id} className={`event event-${event.type}`}>
              <span className="event-dot" />
              <span className="event-time mono">{fmtClock(event.t)}</span>
              <span className="event-message">{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
