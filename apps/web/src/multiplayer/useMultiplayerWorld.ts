"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DbConnection } from "@/module_bindings";
import type { Action, CivId, GameState, PublicGameState } from "@/game/types";
import { multiplayerConfig } from "./config";
import { identityTokenKey, multiplayerIdentityToken } from "./identity";

type ConnectionPhase =
  "offline" | "connecting" | "live" | "reconnecting" | "disconnected";

interface Intent {
  id: string;
  civ: CivId;
  seed?: number;
  solo: boolean;
}

const hydrate = (snapshot: PublicGameState): GameState => {
  const { visualSeed, ...state } = snapshot;
  return { ...state, seed: visualSeed, rng: 0 };
};

export function useMultiplayerWorld(onState: (state: GameState) => void) {
  const connection = useRef<DbConnection | null>(null);
  const callback = useRef(onState);
  callback.current = onState;
  const desired = useRef<Intent | undefined>(undefined);
  const revisionRef = useRef(0);
  const retry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const intentionalDisconnect = useRef(false);
  const openRef = useRef<
    ((intent: Intent, reconnect: boolean) => Promise<void>) | undefined
  >(undefined);

  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState("Offline practice");
  const [phase, setPhase] = useState<ConnectionPhase>("offline");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [civilization, setCivilization] = useState<CivId>();
  const [isHost, setIsHost] = useState(false);
  const [started, setStarted] = useState(false);
  const [worldStatus, setWorldStatus] = useState("");
  const [seats, setSeats] = useState<{ civ: string; ready: boolean }[]>([]);

  const resetConnection = useCallback((clearIntent: boolean) => {
    intentionalDisconnect.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    connection.current?.disconnect();
    connection.current = null;
    if (clearIntent) {
      desired.current = undefined;
      setRoomId("");
      setCivilization(undefined);
      setIsHost(false);
      setStarted(false);
      setWorldStatus("");
      setSeats([]);
      revisionRef.current = 0;
      setRevision(0);
    }
  }, []);

  const disconnect = useCallback(() => {
    resetConnection(true);
    setPhase("offline");
    setStatus("Offline practice");
  }, [resetConnection]);

  const scheduleReconnect = useCallback(() => {
    const intent = desired.current;
    if (!intent || retry.current >= 5) {
      setPhase("disconnected");
      setStatus("Disconnected · reconnect from setup");
      return;
    }
    const delay = Math.min(8000, 500 * 2 ** retry.current++);
    setPhase("reconnecting");
    setStatus("Reconnecting…");
    retryTimer.current = setTimeout(
      () => void openRef.current?.(intent, true),
      delay,
    );
  }, []);

  openRef.current = async (intent, reconnect) => {
    resetConnection(false);
    intentionalDisconnect.current = false;
    setError("");
    setPhase(reconnect ? "reconnecting" : "connecting");
    setStatus(reconnect ? "Reconnecting…" : "Connecting…");
    const { uri, database } = multiplayerConfig();
    const tokenKey = identityTokenKey(uri, database);
    const token = multiplayerIdentityToken(localStorage, uri, database);

    try {
      await new Promise<void>((resolve, reject) => {
        let established = false;
        const conn = DbConnection.builder()
          .withUri(uri)
          .withDatabaseName(database)
          .withToken(token)
          .onConnect((connected, identity, nextToken) => {
            localStorage.setItem(tokenKey, nextToken);
            const sync = () => {
              const world = connected.db.world.id.find(intent.id);
              const members = [...connected.db.seat.iter()].filter(
                (seat) => seat.worldId === intent.id,
              );
              const own = members.find((seat) =>
                seat.identity.isEqual(identity),
              );
              setSeats(
                members.map((seat) => ({
                  civ: seat.civ,
                  ready: seat.ready,
                })),
              );
              if (!world || !own) return;
              const nextRevision = world.revision;
              revisionRef.current = nextRevision;
              setRevision(nextRevision);
              setCivilization(own.civ as CivId);
              setIsHost(world.host.isEqual(identity));
              setStarted(world.started);
              setWorldStatus(world.status);
              setRoomId(intent.id);
              setPhase("live");
              setStatus("Live · SpacetimeDB");
              callback.current(
                hydrate(JSON.parse(world.snapshotJson) as PublicGameState),
              );
            };
            connected.db.world.onInsert(sync);
            connected.db.world.onUpdate(sync);
            connected.db.world.onDelete(sync);
            connected.db.seat.onInsert(sync);
            connected.db.seat.onUpdate(sync);
            connected.db.seat.onDelete(sync);
            connected
              .subscriptionBuilder()
              .onApplied(async () => {
                try {
                  const own = [...connected.db.seat.iter()].some((seat) =>
                    seat.identity.isEqual(identity),
                  );
                  if (intent.seed !== undefined && !reconnect)
                    await connected.reducers.worldCreate({
                      worldId: intent.id,
                      civ: intent.civ,
                      seed: intent.seed >>> 0,
                      solo: intent.solo,
                    });
                  else if (!own)
                    await connected.reducers.worldJoin({
                      worldId: intent.id,
                      civ: intent.civ,
                    });
                  established = true;
                  sync();
                  resolve();
                } catch (cause) {
                  reject(cause);
                }
              })
              .onError((ctx) => reject(ctx.event))
              .subscribe([
                `SELECT * FROM world WHERE id = '${intent.id}'`,
                `SELECT * FROM seat WHERE world_id = '${intent.id}'`,
              ]);
          })
          .onConnectError((_ctx, cause) => reject(cause))
          .onDisconnect(() => {
            if (!intentionalDisconnect.current && established)
              scheduleReconnect();
          })
          .build();
        connection.current = conn;
      });
      desired.current = { ...intent, seed: undefined };
      retry.current = 0;
    } catch (cause) {
      connection.current?.disconnect();
      connection.current = null;
      const message = String(cause);
      setError(`Unable to open world: ${message}`);
      if (reconnect) scheduleReconnect();
      else {
        setPhase("disconnected");
        setStatus("Disconnected · reconnect from setup");
      }
    }
  };

  useEffect(
    () => () => {
      intentionalDisconnect.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      connection.current?.disconnect();
    },
    [],
  );

  const connect = useCallback(
    async (id: string, civ: CivId, seed?: number, solo = false) => {
      const normalized = id.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(normalized)) {
        setError("Use a six-character room code.");
        return;
      }
      const intent = { id: normalized, civ, seed, solo };
      desired.current = intent;
      retry.current = 0;
      await openRef.current?.(intent, false);
    },
    [],
  );

  const send = useCallback(
    async (action: () => Promise<unknown>) => {
      if (phase !== "live" || !connection.current) {
        setError("The multiplayer connection is not ready.");
        return false;
      }
      try {
        await action();
        setError("");
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      }
    },
    [phase],
  );

  const expectedRevision = () => revisionRef.current;
  const act = (action: Action) => {
    const conn = connection.current!;
    const base = { worldId: roomId, expectedRevision: expectedRevision() };
    switch (action.type) {
      case "acknowledge":
        return send(() => conn.reducers.acknowledge(base));
      case "choose":
        return send(() =>
          conn.reducers.choose({ ...base, option: action.option }),
        );
      case "build":
        return send(() =>
          conn.reducers.build({ ...base, building: action.building }),
        );
      case "exchange":
        return send(() =>
          conn.reducers.exchange({
            ...base,
            give: action.give,
            get: action.get,
          }),
        );
      case "research":
        return send(() =>
          conn.reducers.research({
            ...base,
            technology: action.technology,
          }),
        );
      case "contain":
        return send(() =>
          conn.reducers.contain({ ...base, hazard: action.hazard }),
        );
      case "ready":
        return send(() => conn.reducers.turnReady(base));
    }
  };

  const start = () =>
    send(() =>
      connection.current!.reducers.worldStart({
        worldId: roomId,
        expectedRevision: expectedRevision(),
      }),
    );
  const ready = () =>
    send(() =>
      connection.current!.reducers.turnReady({
        worldId: roomId,
        expectedRevision: expectedRevision(),
      }),
    );
  const advance = () =>
    send(() =>
      connection.current!.reducers.phaseAdvance({
        worldId: roomId,
        expectedRevision: expectedRevision(),
      }),
    );
  const begin = (questionId: string) =>
    send(() =>
      connection.current!.reducers.quizStart({
        worldId: roomId,
        expectedRevision: expectedRevision(),
        questionId,
      }),
    );
  const answer = (questionId: string, option: number, _lifeline?: boolean) =>
    send(() =>
      connection.current!.reducers.quizSubmit({
        worldId: roomId,
        expectedRevision: expectedRevision(),
        questionId,
        option,
      }),
    );

  return {
    roomId,
    status,
    phase,
    error,
    revision,
    civilization,
    isHost,
    started,
    worldStatus,
    seats,
    connect,
    disconnect,
    start,
    act,
    ready,
    advance,
    begin,
    answer,
  };
}
