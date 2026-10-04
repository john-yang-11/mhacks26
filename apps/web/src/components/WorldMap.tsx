"use client";
import { useEffect, useRef, useState } from "react";
import { CIVS, EVENTS } from "@/game/content";
import { OWNERS, TOWNS, townOf } from "@/game/towns";
import { type CivId, type GameState } from "@/game/types";
import { MAP_H, MAP_W, renderWorld } from "@/game/worldRender";

const FPS = 6;

/** The terrain is drawn live from map data, so events, towns and climate show on the land itself. */
function LiveTerrain({ state }: { state: GameState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(MAP_W, MAP_H);
    let frame = 0;
    const draw = () => {
      renderWorld(latest.current, frame++, image.data);
      ctx.putImageData(image, 0, 0);
    };
    draw();
    const still = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setInterval(draw, still ? 1000 : 1000 / FPS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <foreignObject x="0" y="0" width="1280" height="800">
      <canvas
        ref={canvas}
        className="world-canvas"
        width={MAP_W}
        height={MAP_H}
        aria-hidden="true"
      />
    </foreignObject>
  );
}

const keep = (civ: CivId) => {
  const t = townOf(civ);
  return [t.keepTile[0] * 4, t.keepTile[1] * 4] as const;
};

export default function WorldMap({
  state,
  selected,
  onSelect,
}: {
  state: GameState;
  selected?: CivId;
  onSelect: (civ: CivId) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [arrows, setArrows] = useState(true);
  // Pending effects and their chosen redirects are drawn before they land.
  const spills =
    state.phase === "reaction" || state.phase === "build"
      ? state.pendingEffects.map((effect) => ({
          id: effect.id,
          from: effect.from,
          to:
            effect.reaction?.kind === "redirect" && effect.reaction.redirectTo
              ? effect.reaction.redirectTo
              : effect.to,
          originalTo: effect.to,
          e: EVENTS[effect.event],
        }))
      : [];
  return (
    <div className="map-shell pixel-map">
      <div className="map-viewport">
        <svg
          className="world-map"
          viewBox="0 0 1280 800"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          role="group"
          aria-label="The valley: select a town to inspect it"
        >
          <LiveTerrain state={state} />
          <defs>
            <marker
              id="flow-tip"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8Z" fill="#fff1b0" />
            </marker>
          </defs>
          {arrows &&
            spills.map(({ id, from, to, originalTo, e }, i) => {
              const [x, y] = keep(from),
                [tx, ty] = keep(to);
              return (
                <g key={id}>
                  <path
                    className="province-flow"
                    d={`M${x} ${y} Q${(x + tx) / 2 + 40 + i * 20} ${(y + ty) / 2 - 60} ${tx} ${ty}`}
                    fill="none"
                    stroke={e.color}
                    strokeWidth="7"
                    strokeDasharray="14 9"
                    markerEnd="url(#flow-tip)"
                  />
                  <title>
                    {to === originalTo
                      ? `${CIVS[from].name} sent ${e.name.toLowerCase()} toward ${CIVS[to].name}.`
                      : `${CIVS[originalTo].name} redirected ${e.name.toLowerCase()} from ${CIVS[from].name} toward ${CIVS[to].name}.`}
                  </title>
                </g>
              );
            })}
          {TOWNS.map((town) => {
            const civ = OWNERS[town.civ];
            const [x, y] = keep(civ);
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
        </svg>
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom out"
          onClick={() => setZoom(Math.max(0.8, zoom - 0.2))}
        >
          −
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom(Math.min(2, zoom + 0.2))}
        >
          +
        </button>
        <button onClick={() => setZoom(1)}>Reset</button>
        <button aria-pressed={arrows} onClick={() => setArrows(!arrows)}>
          Spill arrows
        </button>
      </div>
    </div>
  );
}
