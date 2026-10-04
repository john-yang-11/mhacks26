"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { CIVS, EVENTS } from "@/game/content";
import { spillTarget } from "@/game/engine";
import { OWNERS, TOWNS, townOf, ARROW_COLORS } from "@/game/towns";
import { CIV_IDS, type CivId, type GameState } from "@/game/types";
import {
  OCEAN,
  renderWorldView,
  tsunamiDirection,
  type WorldView,
  type PortTraffic,
} from "@/game/worldRender";

const FPS = OCEAN.fps;

/** The terrain is drawn live from map data, so events, towns and climate show on the land itself. */
function LiveTerrain({
  state,
  svg,
  scale: cssScale,
}: {
  state: GameState;
  svg: RefObject<SVGSVGElement | null>;
  /** CSS pixels per map pixel: always a whole number of device pixels. */
  scale: number;
}) {
  const scaleRef = useRef(cssScale);
  scaleRef.current = cssScale;
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const el = canvas.current!;
    let image: ImageData;
    let view: WorldView;
    let frame = 0;
    const still = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const trips = new Map<number, { civ: CivId; start: number }>();
    const measure = () => {
      const shell = el.parentElement!.getBoundingClientRect();
      const map = svg.current!.getBoundingClientRect();
      const viewport = svg.current!.parentElement!.getBoundingClientRect();
      // Integer scale only: one map pixel is exactly `scale` CSS px (a whole number of device px),
      // and the canvas grid is shifted so it lines up with the SVG's map origin.
      const scale = scaleRef.current;
      if (scale <= 0) return;
      const relX = map.left - shell.left,
        relY = map.top - shell.top;
      const originX = Math.ceil(relX / scale),
        originY = Math.ceil(relY / scale);
      const offX = relX - originX * scale,
        offY = relY - originY * scale;
      const width = Math.max(1, Math.ceil((shell.width - offX) / scale));
      const height = Math.max(1, Math.ceil((shell.height - offY) / scale));
      el.width = width;
      el.height = height;
      Object.assign(el.style, {
        left: `${offX}px`,
        top: `${offY}px`,
        width: `${width * scale}px`,
        height: `${height * scale}px`,
      });
      image = ctx.createImageData(width, height);
      view = {
        width,
        height,
        originX,
        originY,
        clip: {
          left: (viewport.left - shell.left - offX) / scale,
          top: (viewport.top - shell.top - offY) / scale,
          right: (viewport.right - shell.left - offX) / scale,
          bottom: (viewport.bottom - shell.top - offY) / scale,
        },
      };
    };
    const draw = () => {
      if (!view) measure();
      if (!view) return;
      const s = latest.current;
      s.news.forEach((n, i) => {
        if (n.kind === "trade" && n.civ && n.round === s.round && !trips.has(i))
          trips.set(i, { civ: n.civ, start: frame });
      });
      const traffic: PortTraffic[] = [...trips.values()]
        .flatMap((t) => {
          const age = frame - t.start;
          return age < OCEAN.trade.frames ? [{ civ: t.civ, frame: age }] : [];
        })
        .slice(-OCEAN.trade.maxBoats);
      // The reveal plays out once per decade; reduced motion skips straight to the full hazard.
      const strikeAge = s.phase === "event" && !still ? frame : Infinity;
      renderWorldView(
        s,
        still ? 24 : frame,
        image.data,
        view,
        traffic,
        strikeAge,
      );
      ctx.putImageData(image, 0, 0);
      frame++;
    };
    measure();
    draw();
    const resize = new ResizeObserver(measure);
    resize.observe(el.parentElement!);
    resize.observe(svg.current!);
    resize.observe(svg.current!.parentElement!);
    const scroll = () => measure();
    svg.current!.parentElement!.addEventListener("scroll", scroll);
    const timer = window.setInterval(draw, still ? 1000 : 1000 / FPS);
    return () => {
      window.clearInterval(timer);
      resize.disconnect();
      svg.current?.parentElement?.removeEventListener("scroll", scroll);
    };
  }, [svg]);
  return (
    <canvas
      ref={canvas}
      className="world-canvas"
      width={320}
      height={200}
      aria-hidden="true"
    />
  );
}

const keep = (civ: CivId) => {
  const t = townOf(civ);
  return [t.keepTile[0] * 4, t.keepTile[1] * 4] as const;
};

/** One map pixel in SVG units (the terrain is 320x200 pixels drawn at 4x). */
const CELL = 4;

/**
 * A pixel-art arrow between two towns, drawn on the map's own pixel grid so it matches the
 * terrain: a curve that bows to the left of travel (so A->B and B->A separate), a 3-pixel shaft
 * with a light top and dark bottom, a chunky 9-pixel-tall head and a 1-pixel black outline, like the
 * trade arrow sprites. Returns one SVG path per colour, plus the centre line for the march effect.
 */
function pixelArrow(
  x: number,
  y: number,
  tx: number,
  ty: number,
  lane: number,
) {
  const len = Math.hypot(tx - x, ty - y) || 1;
  const ux = (tx - x) / len,
    uy = (ty - y) / len;
  const nx = uy,
    ny = -ux;
  const sx = x + ux * 48,
    sy = y + uy * 48;
  const ex = tx - ux * 72,
    ey = ty - uy * 72;
  const bow = Math.min(150, len * 0.26) * (1 + lane * 0.35);
  const c1x = sx + (ex - sx) * 0.25 + nx * bow,
    c1y = sy + (ey - sy) * 0.25 + ny * bow;
  const c2x = sx + (ex - sx) * 0.75 + nx * bow,
    c2y = sy + (ey - sy) * 0.75 + ny * bow;
  const at = (t: number) => {
    const m = 1 - t;
    return [
      (m * m * m * sx +
        3 * m * m * t * c1x +
        3 * m * t * t * c2x +
        t * t * t * ex) /
        CELL,
      (m * m * m * sy +
        3 * m * m * t * c1y +
        3 * m * t * t * c2y +
        t * t * t * ey) /
        CELL,
    ];
  };
  const tangent = (t: number) => {
    const m = 1 - t;
    const dx =
      3 * m * m * (c1x - sx) + 6 * m * t * (c2x - c1x) + 3 * t * t * (ex - c2x);
    const dy =
      3 * m * m * (c1y - sy) + 6 * m * t * (c2y - c1y) + 3 * t * t * (ey - c2y);
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  // Normal pointing up the screen, so "top half" means the same thing as in the sprites.
  const upNormal = (tx_: number, ty_: number) =>
    -tx_ > 0 || (tx_ === 0 && ty_ > 0) ? [ty_, -tx_] : [-ty_, tx_];

  const cells = new Map<string, boolean>(); // "cx,cy" -> light?
  const centre: [number, number][] = [];
  const steps = Math.max(8, Math.ceil(len / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [px, py] = at(t);
    const [tx_, ty_] = tangent(t);
    const [ux_, uy_] = upNormal(tx_, ty_);
    const mid = `${Math.floor(px)},${Math.floor(py)}`;
    if (!centre.length || centre[centre.length - 1].join(",") !== mid)
      centre.push([Math.floor(px), Math.floor(py)]);
    for (let cy = Math.floor(py) - 2; cy <= Math.floor(py) + 2; cy++)
      for (let cx = Math.floor(px) - 2; cx <= Math.floor(px) + 2; cx++) {
        const dx = cx + 0.5 - px,
          dy = cy + 0.5 - py;
        const across = dx * ux_ + dy * uy_,
          along = dx * tx_ + dy * ty_;
        if (Math.abs(across) <= 1.5 && Math.abs(along) <= 0.75) {
          const key = `${cx},${cy}`;
          if (!cells.has(key)) cells.set(key, across > -0.5);
        }
      }
  }
  // Head: about 6 pixels long and 9 pixels tall, pointing along the curve's end direction.
  const [hx, hy] = at(1);
  const [dx, dy] = tangent(1);
  const [ux_, uy_] = upNormal(dx, dy);
  const tip = [hx + dx * 4.5, hy + dy * 4.5];
  const base = [hx - dx * 2, hy - dy * 2];
  const corners = [
    tip,
    [base[0] + ux_ * 4.6, base[1] + uy_ * 4.6],
    [base[0] - ux_ * 4.6, base[1] - uy_ * 4.6],
  ];
  const side = (p: number[], a: number[], b: number[]) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let cy = Math.floor(hy) - 8; cy <= Math.floor(hy) + 8; cy++)
    for (let cx = Math.floor(hx) - 8; cx <= Math.floor(hx) + 8; cx++) {
      const p = [cx + 0.5, cy + 0.5];
      const d1 = side(p, corners[0], corners[1]),
        d2 = side(p, corners[1], corners[2]),
        d3 = side(p, corners[2], corners[0]);
      const inside =
        (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
      if (inside) {
        const across = (p[0] - base[0]) * ux_ + (p[1] - base[1]) * uy_;
        cells.set(`${cx},${cy}`, across > -0.25);
      }
    }
  // 1-pixel black outline around everything.
  const outline = new Set<string>();
  for (const key of cells.keys()) {
    const [cx, cy] = key.split(",").map(Number);
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = `${cx + ox},${cy + oy}`;
      if (!cells.has(n)) outline.add(n);
    }
  }
  const rect = (key: string) => {
    const [cx, cy] = key.split(",").map(Number);
    return `M${cx * CELL} ${cy * CELL}h${CELL}v${CELL}h-${CELL}z`;
  };
  const pick = (light: boolean) =>
    [...cells]
      .filter(([, l]) => l === light)
      .map(([k]) => rect(k))
      .join("");
  // Every 4th centre-line pixel per phase, for a stepped "marching" glint toward the head.
  const march = [0, 1, 2, 3].map((phase) =>
    centre
      .filter((_, i) => i % 4 === phase && i < centre.length - 2)
      .map(([cx, cy]) => rect(`${cx},${cy}`))
      .join(""),
  );
  return {
    outline: [...outline].map(rect).join(""),
    light: pick(true),
    dark: pick(false),
    march,
  };
}

/** Disasters that shake the screen, and ones that flash it, when they are revealed. */
const SHAKE = new Set([
  "earthquake",
  "landslide",
  "tsunami",
  "dam_failure",
  "flood",
]);
const FLASH: Record<string, string> = {
  wildfire: "fire",
  volcano: "fire",
  hurricane: "storm",
  sea_rise: "storm",
  tsunami: "storm",
  heatwave: "fire",
};

export default function WorldMap({
  state,
  selected,
  onSelect,
  focus,
}: {
  state: GameState;
  selected?: CivId;
  onSelect: (civ: CivId) => void;
  /** The town whose disaster this player is facing (shaken, flashed and pulsed on reveal). */
  focus?: CivId;
}) {
  const focusCiv = focus ?? state.player;
  const struck =
    state.phase !== "ended" ? state.events[focusCiv]?.type : undefined;
  // A short strike moment when each decade's disaster is revealed.
  const [strike, setStrike] = useState(false);
  useEffect(() => {
    if (state.phase !== "event") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setStrike(true);
    const t = window.setTimeout(() => setStrike(false), 1600);
    return () => window.clearTimeout(t);
  }, [state.seed, state.round]);
  const [zoomStep, setZoomStep] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  // Fit the map at the largest whole-number scale (in device pixels) that fits the viewport.
  const [fit, setFit] = useState({
    device: 3,
    dpr: 1,
    left: 0,
    top: 0,
    w: 0,
    h: 0,
  });
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const device = Math.max(
        2,
        Math.floor(Math.min((r.width * dpr) / 310, (r.height * dpr) / 193.75)),
      );
      const next = {
        device,
        dpr,
        left: r.left,
        top: r.top,
        w: r.width,
        h: r.height,
      };
      setFit((f) =>
        Object.keys(next).every(
          (k) => f[k as keyof typeof f] === next[k as keyof typeof next],
        )
          ? f
          : next,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const deviceScale = Math.max(1, fit.device + zoomStep);
  const scale = deviceScale / fit.dpr;
  // Centre the map, but snap its top-left corner to a whole device pixel so nothing is resampled.
  const snap = (start: number, room: number, size: number) => {
    const ideal = start + Math.max(0, (room - size) / 2);
    return Math.round(ideal * fit.dpr) / fit.dpr - start;
  };
  const marginLeft = snap(fit.left, fit.w, 310 * scale);
  const marginTop = snap(fit.top, fit.h, 193.75 * scale);
  const [arrows, setArrows] = useState(true);
  // Cheap choices push damage onto a neighbor: draw that as an arrow between towns.
  const spills =
    state.phase === "build"
      ? CIV_IDS.flatMap((from) => {
          const e = EVENTS[state.events[from].type];
          if (state.civs[from].choice !== 0 || !e.cheap.spillTo) return [];
          return [{ from, to: spillTarget(from, e.cheap.spillTo), e }];
        })
      : [];
  return (
    <div
      className={`map-shell pixel-map ${strike && struck && SHAKE.has(struck) ? "strike-shake" : ""}`}
    >
      {strike && struck && FLASH[struck] && (
        <div className={`strike-flash ${FLASH[struck]}`} aria-hidden="true" />
      )}
      <LiveTerrain
        key={`${state.seed}:${state.round}`}
        state={state}
        svg={svg}
        scale={scale}
      />
      <div className="map-viewport" ref={viewport} style={{ display: "flex" }}>
        <svg
          ref={svg}
          className="world-map"
          viewBox="0 0 1240 775"
          style={{
            width: `${310 * scale}px`,
            height: `${193.75 * scale}px`,
            minWidth: 0,
            minHeight: 0,
            flex: "none",
            margin: 0,
            marginLeft,
            marginTop,
          }}
          role="group"
          aria-label="The valley: select a town to inspect it"
        >
          {TOWNS.map((town) => {
            const civ = OWNERS[town.civ];
            const [x, y] = keep(civ);
            const pulsing = strike && civ === focusCiv;
            const ev = state.phase !== "ended" ? state.events[civ] : undefined;
            const e = ev ? EVENTS[ev.type] : undefined;
            const open = () => onSelect(civ);
            return (
              <g
                key={town.id}
                tabIndex={0}
                role="button"
                aria-label={`${town.name}, ${CIVS[civ].name}${e ? `. Facing: ${e.name}` : ""}`}
                onClick={open}
                onKeyDown={(k) => {
                  if (k.key === "Enter" || k.key === " ") {
                    k.preventDefault();
                    open();
                  }
                }}
                className="castle-hotspot"
              >
                {pulsing && (
                  <circle
                    className="strike-ring"
                    cx={x}
                    cy={y - 20}
                    r={90}
                    fill="none"
                    aria-hidden="true"
                  />
                )}
                <rect
                  x={x - 50}
                  y={y - 44}
                  width="100"
                  height="84"
                  fill="transparent"
                  stroke={selected === civ ? "#ffe379" : "transparent"}
                  strokeWidth="4"
                />
                {e && (
                  <g className="damage-bubble">
                    <rect
                      x={x + 26}
                      y={y - 52}
                      width="34"
                      height="34"
                      fill="#8c2929"
                      stroke="#fff0bf"
                      strokeWidth="3"
                    />
                    <text
                      x={x + 43}
                      y={y - 27}
                      textAnchor="middle"
                      fill="#fff0bf"
                      fontSize="22"
                    >
                      {e.icon}
                    </text>
                    <title>{e.name}</title>
                  </g>
                )}
                <rect
                  x={x - 64}
                  y={y + 10}
                  width="128"
                  height="26"
                  fill="#d9ae52"
                  stroke="#382516"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y + 29}
                  textAnchor="middle"
                  fontSize="20"
                  fill="#23170e"
                >
                  {town.name}
                </text>
              </g>
            );
          })}
          {arrows &&
            spills.map(({ from, to, e }) => {
              const [x, y] = keep(from),
                [tx, ty] = keep(to);
              // Arrows sharing a destination take separate lanes so they don't overlap.
              const lane = spills.filter(
                (o) => o.to === to && o.from < from,
              ).length;
              const px = pixelArrow(x, y, tx, ty, lane);
              const [light, dark] = ARROW_COLORS[to];
              return (
                <g
                  key={from}
                  className="spill-pixel"
                  shapeRendering="crispEdges"
                >
                  <title>
                    {`${CIVS[from].name} chose "${e.cheap.label}": ${CIVS[to].name} takes the damage.`}
                  </title>
                  <path d={px.outline} fill="#000" />
                  <path d={px.dark} fill={dark} />
                  <path d={px.light} fill={light} />
                  {px.march.map((d, phase) => (
                    <path
                      key={phase}
                      d={d}
                      className={`spill-march phase-${phase}`}
                      fill="#fff6d0"
                    />
                  ))}
                </g>
              );
            })}
        </svg>
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom out"
          onClick={() => setZoomStep(Math.max(1 - fit.device, zoomStep - 1))}
        >
          −
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => setZoomStep(Math.min(4, zoomStep + 1))}
        >
          +
        </button>
        <button onClick={() => setZoomStep(0)}>Reset</button>
        <button aria-pressed={arrows} onClick={() => setArrows(!arrows)}>
          Spill arrows
        </button>
      </div>
      {state.phase !== "ended" &&
        CIV_IDS.some((c) => state.events[c].type === "tsunami") && (
          <div className="sea-warning" role="status">
            ≋ TSUNAMI FROM THE {tsunamiDirection(state).toUpperCase()} · GO
            INLAND / UPHILL
          </div>
        )}
    </div>
  );
}
