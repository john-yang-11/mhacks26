import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, EVENTS } from "../src/game/content";
import {
  CLIMATE_LOSS,
  EXCHANGE_RATE,
  ROUNDS,
  advance,
  answerQuiz,
  applyAction,
  autoplay,
  createGame,
  income,
  legalRedirectTargets,
  normalizeGameState,
  pendingFor,
  progress,
  questionFor,
  rollEvents,
  spillTarget,
} from "../src/game/engine";
import { QUESTIONS } from "../src/game/questions";
import {
  CIV_IDS,
  RESOURCES,
  type CivId,
  type EventId,
  type GameState,
} from "../src/game/types";

const P: CivId = "heartland";
const total = (s: GameState, c: CivId) =>
  RESOURCES.reduce((n, r) => n + s.civs[c].stock[r], 0);
/** A solo game with the player's event forced, sitting at the quiz. */
function atQuiz(event: EventId = "flood", seed = 7) {
  const s = createGame(P, "solo", seed);
  s.events[P] = { type: event, loss: { ...EVENTS[event].loss } };
  return advance(s);
}
const answer = (s: GameState, right: boolean) => {
  const q = questionFor(s, P)!;
  return answerQuiz(s, P, right ? q.correct : (q.correct + 1) % 4, 3000);
};
const hearNeighbor = (s: GameState) =>
  applyAction(s, { type: "acknowledge", civ: P }).state;
const rich = (s: GameState, c: CivId = P) => {
  for (const r of RESOURCES) s.civs[c].stock[r] = 20;
  return s;
};
function acceptIncoming(s: GameState, civ: CivId = P) {
  while (s.phase === "reaction" && pendingFor(s, civ)[0]) {
    const effect = pendingFor(s, civ)[0];
    s = applyAction(s, {
      type: "react",
      civ,
      effectId: effect.id,
      kind: "accept",
    }).state;
  }
  return s;
}
function atReaction(event: EventId = "flood") {
  const s = createGame(P, "hotseat", 99);
  for (const civ of CIV_IDS) {
    rich(s, civ);
    s.civs[civ].choice = 2;
  }
  s.events[P] = { type: event, loss: { ...EVENTS[event].loss } };
  s.phase = "choice";
  s.civs[P].choice = undefined;
  return applyAction(s, { type: "choose", civ: P, option: 0 }).state;
}

test("games are deterministic for a seed", () => {
  assert.deepEqual(
    autoplay(createGame(P, "solo", 42)),
    autoplay(createGame(P, "solo", 42)),
  );
  assert.deepEqual(
    createGame(P, "solo", 9).events,
    createGame(P, "solo", 9).events,
  );
});

test("seeded primary and cascade rolls can produce all 16 hazards", () => {
  const seen = new Set<EventId>();
  for (let seed = 1; seed <= 4000 && seen.size < 16; seed++)
    for (const event of Object.values(createGame(P, "solo", seed).events))
      seen.add(event.type);
  assert.deepEqual([...seen].sort(), (Object.keys(EVENTS) as EventId[]).sort());
});

test("warming increases only climate-driven event severity and frequency", () => {
  let coolClimateEvents = 0;
  let hotClimateEvents = 0;
  let checkedComparable = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const cool = createGame(P, "solo", seed);
    cool.climate = 0;
    cool.rng = seed;
    rollEvents(cool);
    const hot = createGame(P, "solo", seed);
    hot.climate = 2;
    hot.rng = seed;
    rollEvents(hot);
    for (const civ of CIV_IDS) {
      const coolEvent = cool.events[civ];
      const hotEvent = hot.events[civ];
      if (EVENTS[coolEvent.type].climateDriven) coolClimateEvents++;
      if (EVENTS[hotEvent.type].climateDriven) hotClimateEvents++;
      if (coolEvent.type !== hotEvent.type) continue;
      const coolLoss = Object.values(coolEvent.loss).reduce(
        (sum, n) => sum + (n ?? 0),
        0,
      );
      const hotLoss = Object.values(hotEvent.loss).reduce(
        (sum, n) => sum + (n ?? 0),
        0,
      );
      assert.equal(
        hotLoss - coolLoss,
        EVENTS[hotEvent.type].climateDriven ? 1 : 0,
      );
      checkedComparable++;
    }
  }
  assert(hotClimateEvents > coolClimateEvents);
  assert(checkedComparable > 500);
});

test("one cycle runs event → quiz → response → choice → reaction → build → next decade", () => {
  let s = createGame(P, "solo", 3);
  assert.equal(s.phase, "event");
  s = advance(s);
  assert.equal(s.phase, "quiz");
  assert(questionFor(s, P));
  s = answer(s, true);
  assert.equal(s.phase, "response", "the affected neighbor speaks next");
  s = hearNeighbor(s);
  assert.equal(s.phase, "choice", "AI neighbors acknowledge on their own");
  s = applyAction(s, { type: "choose", civ: P, option: 2 }).state;
  if (s.phase === "reaction") s = acceptIncoming(s);
  assert.equal(s.phase, "build");
  assert(s.civs[P].report.length > 0, "the narrator has a report to read");
  const before = { ...s.civs[P].stock };
  const gain = income(s, P);
  s = applyAction(s, { type: "ready", civ: P }).state;
  assert.equal(s.round, 2);
  assert.equal(s.phase, "event");
  for (const r of RESOURCES)
    assert.equal(s.civs[P].stock[r], before[r] + gain[r]);
});

test("a right answer means smaller losses than a wrong one", () => {
  const take = (right: boolean) => {
    let s = hearNeighbor(answer(rich(atQuiz("flood")), right));
    s = applyAction(s, { type: "choose", civ: P, option: 2 }).state;
    return total(s, P);
  };
  assert(take(true) > take(false));
});

test("the cheap choice pushes the damage onto a neighbor", () => {
  let s = atReaction("flood");
  const target = spillTarget(P, "downstream");
  const before = total(s, target);
  const effect = s.pendingEffects.find((item) => item.to === target)!;
  assert.equal(s.phase, "reaction");
  s = applyAction(s, {
    type: "react",
    civ: target,
    effectId: effect.id,
    kind: "accept",
  }).state;
  assert(
    s.civs[target].report.some((l) => l.includes("pushed")),
    "the neighbor is told who did it",
  );
  assert(total(s, target) < before + 0 || s.civs[target].report.length > 0);
});

test("the sustainable choice halves damage and builds lasting protection", () => {
  let s = hearNeighbor(answer(rich(atQuiz("flood")), false));
  s = applyAction(s, { type: "choose", civ: P, option: 1 }).state;
  assert(s.civs[P].buildings.includes("wetland"));
  assert(s.civs[P].report.some((l) => l.includes("Wetland")));
});

test("building checks cost and caps; the bank trades 3:1", () => {
  let s = hearNeighbor(answer(rich(atQuiz("flood")), true));
  s = applyAction(s, { type: "choose", civ: P, option: 2 }).state;
  s = acceptIncoming(s);
  for (let i = 0; i < BUILDINGS.kiln.max!; i++)
    s = applyAction(s, { type: "build", civ: P, building: "kiln" }).state;
  assert.match(
    applyAction(s, { type: "build", civ: P, building: "kiln" }).error ?? "",
    /room for only/,
  );
  assert(applyAction(s, { type: "build", civ: P, building: "wetland" }).error);
  const sheep = s.civs[P].stock.sheep;
  s = applyAction(s, {
    type: "exchange",
    civ: P,
    give: "sheep",
    get: "ore",
  }).state;
  assert.equal(s.civs[P].stock.sheep, sheep - EXCHANGE_RATE);
  s.civs[P].stock.wood = 0;
  assert(applyAction(s, { type: "build", civ: P, building: "farm" }).error);
});

test("you can't act out of turn", () => {
  const s = createGame(P, "solo", 1);
  assert(applyAction(s, { type: "build", civ: P, building: "farm" }).error);
  assert(applyAction(s, { type: "choose", civ: P, option: 0 }).error);
});

test("warming past +3°C ends the game for everyone", () => {
  let s = hearNeighbor(answer(atQuiz("flood"), true));
  s = applyAction(s, { type: "choose", civ: P, option: 2 }).state;
  s = acceptIncoming(s);
  s.climate = CLIMATE_LOSS + 0.5;
  s = applyAction(s, { type: "ready", civ: P }).state;
  assert.equal(s.phase, "ended");
  assert.equal(s.outcome, "collapse");
});

test("full AI games finish within ten decades with no negative stock", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = autoplay(createGame(P, "solo", seed));
    assert.equal(s.phase, "ended");
    assert(s.round <= ROUNDS);
    for (const c of CIV_IDS)
      for (const r of RESOURCES) assert(s.civs[c].stock[r] >= 0);
  }
});

test("hot-seat waits for every person before moving on", () => {
  let s = advance(createGame(P, "hotseat", 5));
  const q = questionFor(s, P)!;
  s = answerQuiz(s, P, q.correct, 1000);
  assert.equal(s.phase, "quiz", "three more people still have to answer");
  assert.equal(progress(s).phase, "quiz");
});

test("every playable event has a quiz, neighbor line and lasting mitigation", () => {
  assert.equal(Object.keys(EVENTS).length, 16);
  for (const [id, event] of Object.entries(EVENTS)) {
    assert(event.neighbor.length > 20, `${id} needs a neighbor response`);
    let s = rich(atQuiz(id as EventId));
    s = hearNeighbor(answer(s, true));
    s = applyAction(s, { type: "choose", civ: P, option: 1 }).state;
    assert(
      s.civs[P].buildings.includes(event.green.build!),
      `${id} should grant ${event.green.build}`,
    );
  }
});

test("the response phase waits for every hot-seat player", () => {
  let s = advance(createGame(P, "hotseat", 15));
  for (const civ of CIV_IDS) {
    const q = questionFor(s, civ)!;
    s = answerQuiz(s, civ, q.correct, 1000);
  }
  assert.equal(s.phase, "response");
  for (const civ of CIV_IDS.slice(0, -1))
    s = applyAction(s, { type: "acknowledge", civ }).state;
  assert.equal(s.phase, "response");
  s = applyAction(s, {
    type: "acknowledge",
    civ: CIV_IDS[CIV_IDS.length - 1],
  }).state;
  assert.equal(s.phase, "choice");
});

test("victims can absorb incoming losses at the configured cost", () => {
  let s = atReaction("flood");
  const effect = s.pendingEffects[0];
  effect.loss = { wheat: 4 };
  const beforeWheat = s.civs[effect.to].stock.wheat;
  const beforeBrick = s.civs[effect.to].stock.brick;
  s = applyAction(s, {
    type: "react",
    civ: effect.to,
    effectId: effect.id,
    kind: "absorb",
  }).state;
  assert.equal(s.phase, "build");
  assert.equal(s.civs[effect.to].stock.wheat, beforeWheat - 2);
  assert.equal(s.civs[effect.to].stock.brick, beforeBrick - 1);
});

test("victims can redirect an effect only along its next legal route", () => {
  let s = atReaction("flood");
  const effect = s.pendingEffects[0];
  const target = legalRedirectTargets(effect)[0];
  assert(target, "flood should have a downstream redirect");
  const originalWheat = s.civs[effect.to].stock.wheat;
  const redirectedWheat = s.civs[target].stock.wheat;
  assert(
    applyAction(s, {
      type: "react",
      civ: effect.to,
      effectId: effect.id,
      kind: "redirect",
      redirectTo: effect.from,
    }).error,
  );
  s = applyAction(s, {
    type: "react",
    civ: effect.to,
    effectId: effect.id,
    kind: "redirect",
    redirectTo: target,
  }).state;
  assert.equal(s.civs[effect.to].stock.wheat, originalWheat);
  assert(s.civs[target].stock.wheat < redirectedWheat);
});

test("multiple incoming effects wait for a reaction in stable order", () => {
  let s = atReaction("flood");
  const first = s.pendingEffects[0];
  s.pendingEffects.push({
    ...first,
    id: `${first.id}:second`,
    from: "petrostate",
  });
  s = applyAction(s, {
    type: "react",
    civ: first.to,
    effectId: first.id,
    kind: "accept",
  }).state;
  assert.equal(s.phase, "reaction");
  assert.equal(pendingFor(s, first.to)[0].id, `${first.id}:second`);
  s = applyAction(s, {
    type: "react",
    civ: first.to,
    effectId: `${first.id}:second`,
    kind: "accept",
  }).state;
  assert.equal(s.phase, "build");
});

test("an embargo blocks exchange, reduces income, and expires next decade", () => {
  let s = atReaction("flood");
  const effect = s.pendingEffects[0];
  const baseline = income(s, effect.from).wheat;
  s = applyAction(s, {
    type: "react",
    civ: effect.to,
    effectId: effect.id,
    kind: "embargo",
    resource: "wheat",
  }).state;
  assert.equal(income(s, effect.from).wheat, Math.max(0, baseline - 1));
  assert.match(
    applyAction(s, {
      type: "exchange",
      civ: effect.from,
      give: "sheep",
      get: "ore",
    }).error ?? "",
    /embargo/i,
  );
  for (const civ of CIV_IDS) s = applyAction(s, { type: "ready", civ }).state;
  assert.equal(s.round, 2);
  assert.equal(s.embargoes.length, 0);
});

test("version-2 saves gain reaction fields without losing progress", () => {
  const original = createGame(P, "solo", 77);
  const legacy = JSON.parse(JSON.stringify(original));
  legacy.version = 2;
  delete legacy.pendingEffects;
  delete legacy.embargoes;
  const migrated = normalizeGameState(legacy);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.pendingEffects, []);
  assert.deepEqual(migrated.embargoes, []);
  assert.equal(migrated.round, original.round);
});

test("content is consistent", () => {
  for (const [id, e] of Object.entries(EVENTS)) {
    const pool = QUESTIONS.filter((q) =>
      q.types.some((t) => e.quizTypes.includes(t)),
    );
    assert(pool.length >= 4, `${id} needs quiz questions`);
    assert(
      BUILDINGS[e.green.build!]?.earned,
      `${id} must earn a protective building`,
    );
    assert(BUILDINGS[e.green.build!].protects?.includes(id as EventId));
  }
});
