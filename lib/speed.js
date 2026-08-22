/**
 * Session-scoped Codex response speed state.
 *
 * The UI calls the user-facing value `fast`; the Codex Responses wire value is
 * `priority`. The state itself lives in the durable session log so it survives
 * resume and can be projected to every client surface.
 *
 * @module dsh-codex/speed
 */

export const SPEED_EVENT = "codex/speed";
export const SPEED_PROJECTION_KEY = "codexSpeed";
export const DEFAULT_SPEED = "standard";
export const FAST_MODE_SERVICE_TIER = "priority";

export const SPEED_VALUES = Object.freeze(["standard", "fast"]);
export const SPEED_LABELS = Object.freeze({
  standard: "Standard",
  fast: "Fast",
});

const SPEED_OPTIONS = Object.freeze(
  SPEED_VALUES.map((value) => Object.freeze({ value, name: SPEED_LABELS[value] })),
);
const SPEED_SET = new Set(SPEED_VALUES);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize a user or event value into one supported speed. */
export function normalizeSpeed(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "standard" || normalized === "default" || normalized === "normal") return "standard";
  if (normalized === "fast") return "fast";
  return undefined;
}

/** Read the latest valid speed event from a session log. */
export function speedFromEvents(events) {
  if (!Array.isArray(events)) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== SPEED_EVENT) continue;
    const speed = normalizeSpeed(event.data?.speed);
    if (speed !== undefined) return speed;
  }
  return undefined;
}

function parseProjection(value) {
  if (!isObject(value) || !SPEED_SET.has(value.currentValue) || !Array.isArray(value.options)) {
    throw new TypeError("dsh-codex speed projection has an invalid shape");
  }
  for (const option of value.options) {
    if (!isObject(option) || !SPEED_SET.has(option.value) || typeof option.name !== "string" || option.name.length === 0) {
      throw new TypeError("dsh-codex speed projection has an invalid option");
    }
  }
  return {
    currentValue: value.currentValue,
    options: value.options.map((option) => ({ value: option.value, name: option.name })),
  };
}

/** Session projection consumed by the Web UI when the projection service exists. */
export const codexSpeedProjection = {
  key: SPEED_PROJECTION_KEY,
  schema: { parse: parseProjection },
  init: () => ({ speed: DEFAULT_SPEED }),
  apply: (state, event) => {
    if (event?.type !== SPEED_EVENT) return state;
    const speed = normalizeSpeed(event.data?.speed);
    return speed === undefined ? state : { speed };
  },
  view: (state) => ({
    currentValue: SPEED_SET.has(state?.speed) ? state.speed : DEFAULT_SPEED,
    options: SPEED_OPTIONS,
  }),
  stateVersion: 1,
};

/** Append one whole-value speed event only when it changes the session state. */
export function setAgentSpeed(agent, speed) {
  const normalized = normalizeSpeed(speed);
  if (normalized === undefined) throw new Error("dsh-codex speed must be standard or fast");
  if (agent?.session === undefined || !Array.isArray(agent.session.events)) {
    throw new Error("dsh-codex speed requires a live session agent");
  }
  if (speedFromEvents(agent.session.events) !== normalized) {
    agent.session.append(SPEED_EVENT, { speed: normalized });
  }
  return normalized;
}

export function speedLabel(speed) {
  const normalized = normalizeSpeed(speed) ?? DEFAULT_SPEED;
  return SPEED_LABELS[normalized];
}

export { SPEED_OPTIONS };
