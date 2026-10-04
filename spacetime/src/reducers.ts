import { SenderError, t } from "spacetimedb/server";
import {
  advance,
  answerQuiz,
  applyAction,
  createGame,
} from "../../packages/game-core/src/engine";
import {
  RESOURCES,
  type Action,
  type CivId,
  type EventId,
  type Resource,
} from "../../packages/game-core/src/types";
import {
  assertHost,
  assertRevision,
  civilization,
  getSeat,
  getWorld,
  roomCode,
} from "./auth";
import { loadState, publicSnapshot, saveWorld } from "./persistence";
import { database, type Ctx } from "./schema";

function active(row: ReturnType<typeof getWorld>) {
  if (row.status !== "active")
    throw new SenderError("The world is not active.");
}

function runAction(
  ctx: Ctx,
  worldId: string,
  expectedRevision: number,
  makeAction: (civ: CivId) => Action,
) {
  const row = getWorld(ctx, worldId);
  active(row);
  assertRevision(row, expectedRevision);
  const seat = getSeat(ctx, row.id);
  const result = applyAction(
    loadState(ctx, row.id),
    makeAction(seat.civ as CivId),
  );
  if (result.error) throw new SenderError(result.error);
  saveWorld(ctx, row, result.state);
  return { row, seat, state: result.state };
}

export const worldCreate = database.reducer(
  { worldId: t.string(), civ: t.string(), seed: t.u32(), solo: t.bool() },
  (ctx, args) => {
    const id = roomCode(args.worldId);
    if (ctx.db.world.id.find(id))
      throw new SenderError("Room code already exists. Try another.");
    const civ = civilization(args.civ);
    if (
      [...ctx.db.world.iter()].filter((row) => row.host.isEqual(ctx.sender))
        .length >= 20
    )
      throw new SenderError("This identity has reached the 20-world limit.");

    const state = createGame(civ, args.solo ? "solo" : "hotseat", args.seed, [
      civ,
    ]);
    const status = args.solo ? "active" : "lobby";
    ctx.db.world.insert({
      id,
      host: ctx.sender,
      revision: 1,
      status,
      round: state.round,
      phase: state.phase,
      mode: state.mode,
      started: args.solo,
      snapshotJson: JSON.stringify(publicSnapshot(state)),
      updatedMicros: ctx.timestamp.microsSinceUnixEpoch,
    });
    ctx.db.worldState.insert({ worldId: id, stateJson: JSON.stringify(state) });
    ctx.db.seat.insert({
      id: `${id}:${civ}`,
      worldId: id,
      identity: ctx.sender,
      civ,
      ready: false,
      joinedMicros: ctx.timestamp.microsSinceUnixEpoch,
    });
  },
);

export const worldJoin = database.reducer(
  { worldId: t.string(), civ: t.string() },
  (ctx, args) => {
    const row = getWorld(ctx, args.worldId);
    if (row.status !== "lobby")
      throw new SenderError("This world is not accepting new players.");
    const civ = civilization(args.civ);
    if (
      [...ctx.db.seat.iter()].some(
        (seat) => seat.worldId === row.id && seat.identity.isEqual(ctx.sender),
      )
    )
      throw new SenderError("You already have a civilization here.");
    if (ctx.db.seat.id.find(`${row.id}:${civ}`))
      throw new SenderError("That civilization is already claimed.");

    ctx.db.seat.insert({
      id: `${row.id}:${civ}`,
      worldId: row.id,
      identity: ctx.sender,
      civ,
      ready: false,
      joinedMicros: ctx.timestamp.microsSinceUnixEpoch,
    });
    const state = loadState(ctx, row.id);
    state.humans = [...new Set([...state.humans, civ])];
    saveWorld(ctx, row, state);
  },
);

export const worldStart = database.reducer(
  { worldId: t.string(), expectedRevision: t.u32() },
  (ctx, args) => {
    const row = getWorld(ctx, args.worldId);
    assertHost(ctx, row);
    assertRevision(row, args.expectedRevision);
    if (row.status !== "lobby")
      throw new SenderError("This lobby has already started.");
    saveWorld(ctx, row, loadState(ctx, row.id), {
      status: "active",
      started: true,
    });
  },
);

export const phaseAdvance = database.reducer(
  { worldId: t.string(), expectedRevision: t.u32() },
  (ctx, args) => {
    const row = getWorld(ctx, args.worldId);
    active(row);
    assertHost(ctx, row);
    assertRevision(row, args.expectedRevision);
    const state = loadState(ctx, row.id);
    if (state.phase !== "event")
      throw new SenderError("Finish the current phase first.");
    saveWorld(ctx, row, advance(state));
  },
);

export const quizStart = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    questionId: t.string(),
  },
  (ctx, args) => {
    const row = getWorld(ctx, args.worldId);
    active(row);
    assertRevision(row, args.expectedRevision);
    const seat = getSeat(ctx, row.id);
    const state = loadState(ctx, row.id);
    const quiz = state.civs[seat.civ as CivId].quiz;
    if (
      state.phase !== "quiz" ||
      quiz?.questionId !== args.questionId ||
      quiz.option !== undefined
    )
      throw new SenderError("This question is not active.");
    const id = `${row.id}:${seat.civ}:${args.questionId}`;
    if (!ctx.db.quizTimer.id.find(id))
      ctx.db.quizTimer.insert({
        id,
        worldId: row.id,
        questionId: args.questionId,
        startedMicros: ctx.timestamp.microsSinceUnixEpoch,
      });
  },
);

export const quizSubmit = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    questionId: t.string(),
    option: t.i32(),
  },
  (ctx, args) => {
    const row = getWorld(ctx, args.worldId);
    active(row);
    assertRevision(row, args.expectedRevision);
    const seat = getSeat(ctx, row.id);
    const state = loadState(ctx, row.id);
    const civ = seat.civ as CivId;
    const quiz = state.civs[civ].quiz;
    if (
      state.phase !== "quiz" ||
      quiz?.questionId !== args.questionId ||
      quiz.option !== undefined
    )
      throw new SenderError("This question is no longer active.");
    if (args.option < -1 || args.option > 3)
      throw new SenderError("Invalid answer.");
    const timerId = `${row.id}:${civ}:${args.questionId}`;
    const timer = ctx.db.quizTimer.id.find(timerId);
    if (!timer) throw new SenderError("Start the question before answering.");
    const elapsedMs = Number(
      (ctx.timestamp.microsSinceUnixEpoch - timer.startedMicros) / 1000n,
    );
    ctx.db.quizTimer.id.delete(timerId);
    saveWorld(
      ctx,
      row,
      answerQuiz(state, civ, args.option, Math.max(0, elapsedMs)),
    );
  },
);

export const acknowledge = database.reducer(
  { worldId: t.string(), expectedRevision: t.u32() },
  (ctx, args) =>
    void runAction(ctx, args.worldId, args.expectedRevision, (civ) => ({
      type: "acknowledge",
      civ,
    })),
);

export const choose = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    option: t.i32(),
  },
  (ctx, args) => {
    if (args.option < 0 || args.option > 2)
      throw new SenderError("Unknown option.");
    runAction(ctx, args.worldId, args.expectedRevision, (civ) => ({
      type: "choose",
      civ,
      option: args.option as 0 | 1 | 2,
    }));
  },
);

export const build = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    building: t.string(),
  },
  (ctx, args) =>
    void runAction(ctx, args.worldId, args.expectedRevision, (civ) => ({
      type: "build",
      civ,
      building: args.building,
    })),
);

export const exchange = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    give: t.string(),
    get: t.string(),
  },
  (ctx, args) => {
    if (
      !RESOURCES.includes(args.give as Resource) ||
      !RESOURCES.includes(args.get as Resource)
    )
      throw new SenderError("Unknown resource.");
    runAction(ctx, args.worldId, args.expectedRevision, (civ) => ({
      type: "exchange",
      civ,
      give: args.give as Resource,
      get: args.get as Resource,
    }));
  },
);

export const research = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    technology: t.string(),
  },
  (ctx, args) =>
    void runAction(ctx, args.worldId, args.expectedRevision, (civ) => ({
      type: "research",
      civ,
      technology: args.technology,
    })),
);

export const contain = database.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    hazard: t.string(),
  },
  (ctx, args) =>
    void runAction(ctx, args.worldId, args.expectedRevision, (civ) => ({
      type: "contain",
      civ,
      hazard: args.hazard as EventId,
    })),
);

export const turnReady = database.reducer(
  { worldId: t.string(), expectedRevision: t.u32() },
  (ctx, args) => {
    const result = runAction(
      ctx,
      args.worldId,
      args.expectedRevision,
      (civ) => ({ type: "ready", civ }),
    );
    ctx.db.seat.id.update({ ...result.seat, ready: true });
    if (result.state.phase !== "build")
      for (const seat of [...ctx.db.seat.iter()].filter(
        (candidate) => candidate.worldId === result.row.id,
      ))
        ctx.db.seat.id.update({ ...seat, ready: false });
  },
);
