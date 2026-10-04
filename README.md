# Rising Waters

A playable environmental strategy tycoon built entirely in TypeScript: Next.js/React in the browser, and a native SpacetimeDB 2.10.2 module as the backend. There is no Flask or Python game server.

Four towns share one river valley. Every decade each town is hit by an event (a flood, drought, smog, a spill), and its advisor tells the player what is coming. The player answers a timed question about it, then chooses between a cheap fix that pushes the damage onto a neighbor or warms the planet, and a sustainable fix that costs more but protects the town for good. Then they build with sheep, wheat, wood, brick and ore, and watch the town grow on the map. After ten decades the biggest town wins, unless warming reaches +3°C first, in which case everyone loses.

Modes: offline solo with AI neighbors, four-player hot-seat, and live SpacetimeDB rooms with AI filling unclaimed towns. The map is drawn live from `src/data/worldmap.json`; see `AGENTS.md` §0 for the full design.

The simulation now includes routine pressures, rare major disasters, persistent regional recovery, bounded building destruction, food and maintenance upkeep, limited project actions and independent clean-energy research. See [the simulation rules](docs/SIMULATION.md) for balancing data, causal propagation and the UI handoff API.

The whole sea and island now share one animated pixel canvas. Tsunamis arrive from a seeded west, east or south direction, flood low coastal ground, and teach evacuation to high ground through eight simple questions. Earthquakes can trigger tsunami cascades; warning systems and evacuation reduce later losses. Resource icons use the supplied `assets/resources_sheet.webp`. Human and AI bank trades dispatch short cargo-boat trips along connected water near each town's berth. Ocean colors, timing and port anchors live in `src/data/ocean.json`.

## Run locally (macOS and Windows)

Install Node.js 24 and [SpacetimeDB 2.10.2](https://spacetimedb.com/install). This workspace also has an ignored portable CLI under `.tools/spacetime/`.

```sh
npm ci --prefix apps/web
npm ci --prefix spacetime
npm run db:start
```

Keep that terminal open. In a second terminal at the repository root:

```sh
npm run db:publish
npm run db:generate
npm run dev
```

Open http://127.0.0.1:3000. The frontend defaults to `ws://127.0.0.1:3001` and local database `rising-waters-local`. Select **Create saved solo world**, or select **4-player hot-seat** then **Create multiplayer world**. Friends select an unclaimed civilization and join with the six-character room code. The practice button plays locally without the database.

The root database scripts use the same Node launcher on macOS and Windows, keep local data and publisher identity under ignored `.tools/`, and require CLI version 2.10.2. Use `spacetime login` only when publishing to Maincloud; never put publisher credentials in browser environment variables.

The host advances the opening event narration. Each player answers their own server-timed quiz, hears the neighbor response, chooses, builds and ends their turn; shared phases wait for every claimed seat while unclaimed towns use AI. To reconnect, use the same browser and room code: the SDK identity is retained locally. A different browser profile is a different player. For multiple computers, use a reachable backend URL as described below.

## Core decade loop

1. **Event:** each town draws one of 16 hazards. Geography sets the base weight; warming amplifies the checked climate hazards; dirty buildings upstream or upwind can identify a source. Earthquakes and floods can deterministically trigger rare tsunami or dam-break cascades.
2. **Advisor quiz:** the town's advisor asks one sourced 20-second question. A correct answer reduces every listed resource loss by one.
3. **Neighbor response:** the affected neighbor explains how the carrier—river, wind, coast, fault or shared network—connects the towns. Live and hot-seat games wait until every human has heard this response.
4. **Management choice:** a cheap response prevents local loss but moves damage to a neighbor or increases warming; a sustainable response costs more, halves current loss and earns a permanent mitigation; bracing takes the full loss.
5. **Resolution and build:** all choices resolve together, reports name sources and victims, then towns build or exchange resources at 3:1.
6. **Next decade:** production is collected, building emissions change warming, new events roll, and the game ends after ten decades or immediately at +3°C.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:integration  # local SpacetimeDB must be running and published
```

The integration check opens two independent identities and tests synchronized rooms, ownership, stale revisions, readiness, and host-only advancement. It creates a fresh test room each run. `npm --prefix apps/web run simulate` exercises 400 seeded worlds; it is a stability check, not proof of competitive balance.

## Connect your SpacetimeDB account

See [the complete setup guide](docs/SPACETIMEDB.md). The frontend needs only a WebSocket URL and a database name; do not put publisher credentials into browser environment variables. Cloud publishing requires your own CLI login and an available database name. No cloud resources have been deployed by this foundation.

## Source layout

- `apps/web/src/game/`: shared deterministic rules, types, question access, and live SDK hook.
- `spacetime/src/index.ts`: native module tables and reducers; imports the same tested rules.
- `apps/web/src/module_bindings/`: generated official SDK bindings.
- `src/data/`: authored balance, buildings, technologies, hazards, geography, and quizzes.
- `apps/web/src/components/`: world, economy, technology, diplomacy, learning, timeline, and results.
- `assets/`: original world and reference art; runtime art is copied to `apps/web/public/assets/`.

[Architecture and simulation assumptions](docs/ARCHITECTURE.md) · [Remaining production work](docs/ROADMAP.md)
