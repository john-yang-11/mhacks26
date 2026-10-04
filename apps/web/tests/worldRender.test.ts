import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  applyAction,
  createGame,
  pendingFor,
  questionFor,
  answerQuiz,
} from "../src/game/engine";
import { TOWNS, townIndex } from "../src/game/towns";
import {
  areaStatus,
  MAP_H,
  MAP_W,
  renderWorld,
  worldLayers,
} from "../src/game/worldRender";
import type { CivId, EventId, GameState } from "../src/game/types";

const render = (state: GameState | undefined, frame = 0) => {
  const out = new Uint8ClampedArray(MAP_W * MAP_H * 4);
  renderWorld(state, frame, out);
  return out;
};
const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  const px: number[] = [];
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])
      px.push(i / 4);
  return px;
};
/** Everyone braces, so the map shows each town's own event during the build phase. */
function withEvent(civ: CivId, type: EventId) {
  let s = createGame("heartland", "solo", 11);
  for (const c of Object.keys(s.events) as CivId[])
    s.events[c] = { type: "heatwave", loss: {} };
  s.events[civ] = { type, loss: {} };
  s = advance(s);
  const q = questionFor(s, "heartland")!;
  s = answerQuiz(s, "heartland", q.correct, 1000);
  s = applyAction(s, { type: "acknowledge", civ: "heartland" }).state;
  s = applyAction(s, { type: "choose", civ: "heartland", option: 2 }).state;
  while (s.phase === "reaction" && pendingFor(s, "heartland")[0]) {
    const effect = pendingFor(s, "heartland")[0];
    s = applyAction(s, {
      type: "react",
      civ: "heartland",
      effectId: effect.id,
      kind: "accept",
    }).state;
  }
  return s;
}

test("world layers decode to a full 320x200 map with one town per civilization", () => {
  const L = worldLayers();
  for (const layer of [L.base, L.kind, L.area, L.near])
    assert.equal(layer.length, MAP_W * MAP_H);
  assert.equal(TOWNS.length, 4);
});

test("rendering is deterministic for the same state and frame", () => {
  const s = createGame();
  assert.deepEqual(render(s, 3), render(s, 3));
});

test("a flood only recolours the region it hits", () => {
  const civ: CivId = "enclave";
  const calm = withEvent(civ, "heatwave");
  const flooded = withEvent(civ, "flood");
  const area = townIndex(civ);
  const L = worldLayers();
  const diff = changed(render(calm), render(flooded));
  assert(diff.length > 50, "flood should be visible on the map");
  for (const i of diff)
    assert(
      L.area[i] === area || L.near[i] === area,
      `pixel ${i} outside the region changed`,
    );
});

test("all 16 event ids reach the live map status", () => {
  const ids: EventId[] = [
    "flood",
    "dam_failure",
    "hurricane",
    "earthquake",
    "tsunami",
    "volcano",
    "drought",
    "heatwave",
    "wildfire",
    "spill",
    "smog",
    "sea_rise",
    "landslide",
    "grid_failure",
    "pandemic",
    "supply_shock",
  ];
  for (const id of ids) {
    const state = withEvent("heartland", id);
    assert(areaStatus(state)[townIndex("heartland")].effects.has(id), id);
  }
});

test("pending and redirected effects preview their final map region", () => {
  const state = createGame("heartland", "hotseat", 21);
  state.phase = "reaction";
  state.pendingEffects = [
    {
      id: "preview",
      from: "heartland",
      to: "enclave",
      event: "flood",
      route: "downstream",
      loss: { wheat: 2 },
    },
  ];
  assert(areaStatus(state)[townIndex("enclave")].effects.has("flood"));
  state.pendingEffects[0].reaction = {
    kind: "redirect",
    redirectTo: "archipelago",
  };
  assert(!areaStatus(state)[townIndex("enclave")].effects.has("flood"));
  assert(areaStatus(state)[townIndex("archipelago")].effects.has("flood"));
});

test("each visual effect family changes map pixels", () => {
  const cases: [CivId, EventId][] = [
    ["heartland", "dam_failure"],
    ["archipelago", "hurricane"],
    ["archipelago", "earthquake"],
    ["archipelago", "volcano"],
    ["archipelago", "spill"],
    ["petrostate", "smog"],
    ["petrostate", "drought"],
    ["enclave", "grid_failure"],
    ["enclave", "pandemic"],
    ["petrostate", "supply_shock"],
  ];
  for (const [civ, event] of cases) {
    const baseline = render(withEvent(civ, "heatwave"));
    const affected = render(withEvent(civ, event));
    assert(
      changed(baseline, affected).length > 0,
      `${event} should be visible`,
    );
  }
});

test("warming melts mountain snow", () => {
  const L = worldLayers();
  const snowWhite = (img: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < MAP_W * 70; i++)
      if (img[i * 4] > 235 && img[i * 4 + 1] > 235 && L.kind[i] === 9) n++;
    return n;
  };
  const cool = createGame(),
    hot = createGame();
  cool.climate = 0.2;
  hot.climate = 2.8;
  assert(snowWhite(render(hot)) < snowWhite(render(cool)) / 2);
});

test("towns grow as you build", () => {
  const s = createGame();
  const before = render(s);
  s.civs.heartland.buildings.push("house", "farm", "kiln");
  assert(changed(before, render(s)).length > 30);
});
