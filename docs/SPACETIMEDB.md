# SpacetimeDB setup

## Architecture

Rising Waters uses a native TypeScript module running inside SpacetimeDB's V8 runtime. The browser subscribes through the official TypeScript SDK. The database stores rooms, claimed civilization seats, state revisions, and private quiz clocks. Reducers perform actions and turn transitions atomically; the browser never submits a replacement game state. No Flask, Python bridge, REST relay, or API key is needed.

The SDK and module dependency are pinned through lockfiles at 2.10.2. Generated bindings are checked in. Regenerate after changing reducer parameters or tables. Shared game state contains only JSON values, so cloning works both in browsers and the native runtime.

## Local setup

The root `npm run db:start`, `db:publish`, and `db:generate` scripts use a cross-platform Node launcher. It uses a portable CLI under `.tools/spacetime/` when present, otherwise a globally installed `spacetime` command, and refuses versions other than 2.10.2. Database files and local CLI identity remain in ignored `.tools/` folders. **Keep this folder to retain local worlds and publisher ownership.**

From the repository root on macOS or Windows:

```sh
npm ci --prefix spacetime
npm ci --prefix apps/web
npm run db:start
# In another terminal:
npm run db:publish
npm run db:generate
npm run dev
```

The launcher consistently uses `.tools/data`, `.tools/config`, `--delete-data=never`, and a server-local publisher identity, so local development does not depend on cloud-account authentication. On first use it installs/selects CLI 2.10.2 under the ignored project configuration; subsequent publishes reuse the same identity. Set `SPACETIME_DATABASE=another-name` when running `db:publish` if you need a different local database name, and point the frontend variable at the same name. Manual Maincloud commands continue to use your normal global `spacetime login`.

## Publish to Maincloud

1. Install the official 2.10.2 CLI, then run `spacetime login` yourself and finish its browser authentication. This login is only for publishing; browser players receive separate SDK identities automatically.
2. Pick an available database name that you own. Publish from the repository root:

```sh
spacetime publish YOUR-DATABASE-NAME --module-path spacetime --server maincloud --delete-data=never --no-config
```

3. Copy `apps/web/.env.example` to `apps/web/.env.local`, and set:

```dotenv
NEXT_PUBLIC_SPACETIME_URI=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_SPACETIME_DATABASE=YOUR-DATABASE-NAME
```

4. Restart the dev server, or rebuild the hosted frontend with these same public variables. Create a multiplayer room and join from another browser profile or device. Both players should see the same room revision.

Use `--no-config` with an explicit server when publishing to cloud because the committed `spacetime.json` intentionally points at local development. If your provider gives a different WebSocket endpoint, use that endpoint. Account quotas, database-name availability, and cloud permissions are verified during your publish.

## Identities and reconnecting

Browser identity tokens are scoped to the configured server and database and saved in local storage. They prove seat ownership to reducers. Clearing browser storage loses that identity; export a practice save if you want an editable offline copy. Online worlds remain in SpacetimeDB and reconnect requires the original identity. A room code permits joining an open seat but does not grant control of already claimed civilizations.

Online room tables are currently public. Room codes are convenience lobby codes, not confidentiality boundaries. There are no emails, chat, payment information, or real-world personal profiles in the schema. Private forecasts and full anti-cheat isolation need per-player views before a competitive public release.

## Current limits

Joining is available only during the first planning phase; locking all current seats starts the game with bots in unclaimed seats. The host advances shared phases. Host migration, disconnected-player timeouts, cleanup/expiry of rooms, and trade offers requiring acceptance are pending. Keep all human participants connected during a demo. Quiz clocks are measured by the database; replayed answers and actions by another civilization are rejected.

## References

[TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/) · [Publishing modules](https://spacetimedb.com/docs/databases/building-publishing/) · [CLI reference](https://spacetimedb.com/docs/cli-reference/) · [Project configuration](https://spacetimedb.com/docs/cli-reference/spacetime-json/)
