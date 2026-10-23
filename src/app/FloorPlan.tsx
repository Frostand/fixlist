import { authored } from '../i18n/authored';
import { useT } from '../i18n';
import { en } from '../i18n/en';
import type { DemoScenario } from '../domain/types';
import type { DemoState } from '../domain/workflow';
import { progressText, checklistPresentation } from './checklist-presentation';

/** Schematic, not to scale. Rooms missing from this layout are simply omitted from the map. */
const layout: Record<string, { x: number; y: number; w: number; h: number; label: string }> = {
  'living-room': { x: 0, y: 0, w: 150, h: 120, label: en["legacy.floorplan.1"] },
  stairs: { x: 150, y: 0, w: 60, h: 120, label: en["legacy.floorplan.2"] },
  bedroom: { x: 210, y: 0, w: 110, h: 120, label: en["legacy.floorplan.3"] },
  hallway: { x: 0, y: 120, w: 210, h: 60, label: en["legacy.floorplan.4"] },
  bathroom: { x: 210, y: 120, w: 110, h: 60, label: en["legacy.floorplan.5"] },
};

export function confirmedCountByRoom(scenario: DemoScenario, state: DemoState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const concern of scenario.concerns) {
    if (state.confirmations[concern.id]?.humanConfirmed !== true) continue;
    const roomId = scenario.evidence.find((item) => item.id === concern.evidenceIds[0])?.roomId;
    if (roomId) counts[roomId] = (counts[roomId] ?? 0) + 1;
  }
  return counts;
}

/** Hatching marks Not sure or unanswered questions; neither is drawn as clear. */
export function FloorPlan({ scenario, state }: { scenario: DemoScenario; state: DemoState }) {
  const t = useT();
  const coverage = checklistPresentation(scenario, state);
  const confirmed = confirmedCountByRoom(scenario, state);
  const rooms = coverage.rooms.filter((room) => layout[room.roomId]);
  if (rooms.length === 0) return null;
  return (
    <figure className="floor-plan">
      <svg viewBox="-3 -3 326 186" role="group" aria-label={t("legacy.floorplan.6")}>
        <defs>
          <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" className="hatch-ground" />
            <line x1="0" y1="0" x2="0" y2="7" className="hatch-line" />
          </pattern>
        </defs>
        {rooms.map((room) => {
          const box = layout[room.roomId]!;
          const count = confirmed[room.roomId] ?? 0;
          const state = room.unknown > 0 ? 'unanswered' : 'answered';
          const description = t('map.description', { room: authored(t, room.roomName), answered: room.answered, total: room.total, notSure: room.notSure, unanswered: room.unanswered, confirmed: count });
          return (
            <a key={room.roomId} href={`#room-${room.roomId}`} className="plan-room" data-state={state} aria-label={description}>
              <rect className="room-shape" x={box.x} y={box.y} width={box.w} height={box.h} />
              {room.roomId === 'stairs' ? Array.from({ length: 8 }, (_, index) => (
                <line key={index} className="stair-tread" x1={box.x + 6} x2={box.x + box.w - 6} y1={box.y + 50 + index * 8.5} y2={box.y + 50 + index * 8.5} />
              )) : null}
              <text className="room-label" x={box.x + 10} y={box.y + 21}>{authored(t, box.label)}</text>
              <text className="room-count" x={box.x + 10} y={box.y + 38}>{room.answered}/{room.total}</text>
              {count > 0 ? (
                <g className="room-flag">
                  <circle cx={box.x + box.w - 15} cy={box.y + box.h - 15} r="10" />
                  <text x={box.x + box.w - 15} y={box.y + box.h - 15} dy="0.35em" textAnchor="middle">{count}</text>
                </g>
              ) : null}
            </a>
          );
        })}
      </svg>
      <figcaption>
        <ul className="plan-legend">
          <li><span className="swatch swatch-hatch" aria-hidden="true" />{t("legacy.floorplan.8")}</li>
          <li><span className="swatch swatch-clear" aria-hidden="true" />{t("legacy.floorplan.9")}</li>
          <li><span className="swatch swatch-flag" aria-hidden="true" />{t("legacy.floorplan.10")}</li>
        </ul>
        <ul className="coverage-rooms">{rooms.map((room) => <li key={room.roomId}>{authored(t, room.roomName)}: {progressText(t, { answered: room.answered, total: room.total, notSure: room.notSure, unanswered: room.unanswered })}</li>)}</ul>
      </figcaption>
    </figure>
  );
}
