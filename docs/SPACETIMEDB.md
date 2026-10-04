# SpacetimeDB multiplayer

Rising Waters v2 uses a Vercel-hosted Next.js frontend and a native TypeScript module on SpacetimeDB. Browsers connect directly to SpacetimeDB over WebSockets; Vercel does not proxy multiplayer traffic.

## Architecture

- `packages/game-core` contains the pure serializable game rules shared by the browser and module.
- `spacetime/src/schema.ts` defines public `world` and `seat` tables plus private canonical world state and quiz timers.
- Typed reducers in `spacetime/src/reducers.ts` authenticate the sender, require the current revision, apply the shared engine, and publish a sanitized snapshot.
- Random state and the original seed never appear in public subscriptions.
- `apps/web/src/multiplayer` owns production configuration, identity, connection lifecycle, subscriptions, reconnects, and typed reducer calls.

SpacetimeDB CLI and SDK versions are pinned to 2.10.2. Generated bindings are committed under `apps/web/src/module_bindings`.

## Local development

From the repository root:

```sh
npm ci --prefix spacetime
npm ci --prefix apps/web
npm run db:start
```

In a second terminal:

```sh
npm run db:publish
npm run db:generate
npm run test:integration
npm run dev
```

The local defaults are:

```dotenv
NEXT_PUBLIC_SPACETIME_URI=ws://127.0.0.1:3001
NEXT_PUBLIC_SPACETIME_DATABASE=rising-waters-v2-local
```

Use separate browser profiles for separate players. Tabs in one profile share a SpacetimeDB identity by design.

## Production: Maincloud and Vercel

Choose a new available Maincloud database name. `rising-waters-v2` is used below as an example.

```sh
spacetime login
spacetime publish rising-waters-v2 --module-path spacetime --server maincloud --delete-data=never --no-config
```

Verify the exact published database before deploying the frontend:

```sh
NEXT_PUBLIC_SPACETIME_URI=wss://maincloud.spacetimedb.com \
NEXT_PUBLIC_SPACETIME_DATABASE=rising-waters-v2 \
npm run test:integration
```

Configure the Vercel project with root directory `apps/web` and set these variables for both Production and Preview:

```dotenv
NEXT_PUBLIC_SPACETIME_URI=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_SPACETIME_DATABASE=rising-waters-v2
```

Redeploy after changing either public variable because Next.js embeds them during the build. Vercel builds fail if the values are absent or point to localhost.

## Production release gate

The release is complete only after all of the following pass:

1. Unit tests, typecheck, formatting, production build, and generated bindings checks.
2. The automated integration suite against the Maincloud database.
3. Computer A creates a room from the public Vercel URL.
4. Computer B, on a separate network or browser profile, joins that room.
5. Both computers see the same lobby and enter play when the host starts.
6. Both complete event, quiz, response, choice, build, and reach the next round.
7. One computer disconnects and reconnects to its original seat.
8. Browser network tools on both computers show a WebSocket to `wss://maincloud.spacetimedb.com` and the same database name, never `127.0.0.1`.

## Updating the module

After changing schema or reducer parameters:

```sh
npm run db:generate
npm run typecheck
npm test
```

Commit generated bindings with the module change. Publish the module before deploying client code that calls the new reducers. For another clean reset, publish under a new database name and update Vercel instead of deleting the old database.

## Identity and reconnects

Identity tokens are scoped to the configured URI and database and stored in browser local storage. Reconnecting from the same browser profile restores the claimed seat. Clearing site data loses that identity. A room code permits joining an open seat but does not grant control of a claimed civilization.
