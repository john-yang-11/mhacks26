"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Hammer,
  FlaskConical,
  Ship,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Download,
  Leaf,
  RotateCcw,
  X,
} from "lucide-react";
import { BUILDINGS, CIVS, EVENTS, RESOURCE_META } from "@/game/content";
import {
  CLIMATE_LOSS,
  EXCHANGE_RATE,
  QUIZ_MS,
  ROUNDS,
  actionError,
  advance,
  answerQuiz,
  applyAction,
  builtCount,
  canAfford,
  choiceCost,
  createGame,
  cycleClimate,
  describe,
  greenCount,
  income,
  questionFor,
  responseTarget,
  score,
  spillTarget,
} from "@/game/engine";
import { QUESTIONS } from "@/game/questions";
import {
  type Action,
  CIV_IDS,
  type CivId,
  type GameState,
  RESOURCES,
  type Resource,
  type Stock,
} from "@/game/types";
import {
  LEADERS,
  leaderArt,
  decadeLine,
  eventLines,
  introLines,
} from "@/game/leaders";
import { townOf, KINGDOM } from "@/game/towns";
import { useWorld } from "@/game/useWorld";
import ConnectionBanner from "./ConnectionBanner";
import LeaderSelect from "./LeaderSelect";
import MultiplayerSetup from "./MultiplayerSetup";
import Narrator from "./Narrator";
import RadioControl from "./RadioControl";
import RoomLobby from "./RoomLobby";
import WorldMap from "./WorldMap";
import WorldStage from "./WorldStage";
import ResourceIcon from "./ResourceIcon";
import { ECONOMY, RESEARCH } from "@/game/content";
import {
  eventLoss,
  profile,
  recommendations,
  recoveryCost,
  recoveryNeeds,
  technologies,
  upkeep,
} from "@/game/disasters";

/** A fresh 32-bit world seed. The engine stays deterministic: every roll comes from this seed. */
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
const SAVE_KEY = "rising-waters-v2";
/** Saves made before the rename; read once and moved to SAVE_KEY. */
const OLD_SAVE_KEY = "earthshare-v2";

function Costs({ cost }: { cost: Partial<Stock> }) {
  const entries = RESOURCES.filter((r) => (cost[r] ?? 0) > 0);
  if (!entries.length) return <span className="costs free">Free</span>;
  return (
    <span className="costs">
      {entries.map((r) => (
        <span key={r} title={RESOURCE_META[r].name}>
          {cost[r]}
          <ResourceIcon resource={r} size={20} />
        </span>
      ))}
    </span>
  );
}

export default function Game() {
  const [state, setState] = useState<GameState | null>(null),
    [loaded, setLoaded] = useState(false),
    [resume, setResume] = useState<GameState | null>(null),
    [choice, setChoice] = useState<CivId>("heartland"),
    [mode, setMode] = useState<"solo" | "hotseat">("solo"),
    [seed, setSeed] = useState("");
  const [toast, setToast] = useState(""),
    [help, setHelp] = useState(false),
    [inspect, setInspect] = useState<CivId>(),
    [heard, setHeard] = useState<string>(),
    [importError, setImportError] = useState("");
  const world = useWorld(setState);
  const [roomCode, setRoomCode] = useState("");
  const online = !!world.roomId;

  useEffect(() => {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      const old = raw ? null : localStorage.getItem(OLD_SAVE_KEY);
      if (old) {
        // Carry a pre-rename save over to the new key once.
        localStorage.setItem(SAVE_KEY, old);
        localStorage.removeItem(OLD_SAVE_KEY);
        raw = old;
      }
      if (raw) {
        const s = JSON.parse(raw);
        if (validSave(s)) setResume(s);
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (state && !online)
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      } catch {
        setToast("Browser storage is unavailable. Export a save to keep it.");
      }
  }, [state, online]);
  useEffect(() => {
    if (world.error) setToast(world.error);
  }, [world.error]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Whose turn it is on this device: online = your seat; hot-seat = the next person still to act.
  const me: CivId | undefined = useMemo(() => {
    if (!state) return undefined;
    if (online) return world.civilization;
    if (state.mode === "solo") return state.player;
    const pending = state.humans.find((c) => {
      const civ = state.civs[c];
      if (state.phase === "quiz") return civ.quiz?.option === undefined;
      if (state.phase === "response") return !civ.responded;
      if (state.phase === "choice") return civ.choice === undefined;
      if (state.phase === "build") return !civ.ready;
      return false;
    });
    return pending ?? state.player;
  }, [state, online, world.civilization]);

  // Online quizzes are timed by the server clock.
  const myQuestion = state && me ? state.civs[me].quiz : undefined;
  useEffect(() => {
    if (
      online &&
      state?.phase === "quiz" &&
      myQuestion &&
      myQuestion.option === undefined
    )
      void world.begin(myQuestion.questionId);
  }, [online, state?.phase, myQuestion?.questionId]);

  function act(a: Action) {
    if (!state) return;
    if (online) {
      void world.act(a);
      return;
    }
    const result = applyAction(state, a);
    if (result.error) setToast(result.error);
    setState(result.state);
  }
  function start(civ: CivId = choice) {
    world.disconnect();
    setState(createGame(civ, mode, Number(seed) || newSeed()));
    setHeard(undefined);
    setInspect(undefined);
  }
  function backToSetup() {
    if (state && !online) setResume(state);
    world.disconnect();
    setState(null);
  }
  function exportSave() {
    if (!state) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `rising-waters-decade-${state.round}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importSave(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error("Save is too large.");
      const data = JSON.parse(await file.text());
      if (!validSave(data))
        throw Error("This is not a valid Rising Waters save.");
      setState(data);
      setImportError("");
    } catch (e) {
      setImportError((e as Error).message);
    }
  }

  if (!state)
    return (
      <>
        <LeaderSelect
          choice={choice}
          setChoice={setChoice}
          mode={mode}
          onConfirm={(civ) => start(civ)}
        >
          <div className="ls-option-group">
            <b>GAME</b>
            <div className="segmented">
              <button
                className={mode === "solo" ? "active" : ""}
                onClick={() => setMode("solo")}
              >
                Solo + 3 AI neighbors
              </button>
              <button
                className={mode === "hotseat" ? "active" : ""}
                onClick={() => setMode("hotseat")}
              >
                4-player hot-seat
              </button>
            </div>
            <label className="seed-label">
              World seed{" "}
              <input
                type="number"
                value={seed}
                placeholder="random"
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
            <small className="seed-hint">
              Leave blank for a new world each time; type a number to replay
              one.
            </small>
            <div className="setup-footer">
              {loaded && resume && (
                <button onClick={() => setState(resume)}>
                  Resume decade {resume.round} <ChevronRight size={14} />
                </button>
              )}
              <button onClick={() => setHelp(true)}>
                How to play <ArrowUpRight size={14} />
              </button>
            </div>
            <label className="import-label">
              Import a saved world{" "}
              <input
                type="file"
                accept=".json"
                onChange={(e) => importSave(e.target.files?.[0])}
              />
            </label>
            {importError && (
              <p role="alert" className="error">
                {importError}
              </p>
            )}
          </div>
          <MultiplayerSetup
            choice={choice}
            mode={mode}
            seed={seed}
            roomCode={roomCode}
            setRoomCode={setRoomCode}
            status={world.status}
            error={world.error}
            connect={world.connect}
          />
        </LeaderSelect>
        {help && <Help onClose={() => setHelp(false)} />}
      </>
    );

  // Shared worlds open in a waiting room (round 1's event phase is the only join window) so the
  // host can gather players before anyone is dropped into play; unclaimed towns fall back to AI.
  if (
    online &&
    state.mode !== "solo" &&
    state.round === 1 &&
    state.phase === "event" &&
    !world.started
  )
    return (
      <RoomLobby
        roomId={world.roomId}
        seats={world.seats}
        isHost={world.isHost}
        me={me}
        onStart={() => void world.start()}
        onLeave={backToSetup}
      />
    );

  const civId = me ?? state.player;
  const civ = state.civs[civId];
  const meta = CIVS[civId];
  const gain = income(state, civId);
  const phaseLabels = {
    event: "Something is coming",
    quiz: "Quick question",
    response: "Your neighbor responds",
    choice: "Make your choice",
    build: "Build your town",
    ended: "Your legacy",
  };
  const skipBriefing = () => {
    setHeard(`${state.seed}:${state.round}`);
    if (online) {
      if (world.isHost) void world.advance();
    } else setState(advance(state));
  };
  const waiting = (done: boolean) =>
    done && state.phase !== "ended" ? (
      <div className="waiting-banner" role="status">
        Waiting for the other towns…
      </div>
    ) : null;

  return (
    <main className="game-app world-view">
      {online && <ConnectionBanner phase={world.phase} status={world.status} />}
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setHelp(true);
          }}
        >
          <Leaf size={26} />
          <span>
            rising waters<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-bottom">
          <RadioControl state={state} civ={civId} />
          <button onClick={() => setHelp(true)}>
            <BookOpen size={15} /> How to play
          </button>
          <button onClick={exportSave}>
            <Download size={15} /> Export save
          </button>
          <button onClick={backToSetup}>
            <RotateCcw size={15} /> Back to setup
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="game-header">
          <div>
            <span className="eyebrow">
              DECADE {String(state.round).padStart(2, "0")} / {ROUNDS}{" "}
              <span className="header-separator">/</span>{" "}
              {2026 + (state.round - 1) * 10}
            </span>
            <h1>{phaseLabels[state.phase]}</h1>
          </div>
          <div className="header-actions">
            {online && (
              <span className="seat-strip" aria-label="Claimed civilizations">
                {world.seats.map((seat) => {
                  const id = seat.civ as CivId;
                  return CIV_IDS.includes(id) ? (
                    <i key={id} title={`${CIVS[id].name} claimed`}>
                      {CIVS[id].crest}
                    </i>
                  ) : null;
                })}
                <small>{world.seats.length}/4 claimed</small>
              </span>
            )}
            <span className="mode-pill">
              {online
                ? `ROOM ${world.roomId}`
                : state.mode === "solo"
                  ? "SOLO"
                  : `HOT-SEAT · ${CIVS[civId].name.toUpperCase()}'S TURN`}
            </span>
          </div>
        </header>

        <WorldStage>
          {state.phase === "ended" ? (
            state.collapseCause ? (
              <>
                <WorldMap
                  state={state}
                  onSelect={() => {}}
                  showEventMarkers={false}
                />
                <div className="catastrophic-result">
                  <Endgame state={state} onRestart={backToSetup} />
                </div>
              </>
            ) : (
              <Endgame state={state} onRestart={backToSetup} />
            )
          ) : (
            <>
              <WorldMap
                state={state}
                selected={inspect}
                onSelect={(c) => setInspect(inspect === c ? undefined : c)}
              />
              {inspect && (
                <TownWindow
                  state={state}
                  civ={inspect}
                  onClose={() => setInspect(undefined)}
                />
              )}

              {state.phase === "event" &&
                (heard === `${state.seed}:${state.round}` ? (
                  waiting(online && !world.isHost)
                ) : (
                  <Narrator
                    civ={civId}
                    className="narrator-docked"
                    eyebrow={`DECADE ${state.round} · ${EVENTS[state.events[civId].type].name.toUpperCase()}`}
                    lines={[
                      ...(state.round === 1
                        ? introLines(civId)
                        : [decadeLine(state.round, state.climate)]),
                      ...eventLines(state, civId),
                    ]}
                    skipAction={
                      <button className="narrator-skip" onClick={skipBriefing}>
                        {online && !world.isHost
                          ? "Skip briefing"
                          : "Skip all → Trivia"}
                      </button>
                    }
                    actions={
                      <button
                        className="primary"
                        disabled={online && !world.isHost}
                        onClick={skipBriefing}
                      >
                        {online && !world.isHost
                          ? "Waiting for the host"
                          : "Face the question"}{" "}
                        <ArrowRight size={16} />
                      </button>
                    }
                  />
                ))}

              {state.phase === "quiz" &&
                (civ.quiz?.option !== undefined ? (
                  waiting(true)
                ) : (
                  <QuizBox
                    key={`${civId}:${civ.quiz?.questionId}`}
                    state={state}
                    civ={civId}
                    onAnswer={(option, ms) => {
                      if (online)
                        void world.answer(civ.quiz!.questionId, option, false);
                      else setState(answerQuiz(state, civId, option, ms));
                    }}
                  />
                ))}

              {state.phase === "response" &&
                (civ.responded ? (
                  waiting(true)
                ) : (
                  <NeighborResponse
                    state={state}
                    civ={civId}
                    onContinue={() => act({ type: "acknowledge", civ: civId })}
                  />
                ))}

              {state.phase === "choice" &&
                (civ.choice !== undefined ? (
                  waiting(true)
                ) : (
                  <ChoiceBox
                    state={state}
                    civ={civId}
                    onChoose={(option) =>
                      act({ type: "choose", civ: civId, option })
                    }
                  />
                ))}

              {state.phase === "build" &&
                (civ.ready ? (
                  waiting(true)
                ) : heard !== `report:${state.round}:${civId}` ? (
                  <Narrator
                    civ={civId}
                    className="narrator-docked"
                    eyebrow={`DECADE ${state.round} · WHAT HAPPENED`}
                    lines={[
                      ...civ.report,
                      `Next decade we'll gain ${describe(gain)}. Let's build.`,
                    ]}
                    onDone={() => setHeard(`report:${state.round}:${civId}`)}
                  />
                ) : (
                  <BuildPanel
                    state={state}
                    civ={civId}
                    act={act}
                    onEnd={() =>
                      online
                        ? void world.ready()
                        : act({ type: "ready", civ: civId })
                    }
                  />
                ))}
            </>
          )}
        </WorldStage>

        <div className="civ-bar">
          <img
            className="player-portrait"
            src={leaderArt(civId)}
            alt={LEADERS[civId].name}
            title={LEADERS[civId].name}
          />
          <div className="civ-identity">
            <span className="crest" style={{ color: meta.color }}>
              {meta.crest}
            </span>
            <div>
              <b>{meta.name}</b>
              <small>
                {townOf(civId).name} · {score(state, civId)} points
              </small>
            </div>
          </div>
          <ClimateMeter state={state} />
        </div>
        <div className="resource-strip">
          {RESOURCES.map((r) => (
            <div key={r} className="resource">
              <ResourceIcon resource={r} size={36} />
              <div>
                <small>{RESOURCE_META[r].name}</small>
                <b>{civ.stock[r]}</b>
              </div>
              <span className="positive" title="Gained every decade">
                +{gain[r]}
                <small>/decade</small>
              </span>
            </div>
          ))}
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {help && <Help onClose={() => setHelp(false)} />}
    </main>
  );
}

function ClimateMeter({ state }: { state: GameState }) {
  const pct = Math.min(100, (state.climate / CLIMATE_LOSS) * 100);
  const next = cycleClimate(state);
  return (
    <div
      className="climate-meter"
      aria-label={`Warming +${state.climate.toFixed(2)}°C of ${CLIMATE_LOSS}`}
    >
      <span>
        Warming <b>+{state.climate.toFixed(2)}°C</b>
        <small>
          {" "}
          {next >= 0 ? "+" : ""}
          {next.toFixed(2)}/decade
        </small>
      </span>
      <i>
        <b
          style={{
            width: `${pct}%`,
            background: state.climate > 2 ? "#e8642c" : "#f5c542",
          }}
        />
      </i>
      <small>+{CLIMATE_LOSS}°C: every town loses</small>
    </div>
  );
}

function QuizBox({
  state,
  civ,
  onAnswer,
}: {
  state: GameState;
  civ: CivId;
  onAnswer: (option: number, ms: number) => void;
}) {
  const q = questionFor(state, civ)!;
  const [started] = useState(() => performance.now());
  const [left, setLeft] = useState(QUIZ_MS);
  const [done, setDone] = useState(false);
  const answer = (option: number) => {
    if (done) return;
    setDone(true);
    onAnswer(option, Math.round(performance.now() - started));
  };
  useEffect(() => {
    const t = window.setInterval(() => {
      const remaining = QUIZ_MS - (performance.now() - started);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) answer(-1);
    }, 250);
    return () => window.clearInterval(t);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) answer(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const segments = Math.ceil((left / QUIZ_MS) * 10);
  return (
    <Narrator
      civ={civ}
      className="narrator-docked"
      eyebrow={`QUICK QUESTION · ${EVENTS[state.events[civ].type].name.toUpperCase()}`}
      lines={[q.prompt]}
      actions={
        <div className="quiz-dialogue">
          <div className="quiz-options">
            {q.options.map((o, i) => (
              <button key={o} disabled={done} onClick={() => answer(i)}>
                <span>{i + 1}</span>
                {o}
              </button>
            ))}
          </div>
          <div
            className="hourglass"
            aria-label={`${Math.ceil(left / 1000)} seconds left`}
          >
            ⧗
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} className={i < segments ? "on" : ""} />
            ))}
            <b>0:{String(Math.ceil(left / 1000)).padStart(2, "0")}</b>
          </div>
        </div>
      }
    />
  );
}

function ChoiceBox({
  state,
  civ,
  onChoose,
}: {
  state: GameState;
  civ: CivId;
  onChoose: (option: 0 | 1 | 2) => void;
}) {
  const ev = state.events[civ];
  const e = EVENTS[ev.type];
  const target = e.cheap.spillTo
    ? CIVS[spillTarget(civ, e.cheap.spillTo)].name
    : "";
  const card = (option: 0 | 1, kind: "cheap" | "green") => {
    const c = e[kind];
    const cost = choiceCost(state, civ, option);
    const ok = canAfford(state.civs[civ].stock, cost);
    return (
      <button
        className={`choice-card ${kind}`}
        disabled={!ok}
        onClick={() => onChoose(option)}
      >
        <small>{kind === "cheap" ? "CHEAP NOW" : "SUSTAINABLE"}</small>
        <b>{c.label}</b>
        <Costs cost={cost} />
        <span>{c.effect.replace("{target}", target)}</span>
        <span>
          Potential goods loss: {describe(eventLoss(state, civ, ev, option))}.
          Recovery affects production for up to {profile(ev.type).duration}{" "}
          rounds.
        </span>
        {profile(ev.type).vulnerable.length > 0 && (
          <span>
            Exposed structures:{" "}
            {profile(ev.type)
              .vulnerable.map((id) => BUILDINGS[id].name)
              .join(", ")}
            . Lasting defenses reduce destruction risk.
          </span>
        )}
        {!ok && <em>Not enough resources</em>}
      </button>
    );
  };
  return (
    <Narrator
      civ={civ}
      className="narrator-docked"
      eyebrow={`YOUR CHOICE · ${e.name.toUpperCase()}`}
      lines={[`So how do we face this ${e.name.toLowerCase()}? ${e.lesson}`]}
      actions={
        <div className="choice-cards">
          {card(0, "cheap")}
          {card(1, "green")}
          <button className="choice-brace" onClick={() => onChoose(2)}>
            Brace and take the full hit
          </button>
        </div>
      }
    />
  );
}

function NeighborResponse({
  state,
  civ,
  onContinue,
}: {
  state: GameState;
  civ: CivId;
  onContinue: () => void;
}) {
  const event = EVENTS[state.events[civ].type];
  const target = responseTarget(state, civ);
  const quiz = state.civs[civ].quiz;
  const question = QUESTIONS.find((q) => q.id === quiz?.questionId);
  const feedback = !question
    ? "The advisor recorded your answer."
    : quiz?.correct
      ? `Correct. ${question.explanation}`
      : `${quiz?.option === -1 ? "Time ran out." : "That answer was not correct."} The answer was "${question.options[question.correct]}". ${question.explanation}`;
  return (
    <Narrator
      civ={target}
      className="narrator-docked neighbor-response"
      eyebrow={`${CIVS[target].name.toUpperCase()} RESPONDS · ${event.name.toUpperCase()}`}
      lines={[feedback, event.neighbor]}
      actions={
        <button className="primary" onClick={onContinue}>
          We must decide <ArrowRight size={16} />
        </button>
      }
    />
  );
}

function BuildPanel({
  state,
  civ,
  act,
  onEnd,
}: {
  state: GameState;
  civ: CivId;
  act: (a: Action) => void;
  onEnd: () => void;
}) {
  const town = state.civs[civ];
  const suggestedGive = [...RESOURCES].sort(
    (a, b) =>
      town.stock[b] -
      (upkeep(town)[b] ?? 0) -
      (town.stock[a] - (upkeep(town)[a] ?? 0)),
  )[0];
  const [give, setGive] = useState<Resource>(suggestedGive);
  const [get, setGet] = useState<Resource>(
    town.stock.wheat < (upkeep(town).wheat ?? 0) && suggestedGive !== "wheat"
      ? "wheat"
      : suggestedGive === "wood"
        ? "brick"
        : "wood",
  );
  const tradeError = actionError(state, { type: "exchange", civ, give, get });
  const lastTrade = [...state.news]
    .reverse()
    .find(
      (n) => n.kind === "trade" && n.civ === civ && n.round === state.round,
    );
  const foodGap = Math.max(
    0,
    (upkeep(town).wheat ?? 0) - town.stock.wheat - income(state, civ).wheat,
  );
  const [tab, setTab] = useState<"build" | "research">("build");
  const buildable = Object.entries(BUILDINGS).filter(([, b]) => !b.earned);
  return (
    <section className="build-panel" aria-label="Build">
      <header>
        <span className="eyebrow">
          BUILD · {townOf(civ).name.toUpperCase()}
        </span>
        <button className="primary" onClick={onEnd}>
          End turn <ArrowRight size={16} />
        </button>
      </header>
      <div className="planning-summary">
        <b>
          {Math.max(0, ECONOMY.actionsPerRound - (town.actionsUsed ?? 0))}/
          {ECONOMY.actionsPerRound} project actions · storage{" "}
          {ECONOMY.storageCapacity} per resource
        </b>
        <p>
          Next production: {describe(income(state, civ))}. Upkeep:{" "}
          {describe(upkeep(town))}.
        </p>
        {recommendations(state, civ)
          .slice(0, 2)
          .map((line) => (
            <p key={line}>{line}</p>
          ))}
        {(state.scheduled ?? [])
          .filter((h) => h.target === civ)
          .map((h) => (
            <p key={`${h.type}:${h.arrives}`}>
              ⚠ Round {h.arrives}: {EVENTS[h.type].name} from{" "}
              {CIVS[h.origin].name}. {h.reason}
            </p>
          ))}
        {town.research && (
          <p>
            Research: {RESEARCH[town.research.id].name} ·{" "}
            {town.research.remaining} round(s) remaining.
          </p>
        )}
      </div>
      <div className="project-tabs" aria-label="Project category">
        <button aria-pressed={tab === "build"} onClick={() => setTab("build")}>
          <Hammer size={20} aria-hidden="true" /> Build & recover
        </button>
        <button
          aria-pressed={tab === "research"}
          onClick={() => setTab("research")}
        >
          <FlaskConical size={20} aria-hidden="true" /> Research
        </button>
      </div>
      <div className="build-list">
        {tab === "build" &&
          recoveryNeeds(town).map((h) => {
            const err = actionError(state, {
              type: "contain",
              civ,
              hazard: h.type,
            });
            return (
              <button
                key={h.type}
                className="build-row recovery-row"
                disabled={!!err}
                title={
                  err ?? "Lower severity by 1 and shorten recovery by 2 rounds."
                }
                onClick={() => act({ type: "contain", civ, hazard: h.type })}
              >
                <span className="build-icon">{EVENTS[h.type].icon}</span>
                <span className="build-name">
                  <b>Recover: {EVENTS[h.type].name}</b>
                  <small>
                    Severity {h.severity.toFixed(1)} · {h.remaining} rounds.
                    Reduce severity and recovery time.
                  </small>
                </span>
                <Costs cost={recoveryCost(h.type)} />
              </button>
            );
          })}
        {tab === "research" &&
          Object.entries(RESEARCH).map(([id, t]) => {
            const done = technologies(town).includes(id);
            const err = actionError(state, {
              type: "research",
              civ,
              technology: id,
            });
            return (
              <button
                key={id}
                className="build-row green"
                disabled={done || !!err}
                title={err ?? t.description}
                onClick={() => act({ type: "research", civ, technology: id })}
              >
                <span className="build-icon">✧</span>
                <span className="build-name">
                  <b>
                    {t.name}{" "}
                    {done
                      ? "✓"
                      : `· ${t.turns} round${t.turns === 1 ? "" : "s"}`}
                  </b>
                  <small>
                    {t.description}
                    {err && !done ? ` ${err}` : ""}
                  </small>
                </span>
                <Costs cost={t.cost} />
              </button>
            );
          })}
        {tab === "build" &&
          buildable.map(([id, b]) => {
            const err = actionError(state, {
              type: "build",
              civ,
              building: id,
            });
            return (
              <button
                key={id}
                className={`build-row ${b.green ? "green" : ""} ${b.dirty ? "dirty" : ""}`}
                disabled={!!err}
                title={err ?? b.description}
                onClick={() => act({ type: "build", civ, building: id })}
              >
                <span className="build-icon">{b.icon}</span>
                <span className="build-name">
                  <b>{b.name}</b>
                  <small>{b.description}</small>
                </span>
                <Costs cost={b.cost} />
                <span className="build-count">
                  {builtCount(town, id)}/{b.max}
                </span>
              </button>
            );
          })}
      </div>
      <div className="exchange">
        <div className="trade-heading">
          <Ship size={20} aria-hidden="true" />
          <b>Harbor exchange</b>
          <span>No project action</span>
        </div>
        <p className="trade-guidance">
          {foodGap
            ? `Food shortfall: ${foodGap} wheat next round. Trade to cover upkeep.`
            : "Turn spare cargo into supplies for recovery, building and research."}
        </p>
        <ResourceIcon resource={give} size={24} />
        <select
          aria-label="Give"
          value={give}
          onChange={(e) => setGive(e.target.value as Resource)}
        >
          {RESOURCES.map((r) => (
            <option key={r} value={r}>
              {EXCHANGE_RATE} {RESOURCE_META[r].name}
            </option>
          ))}
        </select>
        <img
          className="trade-arrow"
          src={`/assets/arrows/${KINGDOM[civ]}-swap.png`}
          width={32}
          height={32}
          alt="for"
        />
        <ResourceIcon resource={get} size={24} />
        <select
          aria-label="Get"
          value={get}
          onChange={(e) => setGet(e.target.value as Resource)}
        >
          {RESOURCES.map((r) => (
            <option key={r} value={r}>
              1 {RESOURCE_META[r].name}
            </option>
          ))}
        </select>
        <button
          disabled={!!tradeError}
          title={
            tradeError ??
            `Ship ${EXCHANGE_RATE} ${RESOURCE_META[give].name} for 1 ${RESOURCE_META[get].name}`
          }
          className="trade-submit"
          onClick={() => act({ type: "exchange", civ, give, get })}
        >
          <Ship size={20} aria-hidden="true" /> Ship cargo
        </button>
        <p className="trade-preview">
          {EXCHANGE_RATE} {RESOURCE_META[give].name} → 1{" "}
          {RESOURCE_META[get].name} · In storage: {town.stock[give]} /{" "}
          {town.stock[get]}
        </p>
        <p className="trade-feedback" role="status">
          {lastTrade
            ? `${lastTrade.text}${tradeError ? ` ${tradeError}` : ""}`
            : (tradeError ??
              "Ready to sail. Trading does not use your three project actions.")}
        </p>
      </div>
    </section>
  );
}

function TownWindow({
  state,
  civ,
  onClose,
}: {
  state: GameState;
  civ: CivId;
  onClose: () => void;
}) {
  const counts: Record<string, number> = {};
  for (const b of state.civs[civ].buildings) counts[b] = (counts[b] ?? 0) + 1;
  const ev = state.events[civ];
  return (
    <section
      className="town-window"
      style={{ borderColor: CIVS[civ].color }}
      aria-label={`${townOf(civ).name} details`}
    >
      <header style={{ background: CIVS[civ].color }}>
        <b>
          {townOf(civ).name} · {CIVS[civ].name}
        </b>
        <button aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <p>{CIVS[civ].description}</p>
      {ev && (
        <p>
          <b>This decade:</b> {EVENTS[ev.type].name}
        </p>
      )}
      <p>
        <b>Makes each decade:</b> {describe(income(state, civ))}
      </p>
      <p>
        <b>Upkeep:</b> {describe(upkeep(state.civs[civ]))}
      </p>
      {recoveryNeeds(state.civs[civ]).map((h) => (
        <p key={h.type}>
          <b>{EVENTS[h.type].name} recovery:</b> severity{" "}
          {h.severity.toFixed(1)} · {h.remaining} rounds left.
        </p>
      ))}
      <p>
        <b>Research:</b>{" "}
        {technologies(state.civs[civ])
          .map((t) => RESEARCH[t].name)
          .join(", ") || "None completed"}
      </p>
      <ul>
        {Object.entries(counts).map(([id, n]) => (
          <li key={id}>
            {BUILDINGS[id]?.icon} {BUILDINGS[id]?.name} ×{n}
          </li>
        ))}
      </ul>
      <p>
        <b>{score(state, civ)} points</b> · {greenCount(state, civ)} green
        buildings
      </p>
    </section>
  );
}

function Endgame({
  state,
  onRestart,
}: {
  state: GameState;
  onRestart: () => void;
}) {
  const ranking = CIV_IDS.map((id) => ({ id, score: score(state, id) })).sort(
    (a, b) => b.score - a.score,
  );
  const max = Math.max(CLIMATE_LOSS, ...state.history.map((h) => h.climate));
  const y = (c: number) => 80 - (c / max) * 72;
  return (
    <section className="endgame">
      <div className="end-emblem">
        {state.outcome === "collapse" ? "⌁" : "✧"}
      </div>
      <span className="eyebrow">YOUR LEGACY / DECADE {state.round}</span>
      <h2>
        {state.collapseCause
          ? "The catastrophic tsunami destroyed the world."
          : state.outcome === "collapse"
            ? "No one wins on a broken planet."
            : "The valley made it through."}
      </h2>
      <p>
        {state.collapseCause
          ? "All four civilizations were destroyed. The ground was torn apart and the world flooded. No civilization survived."
          : state.outcome === "collapse"
            ? `Warming crossed +${CLIMATE_LOSS}°C, so every town lost. Cheap fixes and polluting buildings added up.`
            : `Warming ended at +${state.climate.toFixed(2)}°C. Surviving buildings and completed research earn prosperity; food and maintenance shortages subtract points.`}
      </p>
      {state.outcome !== "collapse" && (
        <div className="ranking">
          {ranking.map((r, i) => (
            <article key={r.id}>
              <span>{i + 1}</span>
              <b style={{ color: CIVS[r.id].color }}>
                {CIVS[r.id].crest} {CIVS[r.id].name}
              </b>
              <small>{greenCount(state, r.id)} green</small>
              <strong>{r.score}</strong>
            </article>
          ))}
        </div>
      )}
      <svg
        className="climate-chart"
        viewBox="0 0 300 80"
        aria-label="Warming by decade"
      >
        <line
          x1="0"
          x2="300"
          y1={y(CLIMATE_LOSS)}
          y2={y(CLIMATE_LOSS)}
          stroke="#8c2929"
          strokeDasharray="4 4"
        />
        <polyline
          fill="none"
          stroke="#e8642c"
          strokeWidth="3"
          points={state.history
            .map(
              (h, i) =>
                `${(i * 300) / Math.max(1, state.history.length - 1)},${y(h.climate)}`,
            )
            .join(" ")}
        />
      </svg>
      <button className="primary" onClick={onRestart}>
        Start another future <ArrowRight size={17} />
      </button>
    </section>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <button
          className="close-modal"
          onClick={onClose}
          aria-label="Close instructions"
        >
          <X />
        </button>
        <Leaf size={32} />
        <span className="eyebrow">WELCOME TO THE VALLEY</span>
        <h2 id="help-title">Build well. Think downstream.</h2>
        <ol>
          <li>
            <b>Hear the event.</b> Every decade your advisor tells you what is
            about to hit your town: a flood, a drought, smog drifting in.
          </li>
          <li>
            <b>Answer the question.</b> One timed question about that event. A
            right answer softens the losses.
          </li>
          <li>
            <b>Choose.</b> A cheap fix contains some damage but may shift
            pressure onto a neighbor or warm the planet. Sustainable responses
            reduce damage, shorten recovery and build lasting protection.
          </li>
          <li>
            <b>Build.</b> Spend sheep, wheat, wood, brick and ore to grow your
            town. Some buildings pollute; trees and windmills pull warming back.
            Trade 3:1 with the bank for what you lack. Keep wheat for food
            upkeep; storage holds {ECONOMY.storageCapacity} of each resource.
          </li>
          <li>
            <b>Plan recovery and research.</b> Each round allows{" "}
            {ECONOMY.actionsPerRound} project actions for building, recovery or
            starting research. Disasters reduce output over several rounds and
            can destroy exposed buildings. Use the Research tab for clean energy
            and resilience; projects finish over time.
          </li>
          <li>
            <b>Leave a legacy.</b> Research adds prosperity; shortages subtract
            it. After ten decades the strongest town wins, but if warming
            reaches +3°C, every town loses.
          </li>
        </ol>
        <button className="primary full" onClick={onClose}>
          Let’s build a better future <ArrowRight size={17} />
        </button>
      </section>
    </div>
  );
}

function validSave(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const s = value as GameState;
  return (
    s.version === 2 &&
    Number.isInteger(s.round) &&
    s.round >= 1 &&
    s.round <= ROUNDS &&
    Number.isFinite(s.seed) &&
    Number.isFinite(s.climate) &&
    CIV_IDS.includes(s.player) &&
    ["solo", "hotseat"].includes(s.mode) &&
    ["event", "quiz", "response", "choice", "build", "ended"].includes(
      s.phase,
    ) &&
    Array.isArray(s.humans) &&
    CIV_IDS.every(
      (id) =>
        s.civs?.[id] &&
        RESOURCES.every((r) => Number.isFinite(s.civs[id].stock?.[r])) &&
        Array.isArray(s.civs[id].buildings) &&
        s.civs[id].buildings.every((b) => BUILDINGS[b]) &&
        EVENTS[s.events?.[id]?.type],
    )
  );
}
