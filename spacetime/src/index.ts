import {
  schema,
  table,
  t,
  SenderError,
  type ReducerCtx,
} from "spacetimedb/server";
import {
  advance as advanceEvent,
  answerQuiz,
  applyAction,
  createGame,
  normalizeGameState,
} from "../../apps/web/src/game/engine";
import {
  type Action,
  CIV_IDS,
  type CivId,
  type GameState,
  RESOURCES,
} from "../../apps/web/src/game/types";

const room = table(
  { name: "room", public: true },
  {
    id: t.string().primaryKey(),
    host: t.identity(),
    revision: t.u32(),
    stateJson: t.string(),
  },
);
const seat = table(
  { name: "seat", public: true },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index("btree"),
    identity: t.identity(),
    civ: t.string(),
    ready: t.bool(),
  },
);
const quizClock = table(
  { name: "quiz_clock" },
  {
    id: t.string().primaryKey(),
    startedMicros: t.u64(),
    questionId: t.string(),
  },
);
const database = schema({ room, seat, quizClock });
export default database;
type Ctx = ReducerCtx<typeof database.schemaType>;
const code = (value: string) => {
  if (!/^[A-Z0-9]{6}$/.test(value))
    throw new SenderError("Use a six-character room code.");
  return value;
};
const getRoom = (ctx: Ctx, id: string) => {
  const value = ctx.db.room.id.find(code(id));
  if (!value) throw new SenderError("World not found.");
  return value;
};
const getSeat = (ctx: Ctx, id: string) => {
  const value = [...ctx.db.seat.iter()].find(
    (s) => s.roomId === id && s.identity.isEqual(ctx.sender),
  );
  if (!value) throw new SenderError("Claim a civilization in this room first.");
  return value;
};
function save(ctx: Ctx, row: ReturnType<typeof getRoom>, state: GameState) {
  ctx.db.room.id.update({
    ...row,
    revision: row.revision + 1,
    stateJson: JSON.stringify(state),
  });
}
function validateAction(value: unknown, civ: CivId): Action {
  if (!value || typeof value !== "object")
    throw new SenderError("Invalid action.");
  const a = value as Record<string, unknown>;
  if (a.civ !== civ)
    throw new SenderError("You can only act for your civilization.");
  if (a.type === "acknowledge") {
    // No payload beyond the authenticated civilization.
  } else if (a.type === "choose") {
    if (![0, 1, 2].includes(a.option as number))
      throw new SenderError("Unknown option.");
  } else if (a.type === "react") {
    if (
      typeof a.effectId !== "string" ||
      a.effectId.length > 120 ||
      !["absorb", "redirect", "embargo", "accept"].includes(a.kind as string)
    )
      throw new SenderError("Invalid reaction.");
    if (a.redirectTo !== undefined && !CIV_IDS.includes(a.redirectTo as CivId))
      throw new SenderError("Unknown redirect target.");
    if (a.resource !== undefined && !RESOURCES.includes(a.resource as never))
      throw new SenderError("Unknown embargo resource.");
  } else if (a.type === "build") {
    if (typeof a.building !== "string" || a.building.length > 40)
      throw new SenderError("Invalid building.");
  } else if (a.type === "exchange") {
    if (
      !RESOURCES.includes(a.give as never) ||
      !RESOURCES.includes(a.get as never)
    )
      throw new SenderError("Unknown resource.");
  } else if (a.type !== "ready") throw new SenderError("Unknown action.");
  return a as unknown as Action;
}
export const createWorld = database.reducer(
  { roomId: t.string(), civ: t.string(), seed: t.u32(), solo: t.bool() },
  (ctx, args) => {
    const id = code(args.roomId);
    if (ctx.db.room.id.find(id))
      throw new SenderError("Room code already exists. Try another.");
    if (!CIV_IDS.includes(args.civ as CivId))
      throw new SenderError("Unknown civilization.");
    if (
      [...ctx.db.room.iter()].filter((r) => r.host.isEqual(ctx.sender))
        .length >= 20
    )
      throw new SenderError("This identity has reached the 20-world limit.");
    const state = createGame(
      args.civ as CivId,
      args.solo ? "solo" : "hotseat",
      args.seed,
      [args.civ as CivId],
    );
    ctx.db.room.insert({
      id,
      host: ctx.sender,
      revision: 1,
      stateJson: JSON.stringify(state),
    });
    ctx.db.seat.insert({
      id: id + ":" + args.civ,
      roomId: id,
      identity: ctx.sender,
      civ: args.civ,
      ready: false,
    });
  },
);
export const joinWorld = database.reducer(
  { roomId: t.string(), civ: t.string() },
  (ctx, args) => {
    const row = getRoom(ctx, args.roomId),
      state = normalizeGameState(JSON.parse(row.stateJson));
    if (state.mode === "solo" || state.round !== 1 || state.phase !== "event")
      throw new SenderError("This world is not accepting new players.");
    if (!CIV_IDS.includes(args.civ as CivId))
      throw new SenderError("Unknown civilization.");
    if (
      [...ctx.db.seat.iter()].some(
        (s) => s.roomId === row.id && s.identity.isEqual(ctx.sender),
      )
    )
      throw new SenderError("You already have a civilization here.");
    if (ctx.db.seat.id.find(row.id + ":" + args.civ))
      throw new SenderError("That civilization is already claimed.");
    ctx.db.seat.insert({
      id: row.id + ":" + args.civ,
      roomId: row.id,
      identity: ctx.sender,
      civ: args.civ,
      ready: false,
    });
    state.humans = [...new Set([...state.humans, args.civ as CivId])];
    save(ctx, row, state);
  },
);
export const act = database.reducer(
  { roomId: t.string(), revision: t.u32(), actionJson: t.string() },
  (ctx, args) => {
    const row = getRoom(ctx, args.roomId),
      seat = getSeat(ctx, row.id);
    if (row.revision !== args.revision)
      throw new SenderError("The world changed. Refresh and retry.");
    if (args.actionJson.length > 3000)
      throw new SenderError("Action is too large.");
    const action = validateAction(
      JSON.parse(args.actionJson),
      seat.civ as CivId,
    );
    const result = applyAction(
      normalizeGameState(JSON.parse(row.stateJson)),
      action,
    );
    if (result.error) throw new SenderError(result.error);
    save(ctx, row, result.state);
  },
);
export const ready = database.reducer({ roomId: t.string() }, (ctx, args) => {
  const row = getRoom(ctx, args.roomId),
    seat = getSeat(ctx, row.id);
  const result = applyAction(normalizeGameState(JSON.parse(row.stateJson)), {
    type: "ready",
    civ: seat.civ as CivId,
  });
  if (result.error) throw new SenderError(result.error);
  ctx.db.seat.id.update({ ...seat, ready: true });
  if (result.state.phase !== "build")
    for (const s of [...ctx.db.seat.iter()].filter((s) => s.roomId === row.id))
      ctx.db.seat.id.update({ ...s, ready: false });
  save(ctx, row, result.state);
});
export const advance = database.reducer({ roomId: t.string() }, (ctx, args) => {
  const row = getRoom(ctx, args.roomId);
  getSeat(ctx, row.id);
  if (!row.host.isEqual(ctx.sender))
    throw new SenderError("Only the host moves the world on.");
  const state = normalizeGameState(JSON.parse(row.stateJson));
  if (state.phase !== "event")
    throw new SenderError("Finish the current phase first.");
  save(ctx, row, advanceEvent(state));
});
export const beginQuestion = database.reducer(
  { roomId: t.string(), questionId: t.string() },
  (ctx, args) => {
    const row = getRoom(ctx, args.roomId),
      seat = getSeat(ctx, row.id),
      state = normalizeGameState(JSON.parse(row.stateJson));
    const quiz = state.civs[seat.civ as CivId].quiz;
    if (
      state.phase !== "quiz" ||
      quiz?.questionId !== args.questionId ||
      quiz.option !== undefined
    )
      throw new SenderError("This question is not active.");
    const id = row.id + ":" + seat.civ + ":" + args.questionId;
    if (!ctx.db.quizClock.id.find(id))
      ctx.db.quizClock.insert({
        id,
        startedMicros: ctx.timestamp.microsSinceUnixEpoch,
        questionId: args.questionId,
      });
  },
);
export const answer = database.reducer(
  {
    roomId: t.string(),
    questionId: t.string(),
    option: t.i32(),
    lifeline: t.bool(),
  },
  (ctx, args) => {
    const row = getRoom(ctx, args.roomId),
      seat = getSeat(ctx, row.id),
      state = normalizeGameState(JSON.parse(row.stateJson));
    const quiz = state.civs[seat.civ as CivId].quiz;
    if (
      state.phase !== "quiz" ||
      quiz?.questionId !== args.questionId ||
      quiz.option !== undefined
    )
      throw new SenderError("This question is no longer active.");
    if (args.option < -1 || args.option > 3)
      throw new SenderError("Invalid answer.");
    const clock = ctx.db.quizClock.id.find(
      row.id + ":" + seat.civ + ":" + args.questionId,
    );
    if (!clock) throw new SenderError("Start the question before answering.");
    const ms = Number(
      (ctx.timestamp.microsSinceUnixEpoch - clock.startedMicros) / 1000n,
    );
    const result = answerQuiz(
      state,
      seat.civ as CivId,
      args.option,
      Math.max(0, ms),
    );
    ctx.db.quizClock.id.delete(clock.id);
    save(ctx, row, result);
  },
);
