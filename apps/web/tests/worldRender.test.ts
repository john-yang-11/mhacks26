import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  applyAction,
  createGame,
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
  renderWorldView,
  seaPixel,
  portRoute,
  tradeTraffic,
  tsunamiDirection,
} from "../src/game/worldRender";
import type { CivId, EventId, GameState } from "../src/game/types";

const render = (
  state: GameState | undefined,
  frame = 0,
  strikeAge = Infinity,
) => {
  const out = new Uint8ClampedArray(MAP_W * MAP_H * 4);
  renderWorld(state, frame, out, undefined, strikeAge);
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
function withEvent(civ: CivId, type: EventId, option: 0 | 1 | 2 = 2) {
  let s = createGame("heartland", "solo", 11);
  for (const c of Object.keys(s.events) as CivId[])
    s.events[c] = { type: "heatwave", loss: {} };
  s.events[civ] = { type, loss: {} };
  s = advance(s);
  const q = questionFor(s, "heartland")!;
  s = answerQuiz(s, "heartland", q.correct, 1000);
  s = applyAction(s, { type: "acknowledge", civ: "heartland" }).state;
  return applyAction(s, { type: "choose", civ: "heartland", option }).state;
}
/** A fresh decade, still in the event phase: `civ` has just been struck by `type`. */
function atReveal(civ: CivId, type: EventId) {
  const s = createGame("heartland", "solo", 11);
  for (const c of Object.keys(s.events) as CivId[])
    s.events[c] = { type: "supply_shock", loss: {} };
  s.events[civ] = { type, loss: {} };
  return s;
}
/** `age` decades after `civ` was hit by `event` and answered with `option`. */
function decadesAfter(
  civ: CivId,
  event: EventId,
  option: 0 | 1 | 2,
  age: number,
) {
  const s = createGame("heartland", "solo", 11);
  for (const c of Object.keys(s.events) as CivId[])
    s.events[c] = { type: "supply_shock", loss: {} };
  s.news.push({ round: 1, civ, kind: "event", event, option, text: "x" });
  s.round = 1 + age;
  return s;
}
const CHAR = ["42,34,28", "22,17,14"];
const FLAMES = ["208,40,24", "240,96,32", "255,225,74"];
function countIn(img: Uint8ClampedArray, area: number, colors: string[]) {
  const L = worldLayers();
  let n = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++)
    if (
      L.area[i] === area &&
      colors.includes(`${img[i * 4]},${img[i * 4 + 1]},${img[i * 4 + 2]}`)
    )
      n++;
  return n;
}

test("world layers decode to a full 320x200 map with one town per civilization", () => {
  const L = worldLayers();
  for (const layer of [L.base, L.kind, L.area, L.near])
    assert.equal(layer.length, MAP_W * MAP_H);
  assert.equal(TOWNS.length, 4);
});

test("extended ocean animates and exactly matches map sea pixels", () => {
  const view = {
    width: 400,
    height: 250,
    originX: 40,
    originY: 10,
    clip: { left: 0, top: 0, right: 400, bottom: 250 },
  };
  const a = new Uint8ClampedArray(400 * 250 * 4),
    b = new Uint8ClampedArray(a.length);
  renderWorldView(undefined, 0, a, view);
  renderWorldView(undefined, 48, b, view);
  assert(
    changed(a, b).some((i) => i % 400 < 40),
    "outer sea must animate",
  );
  const offset = (10 * 400 + 40) * 4;
  assert.deepEqual([...a.slice(offset, offset + 3)], seaPixel(0, 0, 0));
  const outside = (5 * 400 + 5) * 4;
  assert.deepEqual([...a.slice(outside, outside + 3)], seaPixel(-35, -5, 0));
});

test("tsunami crosses the extended sea without covering inland hills", () => {
  const s = createGame("archipelago", "solo", 11);
  for (const c of Object.keys(s.events) as CivId[])
    s.events[c] = { type: "heatwave", loss: {} };
  s.events.archipelago = { type: "tsunami", loss: { brick: 2 } };
  assert.equal(tsunamiDirection(s), tsunamiDirection(structuredClone(s)));
  const view = {
    width: 500,
    height: 300,
    originX: 90,
    originY: 40,
    clip: { left: 0, top: 0, right: 500, bottom: 300 },
  };
  const a = new Uint8ClampedArray(500 * 300 * 4),
    b = new Uint8ClampedArray(a.length);
  renderWorldView(s, 20, a, view);
  const calm = structuredClone(s);
  calm.events.archipelago.type = "heatwave";
  renderWorldView(calm, 20, b, view);
  const diff = changed(a, b);
  assert(
    diff.some(
      (i) =>
        i % 500 < 90 ||
        i % 500 >= 410 ||
        Math.floor(i / 500) < 40 ||
        Math.floor(i / 500) >= 240,
    ),
    "wave must appear beyond the original map rectangle",
  );
  const L = worldLayers();
  for (const i of diff) {
    const x = (i % 500) - 90,
      y = Math.floor(i / 500) - 40;
    if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H)
      assert(
        ![8, 9].includes(L.kind[y * MAP_W + x]),
        "mountains and snow stay dry",
      );
  }
});

test("trade traffic requires a real exchange and every sailing route stays on water", () => {
  const s = createGame();
  assert.equal(tradeTraffic(s, 0).length, 0);
  s.news.push({
    kind: "trade",
    round: s.round,
    civ: "enclave",
    text: "Cargo dispatched",
  });
  assert.equal(tradeTraffic(s, 0)[0].civ, "enclave");
  s.round++;
  assert.equal(tradeTraffic(s, 0).length, 0);
  const L = worldLayers();
  for (const civ of Object.keys(s.civs) as CivId[]) {
    const path = portRoute(civ);
    assert(path.length > 3);
    for (const [x, y] of path)
      assert(L.kind[y * MAP_W + x] <= 3, "ships must stay on water");
    for (let i = 1; i < path.length; i++)
      assert.equal(
        Math.abs(path[i][0] - path[i - 1][0]) +
          Math.abs(path[i][1] - path[i - 1][1]),
        1,
      );
  }
});

test("rendering is deterministic for the same state and frame", () => {
  const s = createGame();
  assert.deepEqual(render(s, 3), render(s, 3));
});

test("water shimmer holds its frame rather than flashing at the render rate", () => {
  for (let y = -10; y < 15; y++)
    for (let x = -10; x < 15; x++)
      assert.deepEqual(seaPixel(x, y, 0), seaPixel(x, y, 11));
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

test("a wildfire sweeps out from where it starts when it is revealed", () => {
  const civ: CivId = "enclave";
  const area = townIndex(civ);
  const s = atReveal(civ, "wildfire");
  const early = render(s, 0, 2);
  const late = render(s, 0, 18);
  const burning = (img: Uint8ClampedArray) =>
    countIn(img, area, [...CHAR, ...FLAMES]);
  assert(
    burning(early) < burning(late) / 3,
    "the burn grows during the strike",
  );
  assert(
    countIn(late, area, FLAMES) > 40,
    "the fire is full of flames once it has spread",
  );
  assert(
    changed(late, render(s, 1, 18)).length > 0,
    "flames flicker between frames",
  );
});

test("the fire goes out after the response and its scar heals over the decades", () => {
  const civ: CivId = "enclave";
  const area = townIndex(civ);
  const built = render(withEvent(civ, "wildfire"));
  assert(
    countIn(built, area, CHAR) > 100,
    "burnt ground remains in the build phase",
  );
  const scar = (option: 0 | 1 | 2, age: number) =>
    countIn(render(decadesAfter(civ, "wildfire", option, age)), area, CHAR);
  assert(
    scar(2, 1) > scar(2, 2) && scar(2, 2) > scar(2, 3) && scar(2, 3) > 0,
    "braced scars fade over 3 decades",
  );
  assert.equal(scar(2, 4), 0, "and are gone after that");
  assert(
    scar(1, 1) < scar(2, 1),
    "a sustainable response leaves a lighter scar",
  );
  assert.equal(scar(1, 3), 0, "and heals within 2 decades");
});

test("a cheap fix leaves no scar at home but scars the neighbor it was pushed onto", () => {
  const civ: CivId = "heartland";
  const s = withEvent(civ, "flood", 0);
  const status = areaStatus(s);
  assert(
    !status[townIndex(civ)].after.has("flood"),
    "the flood was moved away from home",
  );
  assert(
    status.some((st, a) => a !== townIndex(civ) && st.after.has("flood")),
    "and landed on a neighbor",
  );
});

test("every disaster sweeps in during the strike and leaves an aftermath", () => {
  const civ: CivId = "archipelago";
  for (const e of [
    "flood",
    "hurricane",
    "earthquake",
    "smog",
    "drought",
    "spill",
    "wildfire",
  ] as EventId[]) {
    const struck = atReveal(civ, e),
      calm = atReveal(civ, "supply_shock");
    const at = (age: number) =>
      changed(render(calm, 0, age), render(struck, 0, age)).length;
    assert(at(2) < at(18), `${e} grows as it sweeps in`);
    const scarPixels: number = changed(
      render(withEvent(civ, "pandemic")),
      render(withEvent(civ, e)),
    ).length;
    assert(scarPixels > 0, `${e} leaves an aftermath`);
  }
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
