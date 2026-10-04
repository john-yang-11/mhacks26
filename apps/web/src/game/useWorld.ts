"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DbConnection } from "@/module_bindings";
import { identityTokenKey, migrateIdentityToken } from "./identityToken";
import type { Action, CivId, GameState } from "./types";

/** The subscription is the sole source of state for an online world. */
export function useWorld(onState: (state: GameState) => void) {
  const connection = useRef<DbConnection | null>(null);
  const callback = useRef(onState);
  callback.current = onState;
  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState("Offline practice");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [civilization, setCivilization] = useState<CivId>();
  const [isHost, setIsHost] = useState(false);
  const [seats, setSeats] = useState<{ civ: string; ready: boolean }[]>([]);
  const disconnect = useCallback(() => {
    connection.current?.disconnect();
    connection.current = null;
    setRoomId("");
    setStatus("Offline practice");
    setCivilization(undefined);
  }, []);
  useEffect(() => () => connection.current?.disconnect(), []);

  async function connect(id: string, civ: CivId, seed?: number, solo = false) {
    id = id.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(id)) {
      setError("Use a six-character room code.");
      return;
    }
    disconnect();
    setError("");
    setStatus("Connecting…");
    const uri = process.env.NEXT_PUBLIC_SPACETIME_URI || "ws://127.0.0.1:3001";
    const db =
      process.env.NEXT_PUBLIC_SPACETIME_DATABASE || "rising-waters-local";
    const tokenKey = identityTokenKey(uri, db);
    try {
      const token = migrateIdentityToken(localStorage, uri, db);
      await new Promise<void>((resolve, reject) => {
        const conn = DbConnection.builder()
          .withUri(uri)
          .withDatabaseName(db)
          .withToken(token)
          .onConnect((conn, identity, token) => {
            localStorage.setItem(tokenKey, token);
            const sync = () => {
              const row = conn.db.room.id.find(id);
              const members = [...conn.db.seat.iter()].filter(
                (s) => s.roomId === id,
              );
              const own = members.find((s) => s.identity.isEqual(identity));
              setSeats(members.map((s) => ({ civ: s.civ, ready: s.ready })));
              if (!row || !own) return;
              setCivilization(own.civ as CivId);
              setIsHost(row.host.isEqual(identity));
              setRevision(row.revision);
              setRoomId(id);
              setStatus("Live · SpacetimeDB");
              callback.current(JSON.parse(row.stateJson) as GameState);
            };
            conn.db.room.onInsert(sync);
            conn.db.room.onUpdate(sync);
            conn.db.seat.onInsert(sync);
            conn.db.seat.onUpdate(sync);
            conn
              .subscriptionBuilder()
              .onApplied(async () => {
                try {
                  const own = [...conn.db.seat.iter()].some((s) =>
                    s.identity.isEqual(identity),
                  );
                  if (seed !== undefined)
                    await conn.reducers.createWorld({
                      roomId: id,
                      civ,
                      seed: seed >>> 0,
                      solo,
                    });
                  else if (!own)
                    await conn.reducers.joinWorld({ roomId: id, civ });
                  sync();
                  resolve();
                } catch (e) {
                  reject(e);
                }
              })
              .onError((ctx) => reject(ctx.event))
              .subscribe([
                `SELECT * FROM room WHERE id = '${id}'`,
                `SELECT * FROM seat WHERE room_id = '${id}'`,
              ]);
          })
          .onConnectError((_ctx, e) => reject(e))
          .onDisconnect(() => setStatus("Disconnected · reconnect from setup"))
          .build();
        connection.current = conn;
      });
    } catch (e) {
      disconnect();
      setError(`Unable to open world: ${String(e)}`);
    }
  }
  async function send(action: () => Promise<unknown>) {
    try {
      await action();
      setError("");
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }
  const act = (action: Action) =>
    send(() =>
      connection.current!.reducers.act({
        roomId,
        revision,
        actionJson: JSON.stringify(action),
      }),
    );
  const ready = () =>
    send(() => connection.current!.reducers.ready({ roomId }));
  const advance = () =>
    send(() => connection.current!.reducers.advance({ roomId }));
  /** Host leaves the waiting room: the shared flag lets every player in. */
  const start = () =>
    send(() => connection.current!.reducers.startWorld({ roomId }));
  const begin = (questionId: string) =>
    send(() =>
      connection.current!.reducers.beginQuestion({ roomId, questionId }),
    );
  const answer = (questionId: string, option: number, lifeline: boolean) =>
    send(() =>
      connection.current!.reducers.answer({
        roomId,
        questionId,
        option,
        lifeline,
      }),
    );
  return {
    roomId,
    status,
    error,
    revision,
    civilization,
    isHost,
    seats,
    connect,
    disconnect,
    act,
    ready,
    advance,
    start,
    begin,
    answer,
  };
}
