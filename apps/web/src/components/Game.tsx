"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Download,
  Leaf,
  RotateCcw,
  X,
} from "lucide-react";
import {
  BUILDINGS,
  CIVS,
  EVENTS,
  REACTIONS,
  RESOURCE_META,
} from "@/game/content";
import {
  CLIMATE_LOSS,
  EXCHANGE_RATE,
  QUIZ_MS,
  ROUNDS,
  actionError,
  activeEmbargoes,
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
  legalRedirectTargets,
  normalizeGameState,
  pendingFor,
  questionFor,
  reactionCost,
  responseTarget,
  score,
  spillTarget,
} from "@/game/engine";
import { QUESTIONS } from "@/game/questions";
import {
  type Action,
  CIV_IDS,
  type CivId,
  type EffectReaction,
  type GameState,
  type PendingEffect,
  RESOURCES,
  type Resource,
  type Stock,
} from "@/game/types";
import { decadeLine, eventLines, introLines } from "@/game/leaders";
import { townOf } from "@/game/towns";
import { useWorld } from "@/game/useWorld";
import LeaderSelect from "./LeaderSelect";
import Narrator from "./Narrator";
import WorldMap from "./WorldMap";

const SAVE_KEY = "earthshare-v3";
const LEGACY_SAVE_KEY = "earthshare-v2";

function Costs({ cost }: { cost: Partial<Stock> }) {
  const entries = RESOURCES.filter((r) => (cost[r] ?? 0) > 0);
  if (!entries.length) return <span className="costs free">Free</span>;
  return (
    <span className="costs">
      {entries.map((r) => (
        <span key={r} title={RESOURCE_META[r].name}>
          {cost[r]}
          {RESOURCE_META[r].icon}
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
    [seed, setSeed] = useState("260926");
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
      const raw =
        localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(LEGACY_SAVE_KEY);
      if (raw) {
        const s = normalizeGameState(JSON.parse(raw));
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
      if (state.phase === "reaction") return pendingFor(state, c).length > 0;
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
    setState(createGame(civ, mode, Number(seed) || 260926));
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
    a.download = `earthshare-decade-${state.round}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importSave(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error("Save is too large.");
      const data = normalizeGameState(JSON.parse(await file.text()));
      if (!validSave(data)) throw Error("This is not a valid Earthshare save.");
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
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
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
          <div className="ls-option-group online-setup">
            <b>PLAY A SHARED WORLD</b>
            <p>
              Live rooms use SpacetimeDB. You claim the leader you picked;
              unclaimed towns are run by AI neighbors.
            </p>
            <label>
              Room code{" "}
              <input
                aria-label="Room code"
                maxLength={6}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
              />
            </label>
            <div className="setup-footer">
              <button
                onClick={() => {
                  const id = Array.from(
                    crypto.getRandomValues(new Uint8Array(6)),
                    (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32],
                  ).join("");
                  setRoomCode(id);
                  void world.connect(
                    id,
                    choice,
                    Number(seed) || 260926,
                    mode === "solo",
                  );
                }}
              >
                Create {mode === "solo" ? "saved solo" : "multiplayer"} world
              </button>
              <button onClick={() => void world.connect(roomCode, choice)}>
                Join / reconnect
              </button>
            </div>
            <span role="status">{world.status}</span>
            {world.error && (
              <p role="alert" className="error">
                {world.error}
              </p>
            )}
          </div>
        </LeaderSelect>
        {help && <Help onClose={() => setHelp(false)} />}
      </>
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
    reaction: "The valley reacts",
    build: "Build your town",
    ended: "Your legacy",
  };
  const waiting = (done: boolean) =>
    done && state.phase !== "ended" ? (
      <div className="waiting-banner" role="status">
        Waiting for the other towns…
      </div>
    ) : null;

  return (
    <main className="game-app world-view">
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
            earthshare<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-bottom">
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

        <div className="content-area">
          {state.phase === "ended" ? (
            <Endgame state={state} onRestart={backToSetup} />
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
                    actions={
                      <button
                        className="primary"
                        disabled={online && !world.isHost}
                        onClick={() => {
                          setHeard(`${state.seed}:${state.round}`);
                          if (online) void world.advance();
                          else setState(advance(state));
                        }}
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

              {state.phase === "reaction" &&
                (pendingFor(state, civId)[0] ? (
                  <ReactionBox
                    key={pendingFor(state, civId)[0].id}
                    state={state}
                    civ={civId}
                    effect={pendingFor(state, civId)[0]}
                    onReact={(reaction) =>
                      act({
                        type: "react",
                        civ: civId,
                        effectId: pendingFor(state, civId)[0].id,
                        kind: reaction.kind,
                        redirectTo: reaction.redirectTo,
                        resource: reaction.resource,
                      })
                    }
                  />
                ) : (
                  waiting(true)
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
        </div>

        <div className="civ-bar">
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
          {RESOURCES.map((r) => {
            const embargo = activeEmbargoes(state, civId).find(
              (item) => item.resource === r,
            );
            return (
              <div key={r} className="resource">
                <span className="resource-icon">{RESOURCE_META[r].icon}</span>
                <div>
                  <small>{RESOURCE_META[r].name}</small>
                  <b>{civ.stock[r]}</b>
                </div>
                <span
                  className={embargo ? "negative" : "positive"}
                  title={
                    embargo
                      ? `Embargoed by ${CIVS[embargo.by].name}: income reduced this decade`
                      : "Gained every decade"
                  }
                >
                  +{gain[r]}
                  <small>{embargo ? "/decade · embargo" : "/decade"}</small>
                </span>
              </div>
            );
          })}
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

function ReactionBox({
  state,
  civ,
  effect,
  onReact,
}: {
  state: GameState;
  civ: CivId;
  effect: PendingEffect;
  onReact: (reaction: EffectReaction) => void;
}) {
  const targets = legalRedirectTargets(effect);
  const [redirectTo, setRedirectTo] = useState<CivId | undefined>(targets[0]);
  const [resource, setResource] = useState<Resource>("wheat");
  const affordable = (kind: EffectReaction["kind"]) =>
    canAfford(state.civs[civ].stock, reactionCost(kind));
  return (
    <Narrator
      civ={civ}
      className="narrator-docked reaction-dialogue"
      eyebrow={`INCOMING · ${EVENTS[effect.event].name.toUpperCase()} FROM ${CIVS[effect.from].name.toUpperCase()}`}
      lines={[
        `${CIVS[effect.from].name} pushed ${describe(effect.loss)} toward ${townOf(civ).name}. Choose how we answer before the damage lands.`,
      ]}
      actions={
        <div className="choice-cards reaction-cards">
          <button
            className="choice-card green"
            disabled={!affordable("absorb")}
            onClick={() => onReact({ kind: "absorb" })}
          >
            <small>MITIGATE</small>
            <b>{REACTIONS.absorb.label}</b>
            <Costs cost={reactionCost("absorb")} />
            <span>{REACTIONS.absorb.description}</span>
          </button>
          <div className="choice-card reaction-option">
            <small>REROUTE</small>
            <b>{REACTIONS.redirect.label}</b>
            <Costs cost={reactionCost("redirect")} />
            {targets.length ? (
              <select
                aria-label="Redirect target"
                value={redirectTo}
                onChange={(event) => setRedirectTo(event.target.value as CivId)}
              >
                {targets.map((target) => (
                  <option key={target} value={target}>
                    {CIVS[target].name}
                  </option>
                ))}
              </select>
            ) : (
              <em>No legal route from here</em>
            )}
            <button
              disabled={!redirectTo || !affordable("redirect")}
              onClick={() => onReact({ kind: "redirect", redirectTo })}
            >
              Redirect effect
            </button>
          </div>
          <div className="choice-card reaction-option embargo-option">
            <small>RETALIATE</small>
            <b>{REACTIONS.embargo.label}</b>
            <Costs cost={reactionCost("embargo")} />
            <select
              aria-label="Resource to embargo"
              value={resource}
              onChange={(event) => setResource(event.target.value as Resource)}
            >
              {RESOURCES.map((item) => (
                <option key={item} value={item}>
                  {RESOURCE_META[item].name}
                </option>
              ))}
            </select>
            <button onClick={() => onReact({ kind: "embargo", resource })}>
              Embargo {CIVS[effect.from].name}
            </button>
          </div>
          <button
            className="choice-brace"
            onClick={() => onReact({ kind: "accept" })}
          >
            <b>{REACTIONS.accept.label}</b>
            <span>{REACTIONS.accept.description}</span>
          </button>
        </div>
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
  const [give, setGive] = useState<Resource>("brick");
  const [get, setGet] = useState<Resource>("wood");
  const buildable = Object.entries(BUILDINGS).filter(([, b]) => !b.earned);
  const embargoes = activeEmbargoes(state, civ);
  const exchangeError = actionError(state, {
    type: "exchange",
    civ,
    give,
    get,
  });
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
      {embargoes.length > 0 && (
        <p className="embargo-warning" role="status">
          Bank trade is blocked this decade.{" "}
          {embargoes
            .map(
              (item) =>
                `${CIVS[item.by].name} also reduced ${RESOURCE_META[item.resource].name} income`,
            )
            .join("; ")}
          .
        </p>
      )}
      <div className="build-list">
        {buildable.map(([id, b]) => {
          const err = actionError(state, { type: "build", civ, building: id });
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
        <span>Bank trade {EXCHANGE_RATE}:1</span>
        <select
          aria-label="Give"
          value={give}
          onChange={(e) => setGive(e.target.value as Resource)}
        >
          {RESOURCES.map((r) => (
            <option key={r} value={r}>
              {EXCHANGE_RATE} {RESOURCE_META[r].icon} {RESOURCE_META[r].name}
            </option>
          ))}
        </select>
        <span>→</span>
        <select
          aria-label="Get"
          value={get}
          onChange={(e) => setGet(e.target.value as Resource)}
        >
          {RESOURCES.map((r) => (
            <option key={r} value={r}>
              1 {RESOURCE_META[r].icon} {RESOURCE_META[r].name}
            </option>
          ))}
        </select>
        <button
          disabled={!!exchangeError}
          title={exchangeError ?? "Exchange resources"}
          onClick={() => act({ type: "exchange", civ, give, get })}
        >
          Trade
        </button>
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
      {activeEmbargoes(state, civ).map((embargo) => (
        <p
          key={`${embargo.by}:${embargo.resource}`}
          className="embargo-warning"
        >
          <b>Embargo:</b> {CIVS[embargo.by].name} blocks bank exchange and
          reduces {RESOURCE_META[embargo.resource].name} income this decade.
        </p>
      ))}
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
        {state.outcome === "collapse"
          ? "No one wins on a broken planet."
          : "The valley made it through."}
      </h2>
      <p>
        {state.outcome === "collapse"
          ? `Warming crossed +${CLIMATE_LOSS}°C, so every town lost. Cheap fixes and polluting buildings added up.`
          : `Warming ended at +${state.climate.toFixed(2)}°C. Points come from everything your town built; sustainable choices earn protective buildings that count too.`}
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
            <b>Choose.</b> The cheap fix stops the damage now but pushes it onto
            a neighbor or warms the planet. The sustainable fix costs more,
            halves the damage and builds lasting protection.
          </li>
          <li>
            <b>React.</b> If a neighbor sends harm your way, absorb it, redirect
            it along a legal route, retaliate with a one-decade embargo, or take
            the full hit.
          </li>
          <li>
            <b>Build.</b> Spend sheep, wheat, wood, brick and ore to grow your
            town. Some buildings pollute; trees and windmills pull warming back.
            Trade 3:1 with the bank for what you lack.
          </li>
          <li>
            <b>Leave a legacy.</b> After ten decades the biggest town wins, but
            if warming reaches +3°C, every town loses.
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
    s.version === 3 &&
    Number.isInteger(s.round) &&
    s.round >= 1 &&
    s.round <= ROUNDS &&
    Number.isFinite(s.seed) &&
    Number.isFinite(s.climate) &&
    CIV_IDS.includes(s.player) &&
    ["solo", "hotseat"].includes(s.mode) &&
    [
      "event",
      "quiz",
      "response",
      "choice",
      "reaction",
      "build",
      "ended",
    ].includes(s.phase) &&
    Array.isArray(s.pendingEffects) &&
    Array.isArray(s.embargoes) &&
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
