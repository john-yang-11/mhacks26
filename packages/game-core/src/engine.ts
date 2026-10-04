/**
 * Rising Waters rules. Pure functions over a plain, serializable GameState so the browser and the
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
import {
  BUILDINGS,
  CIVS,
  ECONOMY,
  EVENTS,
  GEOGRAPHY,
  RESEARCH,
  RISK,
  stock,
} from "./content";
import {
  damageBuildings,
  drawRegionalEvents,
  ensureHazard,
  eventLoss,
  productionPenalty,
  destructionProfile,
  profile,
  recover,
  recoveryCost,
  researchProtection,
  technologies,
  tickRecovery,
  upkeep,
} from "./disasters";
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
export const DOWNSTREAM = GEOGRAPHY.downstream;
export const DOWNWIND = GEOGRAPHY.downwind;
export const SHARED = GEOGRAPHY.shared;

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
export const builtCount = (civ: Civ, id: string) =>
  civ.buildings.filter((b) => b === id).length;
export const canBuild = (civ: Civ, id: string) =>
  !!BUILDINGS[id] &&
  !BUILDINGS[id].earned &&
  (!BUILDINGS[id].requires ||
    technologies(civ).includes(BUILDINGS[id].requires!)) &&
  (civ.actionsUsed ?? 0) < ECONOMY.actionsPerRound &&
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
        hazards: [],
        technologies: [],
        actionsUsed: 0,
        recent: [],
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

/** Each town draws this cycle's event, weighted by geography, climate and persistent damage. */
export function rollEvents(s: GameState) {
  if (s.phase === "ended") return;
  drawRegionalEvents(s, () => random(s));
  collapseFromTsunami(s);
}

/** A catastrophic wave is a terminal shared loss, independent of quiz or defenses. */
export function collapseFromTsunami(s: GameState) {
  if (s.collapseCause) return true;
  const origin = CIV_IDS.find(
    (c) =>
      s.events[c].type === "mega_tsunami" ||
      s.civs[c].hazards?.some((h) => h.type === "mega_tsunami"),
  );
  if (!origin) return false;
  s.collapseCause = { type: "mega_tsunami", origin, started: s.round };
  s.phase = "ended";
  s.outcome = "collapse";
  s.scheduled = [];
  s.minorEvents = {};
  for (const c of CIV_IDS) {
    const civ = s.civs[c];
    civ.eliminated = true;
    civ.buildings = [];
    civ.stock = stock();
    civ.technologies = [];
    civ.research = undefined;
    civ.productionCarry = {};
    civ.ready = true;
    civ.report = [
      "The catastrophic tsunami destroyed this civilization. No survivors remain; the world has collapsed.",
    ];
    s.news.push({ round: s.round, civ: c, text: civ.report[0] });
  }
  return true;
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
  if (collapseFromTsunami(s)) return s;
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
  if (
    a.type !== "exchange" &&
    a.type !== "ready" &&
    (civ.actionsUsed ?? 0) >= ECONOMY.actionsPerRound
  )
    return "No project actions left. Trade or end the round; projects refresh next round.";
  if (a.type === "research") {
    const tech = RESEARCH[a.technology];
    if (!tech) return "Unknown research.";
    if (civ.research) return "A research project is already in progress.";
    if (technologies(civ).includes(a.technology)) return "Already researched.";
    if (!tech.prerequisites.every((t) => technologies(civ).includes(t)))
      return "Complete the prerequisite research first.";
    if (!canAfford(civ.stock, tech.cost))
      return "Not enough resources for research.";
    return null;
  }
  if (a.type === "contain") {
    if (
      !(civ.hazards ?? []).some((h) => h.type === a.hazard) &&
      !civ.damageScars?.some((s) => s.type === a.hazard)
    )
      return "That hazard is no longer active.";
    if (!canAfford(civ.stock, recoveryCost(a.hazard)))
      return "Not enough resources for recovery.";
    return null;
  }
  if (a.type === "build") {
    const b = BUILDINGS[a.building];
    if (!b || b.earned) return "You can't build that.";
    if (b.requires && !technologies(civ).includes(b.requires))
      return `Research ${RESEARCH[b.requires].name} first.`;
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
    civ.actionsUsed = (civ.actionsUsed ?? 0) + 1;
  } else if (a.type === "research") {
    pay(civ.stock, RESEARCH[a.technology].cost);
    civ.research = {
      id: a.technology,
      remaining: RESEARCH[a.technology].turns,
    };
    civ.actionsUsed = (civ.actionsUsed ?? 0) + 1;
  } else if (a.type === "contain") {
    pay(civ.stock, recoveryCost(a.hazard));
    recover(civ, a.hazard);
    civ.actionsUsed = (civ.actionsUsed ?? 0) + 1;
    s.news.push({
      round: s.round,
      civ: a.civ,
      text: `${CIVS[a.civ].name} funded ${EVENTS[a.hazard].name.toLowerCase()} recovery; severity and recovery time fell.`,
    });
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
      if (s.outcome === "collapse") return s;
      for (const c of bots(s)) botBuild(s, c);
      s.phase = "build";
    }
  }
  if (s.phase === "build" && CIV_IDS.every((c) => s.civs[c].ready))
    s = endCycle(s);
  return s;
}

/** Apply this cycle's events: quiz and choice soften the losses; cheap choices land on neighbors. */
export function resolveEvents(s: GameState) {
  if (collapseFromTsunami(s)) return;
  const spills: {
    from: CivId;
    to: CivId;
    event: EventId;
    loss: Partial<Stock>;
  }[] = [];
  for (const c of CIV_IDS) {
    const civ = s.civs[c],
      ev = s.events[c],
      e = EVENTS[ev.type];
    const choice = civ.choice ?? 2;
    const h = ensureHazard(s, c, ev);
    let allowance = destructionProfile(ev.type).perRound;
    const report: string[] = [];
    const origin = ev.cause ?? ev.origin;
    if (origin && origin !== c) {
      report.push(
        `The pressure came from ${CIVS[origin].name}. ${ev.reason ?? "Connected water or wind carried the consequences here."}`,
      );
      s.news.push({
        round: s.round,
        civ: origin,
        text: `${EVENTS[ev.type].name} pressure from ${CIVS[origin].name} reached ${CIVS[c].name}; that town now needs recovery.`,
      });
    }
    const taken = lose(civ.stock, eventLoss(s, c, ev, choice));
    if (civ.quiz?.correct) {
      const beforeQuiz = eventLoss(s, c, ev, choice, false);
      const afterQuiz = eventLoss(s, c, ev, choice, true);
      const count = (x: Partial<Stock>) =>
        Object.values(x).reduce((n, v) => n + (v ?? 0), 0);
      if (count(beforeQuiz) > count(afterQuiz))
        report.push(
          "Your answer reduced potential goods losses; recovery is still needed.",
        );
      else {
        h.remaining = Math.max(1, h.remaining - 1);
        report.push(
          "Your answer prepared the recovery team: recovery finishes one round sooner.",
        );
      }
    }
    if (protectedFrom(civ, ev.type) || researchProtection(civ, ev.type))
      report.push("Existing defenses and research reduced exposure.");
    if (choice === 0) {
      s.climate += e.cheap.climate ?? 0;
      h.severity = Math.max(
        RISK.temporaryMinimumSeverity,
        h.severity - RISK.cheapSeverityReduction,
      );
      h.containment = RISK.cheapContainment;
      report.push(
        "Temporary containment reduced severity. Without recovery, this incident can grow again.",
      );
      if (e.cheap.spillTo && e.cheap.spill)
        spills.push({
          from: c,
          to: spillTarget(c, e.cheap.spillTo),
          event: ev.type,
          loss: e.cheap.spill,
        });
    } else if (choice === 1) {
      h.containment = RISK.greenContainment;
      h.severity = Math.max(
        RISK.minimumSeverity,
        h.severity - RISK.greenSeverityReduction,
      );
      h.remaining = Math.max(1, h.remaining - 1);
      if (e.green.build && !civ.buildings.includes(e.green.build))
        civ.buildings.push(e.green.build);
      report.push(
        e.green.label +
          ": " +
          (BUILDINGS[e.green.build!]?.name ?? "defenses") +
          ", lasting protection and shorter recovery.",
      );
    } else
      report.push(
        "No containment was funded. Severity may increase next round.",
      );
    const destroyed = damageBuildings(
      s,
      c,
      h,
      choice,
      () => random(s),
      allowance,
    );
    allowance -= destroyed.length;
    for (const id of destroyed)
      report.push(
        BUILDINGS[id].name +
          " was destroyed. Its production and points are gone; rebuild when reserves permit.",
      );
    report.unshift(
      e.name +
        ": " +
        (Object.keys(taken).length
          ? "lost " + describe(taken) + "."
          : "stored goods were spared, but production and recovery are affected."),
    );
    // Smaller pressures keep occurring while a major disaster is being managed.
    const minor = s.minorEvents?.[c];
    if (minor && minor.type !== ev.type) {
      const mh = ensureHazard(s, c, minor);
      const lost = lose(civ.stock, eventLoss(s, c, minor, 2, false));
      report.push(
        "Also: " +
          EVENTS[minor.type].name +
          " disrupted the region" +
          (Object.keys(lost).length ? " (lost " + describe(lost) + ")" : "") +
          ".",
      );
      const damaged = damageBuildings(s, c, mh, 2, () => random(s), allowance);
      allowance -= damaged.length;
      for (const id of damaged)
        report.push(
          BUILDINGS[id].name +
            " was destroyed by " +
            EVENTS[minor.type].name.toLowerCase() +
            ".",
        );
    }
    // Recovery effects apply even when they are not this round's featured dialogue.
    for (const old of civ.hazards ?? [])
      if (
        old.type !== ev.type &&
        old.type !== minor?.type &&
        old.severity >= 1.5
      ) {
        const r = profile(old.type).production[0] as Resource | undefined;
        const lost = r ? lose(civ.stock, { [r]: 1 }) : {};
        report.push(
          EVENTS[old.type].name +
            " recovery continues" +
            (Object.keys(lost).length
              ? ": lost " + describe(lost)
              : "; output remains disrupted") +
            ".",
        );
      }
    for (const scar of civ.damageScars ?? []) {
      if (
        scar.type !== "mega_tsunami" ||
        civ.hazards?.some((x) => x.type === scar.type)
      )
        continue;
      const coastalDamage = damageBuildings(
        s,
        c,
        { ...scar, origin: c, containment: 0, destroyed: scar.destroyed ?? 0 },
        choice,
        () => random(s),
        destructionProfile(scar.type).perRound,
      );
      if (coastalDamage.length)
        report.push(
          "Tsunami erosion destroyed " +
            coastalDamage.map((id) => BUILDINGS[id].name).join(", ") +
            ". Fund recovery to stabilize damaged ground.",
        );
    }
    report.push(
      "Recovery: " +
        h.remaining +
        " round(s), severity " +
        h.severity.toFixed(1) +
        ". Fund recovery in the build menu to shorten it.",
    );
    civ.report = report;
    s.news.push({
      round: s.round,
      civ: c,
      text:
        CIVS[c].name +
        ": " +
        report[0] +
        (destroyed.length
          ? " " +
            destroyed.map((id) => BUILDINGS[id].name).join(", ") +
            " destroyed."
          : ""),
    });
  }
  for (const sp of spills) {
    const taken = lose(s.civs[sp.to].stock, sp.loss);
    const ev = { type: sp.event, loss: sp.loss, severity: 1, origin: sp.from };
    const h = ensureHazard(s, sp.to, ev);
    h.severity = Math.min(
      RISK.maxSeverity,
      h.severity + RISK.spillSeverityIncrease,
    );
    const line =
      CIVS[sp.from].name +
      " pushed " +
      EVENTS[sp.event].name.toLowerCase() +
      " pressure onto us: " +
      (Object.keys(taken).length
        ? "lost " + describe(taken)
        : "production was disrupted") +
      "; recovery is needed.";
    s.civs[sp.to].report.push(line);
    s.news.push({ round: s.round, civ: sp.to, text: line });
  }
  s.climate = round2(Math.max(0, s.climate));
}

/** Production, pollution, then the next cycle's events (or the end of the game). */
export function cycleClimate(s: GameState) {
  let delta = CLIMATE_DRIFT;
  for (const c of CIV_IDS) {
    const civ = s.civs[c];
    const clean = civ.buildings.includes("windmill");
    const researchFactor = technologies(civ).reduce(
      (n, t) => n * (RESEARCH[t]?.emissions ?? 1),
      1,
    );
    for (const b of civ.buildings) {
      const def = BUILDINGS[b];
      if (!def?.climate) continue;
      delta += def.dirty
        ? def.climate * (clean ? 0.5 : 1) * researchFactor
        : def.climate;
    }
  }
  return delta;
}
function output(s: GameState, c: CivId): Stock {
  const out = stock(CIVS[c].base);
  const civ = s.civs[c];
  const copies: Record<string, number> = {};
  for (const b of civ.buildings) {
    copies[b] = (copies[b] ?? 0) + 1;
    const factor =
      copies[b] > ECONOMY.diminishingCopies
        ? ECONOMY.secondaryYieldMultiplier
        : 1;
    for (const r of RESOURCES)
      out[r] += (BUILDINGS[b]?.yields?.[r] ?? 0) * factor;
  }
  for (const id of technologies(civ))
    for (const r of RESOURCES) out[r] += RESEARCH[id]?.yields?.[r] ?? 0;
  for (const r of RESOURCES)
    out[r] = Math.max(0, out[r] * (1 - productionPenalty(civ, r)));
  return out;
}
/** Fractional output carries forward, so a small disruption does not erase a one-unit farm forever. */
export function income(s: GameState, c: CivId): Stock {
  if (s.civs[c].eliminated) return stock();
  const out = output(s, c);
  for (const r of RESOURCES)
    out[r] = Math.floor(out[r] + (s.civs[c].productionCarry?.[r] ?? 0));
  return out;
}
function endCycle(state: GameState): GameState {
  const s = state;
  for (const c of CIV_IDS) {
    const add = income(s, c);
    const raw = output(s, c);
    s.civs[c].productionCarry ??= {};
    for (const r of RESOURCES)
      s.civs[c].productionCarry![r] = round2(
        raw[r] + (s.civs[c].productionCarry![r] ?? 0) - add[r],
      );
    for (const r of RESOURCES) s.civs[c].stock[r] += add[r];
    const civ = s.civs[c];
    const cost = upkeep(civ);
    const short = RESOURCES.filter((r) => civ.stock[r] < cost[r]);
    const paid = lose(civ.stock, cost);
    if (short.length) {
      civ.hardship = (civ.hardship ?? 0) + ECONOMY.emergencyPenalty;
      for (const r of RESOURCES)
        civ.stock[r] += (ECONOMY.emergencyAid as Partial<Stock>)[r] ?? 0;
      s.news.push({
        round: s.round,
        civ: c,
        text: `Food or maintenance shortage (${short.join(", ")}). Emergency wheat keeps recovery possible; prosperity −${ECONOMY.emergencyPenalty}. Build food production or trade before expanding.`,
      });
    }
    const overflow = stock();
    for (const r of RESOURCES) {
      overflow[r] = Math.max(0, civ.stock[r] - ECONOMY.storageCapacity);
      civ.stock[r] = Math.min(ECONOMY.storageCapacity, civ.stock[r]);
    }
    s.news.push({
      round: s.round,
      civ: c,
      text: `Production: ${describe(add)}. Upkeep: ${describe(paid)}.${RESOURCES.some((r) => overflow[r]) ? ` Storage full: ${describe(overflow)} redistributed.` : ""}`,
    });
    tickRecovery(s, c);
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
    civ.actionsUsed = 0;
  }
  rollEvents(s);
  if (!s.collapseCause) s.phase = "event";
  return s;
}

// ---------- scoring ----------
export function score(s: GameState, c: CivId) {
  const civ = s.civs[c];
  const buildings = civ.buildings.reduce(
    (n, b) => n + (BUILDINGS[b]?.points ?? 1),
    0,
  );
  return Math.max(
    0,
    buildings + technologies(civ).length - (civ.hardship ?? 0),
  );
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
  const emergency = [...(civ.hazards ?? [])]
    .sort((a, b) => b.severity - a.severity)
    .find((h) => h.severity >= 1 && canAfford(civ.stock, recoveryCost(h.type)));
  if (emergency) {
    pay(civ.stock, recoveryCost(emergency.type));
    recover(civ, emergency.type);
    civ.actionsUsed = (civ.actionsUsed ?? 0) + 1;
  }
  if (!civ.research && (civ.actionsUsed ?? 0) < ECONOMY.actionsPerRound) {
    const id = Object.keys(RESEARCH).find(
      (t) =>
        !technologies(civ).includes(t) &&
        RESEARCH[t].prerequisites.every((p) => technologies(civ).includes(p)) &&
        canAfford(civ.stock, RESEARCH[t].cost),
    );
    if (id) {
      pay(civ.stock, RESEARCH[id].cost);
      civ.research = { id, remaining: RESEARCH[id].turns };
      civ.actionsUsed = (civ.actionsUsed ?? 0) + 1;
    }
  }
  for (let n = civ.actionsUsed ?? 0; n < ECONOMY.actionsPerRound; n++) {
    const priorities =
      income(s, c).wheat <= upkeep(civ).wheat
        ? ["farm", ...BUILD_ORDER[c]]
        : BUILD_ORDER[c];
    let id = priorities.find((b) => canBuild(civ, b));
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
    civ.actionsUsed = (civ.actionsUsed ?? 0) + 1;
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
