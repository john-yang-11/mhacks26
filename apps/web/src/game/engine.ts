/**
 * Earthshare rules. Pure functions over a plain, serializable GameState so the browser and the
 * SpacetimeDB module run the exact same game.
 *
 * Each cycle (one decade):
 *   event  — every town is struck by an event; the narrator tells it
 *   quiz   — everyone answers one question about their event (right answer = smaller losses)
 *   response — an affected neighbor explains how the player's decision reaches them
 *   choice — cheap now (pollutes, or pushes the damage onto a neighbor) vs sustainable
 *            (costs more, protects you from then on)
 *   build  — spend sheep, wheat, wood, brick and ore; then end the turn
 * After 10 cycles, or once warming reaches +3°C, the game ends.
 */
import { clone } from "./clone";
import { BUILDINGS, CIVS, EVENTS, stock } from "./content";
import { QUESTIONS } from "./questions";
import {
  CIV_IDS,
  RESOURCES,
  type Action,
  type Civ,
  type CivId,
  type EventId,
  type GameState,
  type Question,
  type Resource,
  type Stock,
} from "./types";

export const ROUNDS = 10;
export const CLIMATE_LOSS = 3;
export const QUIZ_MS = 20_000;
export const EXCHANGE_RATE = 3;
const CLIMATE_DRIFT = 0.05;
const START_CLIMATE = 0.4;

// ---------- geography: who your choices land on ----------
export const DOWNSTREAM: Record<CivId, CivId[]> = {
  heartland: ["enclave", "petrostate"],
  enclave: ["archipelago"],
  petrostate: ["archipelago"],
  archipelago: [],
};
export const DOWNWIND: Record<CivId, CivId> = {
  petrostate: "heartland",
  heartland: "enclave",
  enclave: "archipelago",
  archipelago: "petrostate",
};
/** Shared aquifer (Highland–Forge) and shared coast (Verdant–Tidehaven). */
export const SHARED: Record<CivId, CivId> = {
  heartland: "petrostate",
  petrostate: "heartland",
  enclave: "archipelago",
  archipelago: "enclave",
};
const upstream = (c: CivId) => CIV_IDS.filter((u) => DOWNSTREAM[u].includes(c));
const upwind = (c: CivId) => CIV_IDS.filter((u) => DOWNWIND[u] === c);

// ---------- helpers ----------
export function random(s: GameState): number {
  // mulberry32, state kept in s.rng
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
export const canAfford = (have: Stock, cost: Partial<Stock>) =>
  RESOURCES.every((r) => have[r] >= (cost[r] ?? 0));
function pay(have: Stock, cost: Partial<Stock>) {
  for (const r of RESOURCES) have[r] -= cost[r] ?? 0;
}
function lose(have: Stock, loss: Partial<Stock>): Partial<Stock> {
  const taken: Partial<Stock> = {};
  for (const r of RESOURCES) {
    const n = Math.min(have[r], loss[r] ?? 0);
    if (n > 0) {
      have[r] -= n;
      taken[r] = n;
    }
  }
  return taken;
}
export const describe = (amounts: Partial<Stock>) =>
  RESOURCES.filter((r) => (amounts[r] ?? 0) > 0)
    .map((r) => `${amounts[r]} ${r}`)
    .join(", ") || "nothing";
const halve = (loss: Partial<Stock>): Partial<Stock> =>
  Object.fromEntries(
    Object.entries(loss).map(([r, n]) => [r, Math.floor((n ?? 0) / 2)]),
  );
export const builtCount = (civ: Civ, id: string) =>
  civ.buildings.filter((b) => b === id).length;
export const canBuild = (civ: Civ, id: string) =>
  !BUILDINGS[id].earned &&
  builtCount(civ, id) < (BUILDINGS[id].max ?? Infinity) &&
  canAfford(civ.stock, BUILDINGS[id].cost);
export const protectedFrom = (civ: Civ, event: EventId) =>
  civ.buildings.some((b) => BUILDINGS[b]?.protects?.includes(event));

/** Where a cheap choice pushes the damage. */
export function spillTarget(
  civ: CivId,
  to: "downstream" | "downwind" | "shared",
) {
  if (to === "downwind") return DOWNWIND[civ];
  if (to === "downstream" && DOWNSTREAM[civ].length) return DOWNSTREAM[civ][0];
  return SHARED[civ];
}

/** The neighbor who responds to this town's event, even when the cheap option heats the planet. */
export function responseTarget(s: GameState, civ: CivId): CivId {
  const e = EVENTS[s.events[civ].type];
  if (e.cheap.spillTo) return spillTarget(civ, e.cheap.spillTo);
  if (e.carrier === "wind") return DOWNWIND[civ];
  if (e.carrier === "river" && DOWNSTREAM[civ].length)
    return DOWNSTREAM[civ][0];
  return SHARED[civ];
}

// ---------- setup ----------
export function createGame(
  player: CivId = "heartland",
  mode: "solo" | "hotseat" = "solo",
  seed = 260926,
  humans: CivId[] = mode === "solo" ? [player] : [...CIV_IDS],
): GameState {
  const civs = Object.fromEntries(
    CIV_IDS.map((id) => [
      id,
      {
        id,
        stock: stock(CIVS[id].start),
        buildings: [...CIVS[id].buildings],
        ready: false,
        asked: [],
        report: [],
      } satisfies Civ,
    ]),
  ) as unknown as Record<CivId, Civ>;
  const s: GameState = {
    version: 2,
    seed,
    rng: seed >>> 0,
    round: 1,
    phase: "event",
    mode,
    player,
    humans: [...humans],
    civs,
    events: {} as GameState["events"],
    climate: START_CLIMATE,
    history: [{ round: 0, climate: START_CLIMATE }],
    news: [],
  };
  rollEvents(s);
  return s;
}

/** Each town draws this cycle's event, weighted by its geography, the climate and its neighbors. */
export function rollEvents(s: GameState) {
  for (const c of CIV_IDS) {
    const options = (Object.keys(EVENTS) as EventId[]).flatMap((id) => {
      const e = EVENTS[id];
      if (e.chainFrom?.length) return [];
      let w = e.regions[c] ?? 0;
      if (!w) return [];
      if (e.climateDriven) w *= 1 + s.climate / 1.5;
      const senders = e.carrier === "wind" ? upwind(c) : upstream(c);
      const count = (x: CivId) =>
        s.civs[x].buildings.filter((b) => b === e.cause).length;
      if (e.cause) w *= 1 + 0.5 * senders.reduce((n, x) => n + count(x), 0);
      return [{ id, w }];
    });
    const total = options.reduce((n, o) => n + o.w, 0);
    let roll = random(s) * total;
    const pick = options.find((o) => (roll -= o.w) < 0) ?? options[0];
    let pickedId = pick.id;
    const chained = (Object.keys(EVENTS) as EventId[]).filter((id) => {
      const chain = EVENTS[id];
      return (
        (chain.regions[c] ?? 0) > 0 &&
        chain.chainFrom?.includes(pick.id) &&
        random(s) < (chain.chainChance ?? 0)
      );
    });
    if (chained.length) pickedId = chained[0];
    const e = EVENTS[pickedId];
    const loss = { ...e.loss };
    if (e.climateDriven && s.climate >= 1.5) {
      // A hotter world hits harder: +1 to the biggest loss.
      const top = RESOURCES.reduce((a, r) =>
        (loss[r] ?? 0) > (loss[a] ?? 0) ? r : a,
      );
      loss[top] = (loss[top] ?? 0) + 1;
    }
    const senders = e.carrier === "wind" ? upwind(c) : upstream(c);
    const cause = e.cause
      ? senders
          .filter((x) => s.civs[x].buildings.includes(e.cause!))
          .sort(
            (a, b) =>
              s.civs[b].buildings.filter((x) => x === e.cause).length -
              s.civs[a].buildings.filter((x) => x === e.cause).length,
          )[0]
      : undefined;
    s.events[c] = { type: pickedId, cause, loss };
  }
}

// ---------- quiz ----------
export function questionFor(s: GameState, civ: CivId): Question | undefined {
  const id = s.civs[civ].quiz?.questionId;
  return QUESTIONS.find((q) => q.id === id);
}
function pickQuestion(s: GameState, civ: CivId) {
  const types = EVENTS[s.events[civ].type].quizTypes;
  const pool = QUESTIONS.filter((q) => q.types.some((t) => types.includes(t)));
  const fresh = pool.filter((q) => !s.civs[civ].asked.includes(q.id));
  const from = fresh.length ? fresh : pool;
  const q = from[Math.floor(random(s) * from.length)];
  s.civs[civ].asked.push(q.id);
  s.civs[civ].quiz = { questionId: q.id };
}

/** Event phase → quiz phase (the narrator has told everyone their event). */
export function advance(state: GameState): GameState {
  if (state.phase !== "event") return state;
  const s = clone(state);
  for (const c of CIV_IDS) pickQuestion(s, c);
  s.phase = "quiz";
  return progress(s);
}

/** Answer your quiz. `option` −1 means the timer ran out. */
export function answerQuiz(
  state: GameState,
  civ: CivId,
  option: number,
  ms: number,
): GameState {
  const q = questionFor(state, civ);
  if (
    state.phase !== "quiz" ||
    !q ||
    state.civs[civ].quiz?.option !== undefined
  )
    return state;
  const s = clone(state);
  const correct = option === q.correct && ms <= QUIZ_MS;
  s.civs[civ].quiz = { questionId: q.id, option, correct, ms };
  return progress(s);
}

// ---------- actions ----------
export function choiceCost(s: GameState, civ: CivId, option: 0 | 1 | 2) {
  const e = EVENTS[s.events[civ].type];
  return option === 0 ? e.cheap.cost : option === 1 ? e.green.cost : {};
}
export function actionError(s: GameState, a: Action): string | null {
  const civ = s.civs[a.civ];
  if (!civ) return "Unknown civilization.";
  if (a.type === "acknowledge") {
    if (s.phase !== "response") return "There is no response to acknowledge.";
    if (civ.responded) return "You already heard this response.";
    return null;
  }
  if (a.type === "choose") {
    if (s.phase !== "choice") return "It isn't time to choose.";
    if (civ.choice !== undefined) return "You already chose.";
    if (![0, 1, 2].includes(a.option)) return "Unknown option.";
    if (!canAfford(civ.stock, choiceCost(s, a.civ, a.option)))
      return "You can't afford that option.";
    return null;
  }
  if (s.phase !== "build") return "It isn't time to build.";
  if (civ.ready) return "Your turn is already over.";
  if (a.type === "build") {
    const b = BUILDINGS[a.building];
    if (!b || b.earned) return "You can't build that.";
    if (builtCount(civ, a.building) >= (b.max ?? Infinity))
      return `Your town has room for only ${b.max} of those.`;
    if (!canAfford(civ.stock, b.cost)) return "Not enough resources.";
    return null;
  }
  if (a.type === "exchange") {
    if (a.give === a.get) return "Pick two different resources.";
    if (civ.stock[a.give] < EXCHANGE_RATE)
      return `You need ${EXCHANGE_RATE} ${a.give} to exchange.`;
    return null;
  }
  return null;
}
export function applyAction(
  state: GameState,
  a: Action,
): { state: GameState; error?: string } {
  const error = actionError(state, a);
  if (error) return { state, error };
  const s = clone(state);
  const civ = s.civs[a.civ];
  if (a.type === "acknowledge") {
    civ.responded = true;
  } else if (a.type === "choose") {
    pay(civ.stock, choiceCost(s, a.civ, a.option));
    civ.choice = a.option;
  } else if (a.type === "build") {
    pay(civ.stock, BUILDINGS[a.building].cost);
    civ.buildings.push(a.building);
  } else if (a.type === "exchange") {
    civ.stock[a.give] -= EXCHANGE_RATE;
    civ.stock[a.get] += 1;
    recordTrade(s, a.civ, a.give, a.get);
  } else if (a.type === "ready") {
    civ.ready = true;
  }
  return { state: progress(s) };
}

// ---------- phase transitions ----------
function recordTrade(s: GameState, civ: CivId, give: Resource, get: Resource) {
  s.news.push({
    round: s.round,
    civ,
    kind: "trade",
    give,
    get,
    text: `${CIVS[civ].name} shipped ${EXCHANGE_RATE} ${give} for 1 ${get}.`,
  });
}

const bots = (s: GameState) => CIV_IDS.filter((c) => !s.humans.includes(c));

/** Fill in AI neighbors and move to the next phase once every person is done. */
export function progress(state: GameState): GameState {
  let s = state;
  if (s.phase === "quiz") {
    for (const c of bots(s))
      if (s.civs[c].quiz?.option === undefined) botQuiz(s, c);
    if (CIV_IDS.every((c) => s.civs[c].quiz?.option !== undefined))
      s.phase = "response";
  }
  if (s.phase === "response") {
    for (const c of bots(s)) s.civs[c].responded = true;
    if (CIV_IDS.every((c) => s.civs[c].responded)) s.phase = "choice";
  }
  if (s.phase === "choice") {
    for (const c of bots(s))
      if (s.civs[c].choice === undefined) botChoice(s, c);
    if (CIV_IDS.every((c) => s.civs[c].choice !== undefined)) {
      resolveEvents(s);
      for (const c of bots(s)) botBuild(s, c);
      s.phase = "build";
    }
  }
  if (s.phase === "build" && CIV_IDS.every((c) => s.civs[c].ready))
    s = endCycle(s);
  return s;
}

/** Apply this cycle's events: quiz and choice soften the losses; cheap choices land on neighbors. */
function resolveEvents(s: GameState) {
  const spills: {
    from: CivId;
    to: CivId;
    loss: Partial<Stock>;
    event: EventId;
  }[] = [];
  for (const c of CIV_IDS) {
    const civ = s.civs[c];
    const ev = s.events[c];
    const e = EVENTS[ev.type];
    let loss = { ...ev.loss };
    const report: string[] = [];
    if (civ.quiz?.correct) {
      for (const r of RESOURCES)
        if (loss[r]) loss[r] = Math.max(0, loss[r]! - 1);
      report.push("Your quick answer softened the blow.");
    }
    if (protectedFrom(civ, ev.type)) {
      loss = halve(loss);
      report.push("Defenses you built before halved the damage.");
    }
    const choice = civ.choice;
    if (choice === 0) {
      loss = {};
      s.climate += e.cheap.climate ?? 0;
      if (e.cheap.spillTo && e.cheap.spill) {
        const to = spillTarget(c, e.cheap.spillTo);
        spills.push({ from: c, to, loss: e.cheap.spill, event: ev.type });
        report.push(
          `${e.cheap.label}: no losses here, but ${CIVS[to].name} takes ${describe(e.cheap.spill)}.`,
        );
      } else if (e.cheap.climate)
        report.push(
          `${e.cheap.label}: no losses here, but warming rose +${e.cheap.climate}°C.`,
        );
    } else if (choice === 1) {
      loss = halve(loss);
      if (e.green.build) civ.buildings.push(e.green.build);
      report.push(
        `${e.green.label}: you built ${BUILDINGS[e.green.build!]?.name ?? "defenses"}.`,
      );
    }
    const taken = lose(civ.stock, loss);
    report.unshift(`${e.name}: you lost ${describe(taken)}.`);
    civ.report = report;
    s.news.push({
      round: s.round,
      civ: c,
      kind: "event",
      event: ev.type,
      option: civ.choice,
      text: `${CIVS[c].name}: ${e.name.toLowerCase()} arrived by ${e.carrier}${ev.cause ? ` from ${CIVS[ev.cause].name}` : ""}; lost ${describe(taken)}.`,
    });
  }
  for (const sp of spills) {
    const taken = lose(s.civs[sp.to].stock, sp.loss);
    const line = `${CIVS[sp.from].name} pushed their ${EVENTS[sp.event].name.toLowerCase()} onto us: we lost ${describe(taken)}.`;
    s.civs[sp.to].report.push(line);
    s.news.push({
      round: s.round,
      civ: sp.to,
      kind: "spill",
      event: sp.event,
      from: sp.from,
      text: line,
    });
  }
  s.climate = round2(Math.max(0, s.climate));
}

/** Production, pollution, then the next cycle's events (or the end of the game). */
export function cycleClimate(s: GameState) {
  let delta = CLIMATE_DRIFT;
  for (const c of CIV_IDS) {
    const civ = s.civs[c];
    const clean = civ.buildings.includes("windmill");
    for (const b of civ.buildings) {
      const def = BUILDINGS[b];
      if (!def?.climate) continue;
      delta += def.dirty && clean ? def.climate / 2 : def.climate;
    }
  }
  return delta;
}
export function income(s: GameState, c: CivId): Stock {
  const out = stock(CIVS[c].base);
  for (const b of s.civs[c].buildings)
    for (const r of RESOURCES) out[r] += BUILDINGS[b]?.yields?.[r] ?? 0;
  return out;
}
function endCycle(state: GameState): GameState {
  const s = state;
  for (const c of CIV_IDS) {
    const add = income(s, c);
    for (const r of RESOURCES) s.civs[c].stock[r] += add[r];
  }
  s.climate = round2(Math.max(0, s.climate + cycleClimate(s)));
  s.history.push({ round: s.round, climate: s.climate });
  if (s.climate >= CLIMATE_LOSS || s.round >= ROUNDS) {
    s.phase = "ended";
    s.outcome = s.climate >= CLIMATE_LOSS ? "collapse" : "survived";
    return s;
  }
  s.round += 1;
  for (const c of CIV_IDS) {
    const civ = s.civs[c];
    civ.quiz = undefined;
    civ.responded = undefined;
    civ.choice = undefined;
    civ.ready = false;
  }
  rollEvents(s);
  s.phase = "event";
  return s;
}

// ---------- scoring ----------
export function score(s: GameState, c: CivId) {
  const civ = s.civs[c];
  const buildings = civ.buildings.reduce(
    (n, b) => n + (BUILDINGS[b]?.points ?? 1),
    0,
  );
  return buildings;
}
export const greenCount = (s: GameState, c: CivId) =>
  s.civs[c].buildings.filter((b) => BUILDINGS[b]?.green).length;

// ---------- AI neighbors ----------
const CHEAP_BIAS: Record<CivId, number> = {
  petrostate: 0.65,
  heartland: 0.45,
  archipelago: 0.3,
  enclave: 0.25,
};
const BUILD_ORDER: Record<CivId, string[]> = {
  heartland: [
    "house",
    "pasture",
    "mine",
    "grove",
    "windmill",
    "farm",
    "lumber",
    "kiln",
  ],
  enclave: [
    "house",
    "grove",
    "farm",
    "pasture",
    "lumber",
    "windmill",
    "kiln",
    "mine",
  ],
  petrostate: [
    "house",
    "kiln",
    "mine",
    "lumber",
    "farm",
    "pasture",
    "windmill",
    "grove",
  ],
  archipelago: [
    "house",
    "farm",
    "pasture",
    "kiln",
    "grove",
    "windmill",
    "lumber",
    "mine",
  ],
};
function botQuiz(s: GameState, c: CivId) {
  const q = questionFor(s, c)!;
  const correct = random(s) < 0.6;
  const option = correct ? q.correct : (q.correct + 1) % q.options.length;
  s.civs[c].quiz = { questionId: q.id, option, correct, ms: 8000 };
}
function botChoice(s: GameState, c: CivId) {
  const civ = s.civs[c];
  const bias = CHEAP_BIAS[c] - (s.climate > 2 ? 0.2 : 0);
  const want: 0 | 1 = random(s) < bias ? 0 : 1;
  for (const o of [want, (1 - want) as 0 | 1, 2 as const])
    if (canAfford(civ.stock, choiceCost(s, c, o))) {
      pay(civ.stock, choiceCost(s, c, o));
      civ.choice = o;
      return;
    }
}
function botBuild(s: GameState, c: CivId) {
  const civ = s.civs[c];
  for (let n = 0; n < 3; n++) {
    let id = BUILD_ORDER[c].find((b) => canBuild(civ, b));
    if (!id) {
      // Trade a surplus 3:1 toward the first thing on the wish list.
      const wish = BUILD_ORDER[c].find((b) =>
        canBuild(
          {
            ...civ,
            stock: { sheep: 99, wheat: 99, wood: 99, brick: 99, ore: 99 },
          },
          b,
        ),
      );
      if (!wish) break;
      const goal = BUILDINGS[wish].cost;
      const need = RESOURCES.find((r) => civ.stock[r] < (goal[r] ?? 0));
      const spare = RESOURCES.filter((r) => r !== need).sort(
        (a, b) => civ.stock[b] - civ.stock[a],
      )[0];
      if (need && civ.stock[spare] >= EXCHANGE_RATE + (goal[spare] ?? 0)) {
        civ.stock[spare] -= EXCHANGE_RATE;
        civ.stock[need] += 1;
        recordTrade(s, c, spare, need);
        id = BUILD_ORDER[c].find((b) => canBuild(civ, b));
      }
    }
    if (!id) break;
    pay(civ.stock, BUILDINGS[id].cost);
    civ.buildings.push(id);
  }
  civ.ready = true;
}

/** Let AI play every seat to the end (used by tests and balance checks). */
export function autoplay(state: GameState): GameState {
  let s = clone(state);
  s.humans = [];
  for (let guard = 0; s.phase !== "ended" && guard < 100; guard++) {
    if (s.phase === "event") s = advance(s);
    else s = progress(s);
  }
  return s;
}

export type { Resource };
