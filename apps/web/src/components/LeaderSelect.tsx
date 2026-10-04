"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CIVS } from "@/game/content";
import { townOf } from "@/game/towns";
import type { CivId } from "@/game/types";

/** Hero-select screen: the highlighted leader stands over their town, with a stat card on the right. */
interface Leader {
  civ: CivId;
  sprite: string;
  size: [number, number];
  role: string;
  name: string;
  title: string;
  color: string;
  ability: [string, string];
  exposure: string;
  pollution: number;
  resilience: number;
}
export const LEADERS: Leader[] = [
  {
    civ: "heartland",
    sprite: "ostra",
    size: [29, 46],
    role: "DAM KEEPER",
    name: "LORAX",
    title: "THE LORAX",
    color: "#a07ad6",
    ability: [
      "Headwaters",
      "ore and sheep from the high pastures, and the river starts here.",
    ],
    exposure:
      "smog drifts in, and the dam sits on the fault. If he lets the water go, everyone downstream feels it.",
    pollution: 2,
    resilience: 3,
  },
  {
    civ: "enclave",
    sprite: "moss",
    size: [29, 46],
    role: "GROVE ELDER",
    name: "SHREK",
    title: "SHREK",
    color: "#7fd65a",
    ability: ["Old growth", "wood and wheat from the forests and fields."],
    exposure: "floods from upstream, wildfires, and no ore of his own.",
    pollution: 1,
    resilience: 4,
  },
  {
    civ: "petrostate",
    sprite: "brask",
    size: [29, 46],
    role: "FOREMAN",
    name: "OLAF",
    title: "OLAF",
    color: "#f08a3c",
    ability: ["Industry", "brick and ore, and a kiln already burning."],
    exposure: "droughts and smog. His smoke lands on his neighbors.",
    pollution: 5,
    resilience: 2,
  },
  {
    civ: "archipelago",
    sprite: "pell",
    size: [29, 46],
    role: "HARBORMASTER",
    name: "TUNG TUNG TUNG SAHUR",
    title: "TUNG TUNG TUNG SAHUR",
    color: "#46d6d0",
    ability: ["Harbor", "wheat and sheep from the rich delta."],
    exposure:
      "quakes, storms and every spill that rides the current to his shore.",
    pollution: 2,
    resilience: 2,
  },
];

// ---------- layout constants (design canvas 1440 x 900) ----------
const DESIGN_W = 1440;
const DESIGN_H = 900;
const MAP_TILE_PX = 4; // world-map.png is 320 x 200 tiles at 4 px
const MAP_W = 1280;
const MAP_H = 800;
const BG_SCALE = 3;
const SPRITE_SCALE = 10;
const TALK_MS = 300;
const PICK_SECONDS = 30;

type Stat = "sheep" | "wheat" | "wood" | "brick" | "ore";
const RESOURCES: Stat[] = ["sheep", "wheat", "wood", "brick", "ore"];
/** Cell index in /assets/resource_icons.png (16 px cells, cut from resources_sheet.webp). */
const ICON_INDEX: Record<Stat, number> = {
  sheep: 0,
  wheat: 1,
  wood: 2,
  brick: 3,
  ore: 4,
};

type Rank = "best" | "worst" | undefined;
/** Best/worst of all four civs. For pollution, lower is better. */
function rank(values: number[], i: number, lowerIsBetter = false): Rank {
  const hi = Math.max(...values),
    lo = Math.min(...values);
  if (hi === lo) return undefined;
  const v = values[i];
  if (v === (lowerIsBetter ? lo : hi)) return "best";
  if (v === (lowerIsBetter ? hi : lo)) return "worst";
  return undefined;
}

function StatRow({
  label,
  value,
  blocks,
  color,
  icon,
  mark,
}: {
  label: string;
  value: number;
  blocks: number;
  color: string;
  icon?: number;
  mark: Rank;
}) {
  return (
    <div className="hs-stat" aria-label={`${label} ${value}`}>
      {icon !== undefined ? (
        <i
          className="hs-icon"
          style={{ backgroundPosition: `${-icon * 24}px 0` }}
          aria-hidden="true"
        />
      ) : (
        <i className="hs-icon hs-icon-blank" aria-hidden="true" />
      )}
      <span className="hs-label">{label}</span>
      <span className="hs-bar" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((n) => (
          <b key={n} style={n < blocks ? { background: color } : undefined} />
        ))}
      </span>
      <span className="hs-num">{value}</span>
      <span className={`hs-mark ${mark ?? ""}`}>
        {mark === "best" ? "★" : mark === "worst" ? "▼" : ""}
        {mark && (
          <span className="sr-only">
            {mark === "best" ? "best of all civs" : "worst of all civs"}
          </span>
        )}
      </span>
    </div>
  );
}

/** Largest integer scale that fits the design canvas; fractional only when the screen is smaller. */
function useDesignScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const s = Math.min(
        window.innerWidth / DESIGN_W,
        window.innerHeight / DESIGN_H,
      );
      setScale(s >= 1 ? Math.floor(s) : s);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

export default function LeaderSelect({
  choice,
  setChoice,
  mode,
  onConfirm,
  children,
}: {
  choice: CivId;
  setChoice: (civ: CivId) => void;
  mode: "solo" | "hotseat";
  onConfirm: (civ: CivId) => void;
  children?: ReactNode;
}) {
  const [cursor, setCursor] = useState(
    Math.max(
      0,
      LEADERS.findIndex((l) => l.civ === choice),
    ),
  );
  const [picks, setPicks] = useState<CivId[]>([]);
  const [more, setMore] = useState(false);
  const [talking, setTalking] = useState(false);
  const [timer, setTimer] = useState(PICK_SECONDS);
  const scale = useDesignScale();
  const seats = mode === "hotseat" ? 4 : 1;
  const chooser = Math.min(picks.length + 1, seats);
  const leader = LEADERS[cursor];
  const civ = CIVS[leader.civ];
  const takenBy = (id: CivId) => picks.indexOf(id);
  const highlightTaken = takenBy(leader.civ) >= 0;

  useEffect(() => setPicks((p) => p.slice(0, seats)), [seats]);
  useEffect(() => {
    if (picks[0]) setChoice(picks[0]);
  }, [picks]);
  // Until a leader is locked in, the highlighted one is the choice. The shared-world buttons
  // (Create / Join) read it, so browsing to a free leader must not leave them claiming Highland.
  useEffect(() => {
    if (picks.length === 0) setChoice(LEADERS[cursor].civ);
  }, [cursor, picks.length]);

  // The highlighted leader speaks for a moment whenever the highlight changes.
  useEffect(() => {
    setTalking(true);
    const t = window.setTimeout(() => setTalking(false), TALK_MS);
    return () => window.clearTimeout(t);
  }, [cursor]);

  // Play the intro sting once when the screen opens. Browsers block audio until the first
  // click or key press, so if autoplay is refused it waits for that instead.
  useEffect(() => {
    const sting = new Audio("/assets/audio/agent-select.mp3");
    const events = ["pointerdown", "keydown"] as const;
    const retry = () => {
      events.forEach((e) => window.removeEventListener(e, retry));
      sting.play().catch(() => {});
    };
    let live = true;
    sting.play().catch(() => {
      if (live) events.forEach((e) => window.addEventListener(e, retry));
    });
    return () => {
      live = false;
      events.forEach((e) => window.removeEventListener(e, retry));
      sting.pause();
    };
  }, []);

  /** Lock the highlighted leader for the current seat; the last lock starts the game. */
  function lockIn(i = cursor) {
    const id = LEADERS[i].civ;
    setCursor(i);
    if (takenBy(id) >= 0 || picks.length >= seats) return;
    const next = [...picks, id];
    setPicks(next);
    setChoice(next[0]);
    if (next.length >= seats) onConfirm(next[0]);
  }

  // Each seat gets PICK_SECONDS; when time runs out the highlighted (or first free) leader is locked.
  useEffect(() => setTimer(PICK_SECONDS), [chooser]);
  useEffect(() => {
    if (more || picks.length >= seats) return;
    if (timer <= 0) {
      const free = highlightTaken
        ? LEADERS.findIndex((l) => takenBy(l.civ) < 0)
        : cursor;
      if (free >= 0) lockIn(free);
      return;
    }
    const t = window.setTimeout(() => setTimer((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [timer, more, picks.length, seats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "Escape" && more) {
        setMore(false);
        return;
      }
      if (more || el.closest("input, textarea, select, .ls-options")) return;
      if (e.key === "ArrowRight") setCursor((c) => (c + 1) % 4);
      else if (e.key === "ArrowLeft") setCursor((c) => (c + 3) % 4);
      else if (e.key === "Enter" && !el.closest("button")) lockIn();
      else if (e.key === "Backspace") setPicks((p) => p.slice(0, -1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Background: a 3x crop of the world map centred on the highlighted civ's keep.
  const [kx, ky] = townOf(leader.civ).keepTile;
  const clamp = (v: number, max: number) => Math.min(0, Math.max(v, max));
  const bgX = clamp(
    DESIGN_W / 2 - kx * MAP_TILE_PX * BG_SCALE,
    DESIGN_W - MAP_W * BG_SCALE,
  );
  const bgY = clamp(
    DESIGN_H / 2 - ky * MAP_TILE_PX * BG_SCALE,
    DESIGN_H - MAP_H * BG_SCALE,
  );

  // Stat bars: the largest value of each stat across all civs fills 5 blocks.
  const all = (f: (l: Leader) => number) => LEADERS.map(f);
  const startOf = (l: Leader, r: Stat) =>
    (CIVS[l.civ].start as Record<Stat, number>)[r];
  const playerName = (seat: number) =>
    mode === "solo" ? "YOU" : `PLAYER ${seat + 1}`;

  return (
    <main
      className="hero-select"
      style={{ "--civ": leader.color } as CSSProperties}
    >
      <div
        className="hs-canvas"
        style={{
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        <div
          className="hs-bg"
          aria-hidden="true"
          style={{
            backgroundSize: `${MAP_W * BG_SCALE}px ${MAP_H * BG_SCALE}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
          }}
        />

        {/* Left: countdown + seats */}
        <aside className="hs-left">
          <h1>
            SELECT
            {picks.length < seats && (
              <span
                className={`hs-timer ${timer <= 5 ? "low" : ""}`}
                aria-label={`${timer} seconds left`}
              >
                {timer}
              </span>
            )}
          </h1>
          <ol className="hs-seats" aria-label="Players">
            {Array.from({ length: seats }, (_, seat) => {
              const picked = picks[seat];
              const pl = LEADERS.find((l) => l.civ === picked);
              const active = seat === picks.length;
              const face = pl ?? (active ? leader : undefined);
              return (
                <li
                  key={seat}
                  className={active ? "active" : ""}
                  style={pl ? ({ "--civ": pl.color } as CSSProperties) : {}}
                >
                  <span className="hs-seat-face">
                    {face && (
                      <img
                        src={`/assets/leaders/${face.sprite}-portrait.png`}
                        alt=""
                        className={pl ? "" : "dim"}
                      />
                    )}
                  </span>
                  <b>{playerName(seat)}</b>
                  <small>
                    {pl ? (
                      <>
                        {pl.title} <span className="hs-check">✔</span>
                      </>
                    ) : active ? (
                      "choosing…"
                    ) : (
                      "waiting"
                    )}
                  </small>
                </li>
              );
            })}
          </ol>
          {children && (
            <button
              className="hs-options-toggle"
              aria-expanded={more}
              aria-controls="ls-options"
              onClick={() => setMore(!more)}
            >
              OPTIONS · {mode === "solo" ? "SOLO" : "HOT-SEAT"}
            </button>
          )}
          <p className="hs-keys">◀ ▶ BROWSE · ENTER LOCK IN</p>
        </aside>

        {/* Center: the highlighted leader on a floor plate */}
        <section className="hs-stage" aria-live="polite">
          <img
            className="hs-hero"
            src={`/assets/leaders/${leader.sprite}${talking ? "-talk" : ""}.png`}
            width={leader.size[0] * SPRITE_SCALE}
            height={leader.size[1] * SPRITE_SCALE}
            alt={`${leader.title}, ${leader.role.toLowerCase()} of ${civ.name}`}
          />
          <div className="hs-floor" aria-hidden="true" />
        </section>

        {/* Bottom: one portrait tile per leader */}
        <nav className="hs-roster" aria-label="Leaders">
          {LEADERS.map((l, i) => {
            const seat = takenBy(l.civ);
            const taken = seat >= 0;
            return (
              <button
                key={l.civ}
                className={`hs-tile ${i === cursor ? "highlight" : ""} ${taken ? "taken" : ""}`}
                aria-pressed={i === cursor}
                aria-label={`${l.title}, ${CIVS[l.civ].name}${taken ? `, taken by ${playerName(seat)}` : ""}`}
                onMouseEnter={() => setCursor(i)}
                onFocus={() => setCursor(i)}
                onClick={() => setCursor(i)}
                onDoubleClick={() => lockIn(i)}
              >
                <img src={`/assets/leaders/${l.sprite}-portrait.png`} alt="" />
                {taken && <span className="hs-taken">{playerName(seat)}</span>}
              </button>
            );
          })}
        </nav>

        {/* Right: stat card */}
        <section className="hs-card" aria-label={`${leader.title} details`}>
          <span className="hs-role">{leader.role}</span>
          <h2
            className={leader.title.length > 10 ? "long" : ""}
            style={{ color: leader.color }}
          >
            {leader.title}
          </h2>
          <span className="hs-civ">{civ.name}</span>

          <h3>STARTING RESOURCES</h3>
          {RESOURCES.map((r) => {
            const values = all((l) => startOf(l, r));
            const max = Math.max(...values, 1);
            const v = startOf(leader, r);
            return (
              <StatRow
                key={r}
                label={r.toUpperCase()}
                value={v}
                blocks={Math.round((v / max) * 5)}
                color={leader.color}
                icon={ICON_INDEX[r]}
                mark={rank(values, cursor)}
              />
            );
          })}
          <StatRow
            label="POLLUTION"
            value={leader.pollution}
            blocks={leader.pollution}
            color="#a08a3a"
            mark={rank(
              all((l) => l.pollution),
              cursor,
              true,
            )}
          />
          <StatRow
            label="RESILIENCE"
            value={leader.resilience}
            blocks={leader.resilience}
            color={leader.color}
            mark={rank(
              all((l) => l.resilience),
              cursor,
            )}
          />
          <p className="hs-exposed">
            <b>Exposed:</b> {civ.weakness}
          </p>
          <button
            className="hs-lock"
            disabled={highlightTaken || picks.length >= seats}
            onClick={() => lockIn()}
          >
            {highlightTaken
              ? `TAKEN BY ${playerName(takenBy(leader.civ))}`
              : "LOCK IN"}
          </button>
        </section>
      </div>

      {children && more && (
        <>
          <div
            className="ls-options-backdrop"
            aria-hidden="true"
            onClick={() => setMore(false)}
          />
          <section
            id="ls-options"
            className="ls-options"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ls-options-title"
          >
            <header className="ls-options-bar">
              <h2 id="ls-options-title">GAME OPTIONS</h2>
              <button
                className="ls-options-close"
                aria-label="Close options"
                autoFocus
                onClick={() => setMore(false)}
              >
                ✕
              </button>
            </header>
            <div className="ls-options-body">{children}</div>
          </section>
        </>
      )}
    </main>
  );
}
