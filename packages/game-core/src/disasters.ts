/** Geography and multi-round recovery. No browser imports; shared by SpacetimeDB. */
import {
  BUILDINGS,
  CIVS,
  ECONOMY,
  EVENTS,
  GEOGRAPHY,
  RESEARCH,
  RISK,
  stock,
} from "./content";
import {
  CIV_IDS,
  RESOURCES,
  type Civ,
  type CivId,
  type CycleEvent,
  type EventId,
  type GameState,
  type RegionalHazard,
  type Stock,
} from "./types";

export const profile = (id: EventId) => RISK.profiles[id];
export const destructionProfile = (id: EventId) =>
  (
    RISK.destruction as Partial<
      Record<
        EventId,
        {
          cap: number;
          perRound: number;
          scarRounds: number;
          productionMultiplier: number;
        }
      >
    >
  )[id] ?? {
    cap: RISK.maxDestroyed,
    perRound: 1,
    scarRounds: 0,
    productionMultiplier: 1,
  };
export const technologies = (c: Civ) => c.technologies ?? [];
export const recoveryNeeds = (c: Civ) => [
  ...(c.hazards ?? []),
  ...(c.damageScars ?? [])
    .filter((s) => !c.hazards?.some((h) => h.type === s.type))
    .map((s) => ({ ...s, containment: 0, origin: c.id, destroyed: 0 })),
];
export const researchProtection = (c: Civ, id: EventId) =>
  technologies(c).some((t) => RESEARCH[t]?.protects.includes(id));
export const productionPenalty = (c: Civ, r: keyof Stock) =>
  Math.min(
    RISK.maxProductionPenalty,
    [
      ...(c.hazards ?? []),
      ...(c.damageScars ?? [])
        .filter((s) => !c.hazards?.some((h) => h.type === s.type))
        .map((s) => ({ ...s, containment: 0 })),
    ].reduce(
      (n, h) =>
        n +
        (profile(h.type).production.includes(r as never)
          ? h.severity *
            RISK.productionPenalty *
            destructionProfile(h.type).productionMultiplier *
            (1 - h.containment / 2) *
            (researchProtection(c, h.type) ||
            c.buildings.some((b) => BUILDINGS[b]?.protects?.includes(h.type))
              ? RISK.protectedProductionMultiplier
              : 1)
          : 0),
      0,
    ),
  );
export const COASTAL = GEOGRAPHY.coastal;
const RIVER = GEOGRAPHY.downstream;
const LAND_NEIGHBOR = GEOGRAPHY.stormTrack;
/** Communities still rely on oil transport/storage until clean energy is established. */
export const hasRenewableEnergy = (c: Civ) =>
  technologies(c).includes("solar_power") ||
  c.buildings.some((b) => ["windmill", "solar", "microgrid"].includes(b));
export function eligibleOilSources(s: GameState, c: CivId) {
  return CIV_IDS.filter(
    (u) =>
      (u === c || RIVER[u].includes(c)) &&
      (s.civs[u].buildings.includes("refinery") ||
        !hasRenewableEnergy(s.civs[u])),
  ).sort(
    (a, b) =>
      Number(s.civs[b].buildings.includes("refinery")) -
        Number(s.civs[a].buildings.includes("refinery")) ||
      Number(b === c) - Number(a === c),
  );
}

type Dice = () => number;

function weighted(
  items: { id: EventId; weight: number }[],
  dice: Dice,
): EventId {
  let n = dice() * items.reduce((sum, i) => sum + i.weight, 0);
  return (items.find((i) => (n -= i.weight) < 0) ?? items[0]).id;
}
function event(
  type: EventId,
  severity: number,
  origin: CivId,
  started: number,
  ongoing = false,
  reason?: string,
): CycleEvent {
  const loss: Partial<Stock> = {};
  for (const r of RESOURCES)
    if (EVENTS[type].loss[r])
      loss[r] = Math.max(
        1,
        Math.ceil(
          ((EVENTS[type].loss[r]! * severity) / RISK.majorSeverity) *
            (ongoing ? RISK.ongoingLossMultiplier : 1),
        ),
      );
  return { type, severity, origin, started, ongoing, reason, loss };
}
/** One small pressure per town per round; major incidents have a separate chance and cooldown. */
export function drawRegionalEvents(s: GameState, dice: Dice) {
  s.scheduled ??= [];
  s.minorEvents = {};
  s.scheduled = s.scheduled.filter(
    (h) => !RISK.disabledEvents.includes(h.type),
  );
  const due = s.scheduled.filter((h) => h.arrives <= s.round);
  s.scheduled = s.scheduled.filter((h) => h.arrives > s.round);
  for (const c of CIV_IDS) {
    const town = s.civs[c];
    const recent = town.recent ?? [];
    const previous = recent.at(-1);
    town.hazards = (town.hazards ?? []).filter(
      (h) => !RISK.disabledEvents.includes(h.type),
    );
    const weight = (id: EventId) => {
      if (RISK.disabledEvents.includes(id)) return 0;
      const e = EVENTS[id];
      let w =
        id === "spill"
          ? eligibleOilSources(s, c).length
            ? Math.max(e.regions[c] ?? 0, RISK.fossilOilWeight)
            : 0
          : (e.regions[c] ?? 0) ** 0.6;
      if (recent.includes(id)) w *= 0.35;
      if (e.climateDriven) w *= 1 + s.climate / RISK.climateSeverityThreshold;
      if (e.cause)
        w *=
          1 +
          CIV_IDS.filter(
            (u) =>
              u === c ||
              (e.carrier === "wind"
                ? GEOGRAPHY.downwind[u] === c
                : RIVER[u].includes(c)),
          ).reduce(
            (n, u) =>
              n +
              s.civs[u].buildings.filter((b) => b === e.cause).length *
                RISK.causeWeight,
            0,
          );
      return w;
    };
    const allSmall = (Object.keys(EVENTS) as EventId[]).filter(
      (id) => !profile(id).major && weight(id) > 0,
    );
    // Fresh minor pressures make each decade feel different. Active major incidents may repeat
    // while recovery continues because their consequences deliberately last several rounds.
    const freshSmall = allSmall.filter((id) => id !== previous);
    const small = freshSmall.length ? freshSmall : allSmall;
    const minor = event(
      weighted(
        small.map((id) => ({ id, weight: weight(id) })),
        dice,
      ),
      RISK.minorSeverity,
      c,
      s.round,
    );
    s.minorEvents[c] = minor;
    town.recent = [...recent, minor.type].slice(-3);
    const incoming = due
      .filter((h) => h.target === c)
      .sort((a, b) => b.severity - a.severity);
    // Every arrival remains an active hazard, even if another stronger event gets the dialogue.
    for (const h of incoming) {
      const prior = town.hazards?.find((x) => x.type === h.type);
      if (!prior)
        (town.hazards ??= []).push({
          type: h.type,
          severity: h.severity,
          remaining: profile(h.type).duration,
          containment: 0,
          started: s.round,
          origin: h.origin,
          destroyed: 0,
        });
      else {
        prior.severity = Math.max(prior.severity, h.severity);
        prior.remaining = Math.max(prior.remaining, profile(h.type).duration);
        prior.origin = h.origin;
      }
      scheduleConsequences(
        s,
        c,
        event(h.type, h.severity, h.origin, s.round, false, h.reason),
        dice,
      );
    }
    const active = (town.hazards ?? [])
      .filter((h) => profile(h.type).major)
      .sort((a, b) => b.severity - a.severity)[0];
    let primary = active
      ? event(
          active.type,
          active.severity,
          active.origin,
          active.started,
          active.started < s.round,
          "Recovery continues from an earlier incident.",
        )
      : minor;
    if (incoming.length) {
      const h = incoming[0];
      primary = event(h.type, h.severity, h.origin, s.round, false, h.reason);
      if (profile(h.type).major) town.lastMajor = s.round;
    } else if (
      !active &&
      s.round - (town.lastMajor ?? -RISK.majorCooldown) >= RISK.majorCooldown &&
      dice() < RISK.majorChance
    ) {
      const majors = (Object.keys(EVENTS) as EventId[]).filter(
        (id) =>
          profile(id).major &&
          !["tsunami", "mega_tsunami"].includes(id) &&
          weight(id) > 0 &&
          (id !== "spill" || eligibleOilSources(s, c).length > 0),
      );
      if (majors.length) {
        const id = weighted(
          majors.map((id) => ({ id, weight: weight(id) })),
          dice,
        );
        const origin = id === "spill" ? eligibleOilSources(s, c)[0] : c;
        primary = event(id, RISK.majorSeverity, origin, s.round);
        if (id === "spill") primary.cause = origin;
        town.lastMajor = s.round;
        scheduleConsequences(s, c, primary, dice);
      }
    }
    if (
      EVENTS[primary.type].climateDriven &&
      s.climate >= RISK.climateSeverityThreshold
    ) {
      const top = RESOURCES.reduce((a, r) =>
        (primary.loss[r] ?? 0) > (primary.loss[a] ?? 0) ? r : a,
      );
      primary.loss[top] = (primary.loss[top] ?? 0) + 1;
    }
    s.events[c] = primary;
    if (EVENTS[primary.type].cause && !primary.cause)
      primary.cause = CIV_IDS.find(
        (u) =>
          (u === c ||
            (EVENTS[primary.type].carrier === "wind"
              ? GEOGRAPHY.downwind[u] === c
              : RIVER[u].includes(c))) &&
          s.civs[u].buildings.includes(EVENTS[primary.type].cause!),
      );
  }
}

export function canTriggerMegaTsunami(s: GameState) {
  return (
    s.climate >= RISK.megaTsunamiClimateThreshold &&
    !s.scheduled?.some((h) => h.type === "mega_tsunami") &&
    !CIV_IDS.some(
      (c) =>
        s.civs[c].hazards?.some((h) => h.type === "mega_tsunami") ||
        s.civs[c].damageScars?.some((h) => h.type === "mega_tsunami"),
    )
  );
}

function scheduleConsequences(
  s: GameState,
  c: CivId,
  ev: CycleEvent,
  dice: Dice,
) {
  const queue = (
    type: EventId,
    target: CivId,
    severity: number,
    reason: string,
  ) => {
    if (
      !s.scheduled!.some(
        (h) =>
          h.type === type && h.target === target && h.arrives === s.round + 1,
      )
    )
      s.scheduled!.push({
        type,
        target,
        origin: ev.origin ?? c,
        arrives: s.round + 1,
        severity,
        reason,
      });
  };
  if (ev.type === "earthquake") {
    if (COASTAL.includes(c) && dice() < RISK.earthquakeWaveChance) {
      const major = canTriggerMegaTsunami(s) && dice() < RISK.majorWaveChance;
      queue(
        major ? "mega_tsunami" : "tsunami",
        "archipelago",
        major ? RISK.maxSeverity : RISK.majorSeverity,
        "An offshore earthquake displaced the seabed last round; the wave train now reaches the low coast.",
      );
    }
    if (dice() < RISK.aftershockChance)
      queue(
        "small_quake",
        c,
        1,
        "An aftershock follows last round's earthquake, not the tsunami.",
      );
  }
  if (ev.type === "hurricane" && dice() < RISK.hurricaneFloodChance)
    queue(
      "flood",
      LAND_NEIGHBOR[c],
      1,
      "Last round's coastal hurricane moved inland; heavy rain now floods connected lowlands.",
    );
  if (ev.type === "dam_failure")
    for (const target of RIVER[c])
      queue(
        "flood",
        target,
        2,
        "A dam break upstream sends a delayed flood pulse down the river.",
      );
  if (ev.type === "flood" && ev.reason && ev.origin !== c)
    for (const target of RIVER[c])
      queue(
        "flood",
        target,
        1,
        "The upstream flood pulse continues down the connected river into the delta.",
      );
  if (ev.type === "spill" && dice() < RISK.spillSpreadChance)
    for (const target of RIVER[c])
      queue(
        "spill",
        target,
        1,
        "Oil released upstream last round has reached this connected riverbank.",
      );
}

export function ensureHazard(
  s: GameState,
  c: CivId,
  ev: CycleEvent,
): RegionalHazard {
  const town = s.civs[c];
  const hazards = (town.hazards ??= []);
  let h = hazards.find((x) => x.type === ev.type);
  if (!h) {
    h = {
      type: ev.type,
      severity:
        ev.severity ??
        (profile(ev.type).major ? RISK.majorSeverity : RISK.minorSeverity),
      remaining: profile(ev.type).duration,
      containment: 0,
      started: s.round,
      origin: ev.origin ?? c,
      destroyed: 0,
    };
    const compound =
      (["tornado", "hurricane"].includes(ev.type) &&
        hazards.some((x) => x.type === "wildfire")) ||
      (ev.type === "wildfire" &&
        hazards.some((x) => ["tornado", "hurricane"].includes(x.type)));
    if (compound)
      h.severity = Math.min(
        RISK.maxSeverity,
        h.severity * RISK.fireStormMultiplier,
      );
    hazards.push(h);
  }
  // Delayed arrivals already have a hazard: they still need lasting damage.
  const destruction = destructionProfile(ev.type);
  if (destruction.scarRounds) {
    for (const affected of ev.type === "mega_tsunami" ? CIV_IDS : [c]) {
      const scars = (s.civs[affected].damageScars ??= []);
      if (!scars.some((x) => x.type === ev.type && x.started === h.started))
        scars.push({
          type: ev.type,
          started: h.started,
          remaining: Math.max(
            0,
            destruction.scarRounds - (s.round - h.started),
          ),
          severity: h.severity,
        });
    }
  }
  return h;
}

/** Loss mitigation rounds up and the quiz saves one unit total, never every category. */
export function eventLoss(
  s: GameState,
  c: CivId,
  ev: CycleEvent,
  option: 0 | 1 | 2,
  quiz = true,
): Partial<Stock> {
  const town = s.civs[c];
  const defended =
    town.buildings.some((b) => BUILDINGS[b]?.protects?.includes(ev.type)) ||
    researchProtection(town, ev.type);
  const compound =
    (["tornado", "hurricane"].includes(ev.type) &&
      town.hazards?.some((h) => h.type === "wildfire")) ||
    (ev.type === "wildfire" &&
      town.hazards?.some((h) => ["tornado", "hurricane"].includes(h.type)));
  const multiplier =
    (compound ? RISK.fireStormMultiplier : 1) *
    (option === 0
      ? RISK.cheapMultiplier
      : option === 1
        ? RISK.greenMultiplier
        : 1) *
    (defended ? RISK.defenseMultiplier : 1);
  const loss: Partial<Stock> = {};
  for (const r of RESOURCES)
    if (ev.loss[r]) loss[r] = Math.ceil(ev.loss[r]! * multiplier);
  if (quiz && town.quiz?.correct) {
    const top = RESOURCES.reduce((a, r) =>
      (loss[r] ?? 0) > (loss[a] ?? 0) ? r : a,
    );
    // A serious incident always leaves at least one resource loss or recovery burden.
    const total = Object.values(loss).reduce((n, v) => n + (v ?? 0), 0);
    if (total > RISK.quizReduction)
      loss[top] = Math.max(0, (loss[top] ?? 0) - RISK.quizReduction);
  }
  return loss;
}

/** Deterministic destruction is bounded; preserve the last productive building as a recovery foothold. */
export function damageBuildings(
  s: GameState,
  c: CivId,
  h: RegionalHazard,
  option: 0 | 1 | 2,
  dice: Dice,
  allowance: number,
): string[] {
  const town = s.civs[c];
  const p = profile(h.type);
  const burning =
    ["hurricane", "tornado"].includes(h.type) &&
    town.hazards?.some((x) => x.type === "wildfire" && x.remaining > 0);
  const cap =
    destructionProfile(h.type).cap + (burning ? RISK.fireStormExtraCap : 0);
  const vulnerable: readonly string[] = burning
    ? [...p.vulnerable, ...profile("wildfire").vulnerable]
    : p.vulnerable;
  if (h.destroyed >= cap || allowance <= 0) return [];
  const hardened =
    researchProtection(town, h.type) ||
    town.buildings.some((b) => BUILDINGS[b]?.protects?.includes(h.type));
  if (
    dice() >=
    ((RISK.damageChance * h.severity) / RISK.majorSeverity) *
      (burning ? RISK.fireStormMultiplier : 1) *
      (hardened ? RISK.hardenedDamageMultiplier : 1) *
      (option === 1 ? RISK.greenDamageMultiplier : 1)
  )
    return [];
  const destroyed: string[] = [];
  for (
    let hit = 0;
    hit < Math.min(allowance, destructionProfile(h.type).perRound) &&
    h.destroyed < cap;
    hit++
  ) {
    const producers = town.buildings.filter((b) => BUILDINGS[b]?.yields);
    const candidates = town.buildings.flatMap((b, i) =>
      vulnerable.includes(b) &&
      !(producers.length === 1 && producers.includes(b))
        ? [i]
        : [],
    );
    if (!candidates.length) break;
    const index = candidates[Math.floor(dice() * candidates.length)];
    const [id] = town.buildings.splice(index, 1);
    h.destroyed++;
    for (const scar of town.damageScars ?? [])
      if (scar.type === h.type && scar.started === h.started)
        scar.destroyed = h.destroyed;
    destroyed.push(id);
  }
  return destroyed;
}

export function recoveryCost(type: EventId): Partial<Stock> {
  return profile(type).cleanup;
}
export function recover(civ: Civ, type: EventId) {
  for (const scar of civ.damageScars ?? [])
    if (scar.type === type) {
      scar.remaining = Math.max(0, scar.remaining - 2);
      scar.severity = Math.max(0.25, scar.severity - 0.35);
    }
  civ.damageScars = civ.damageScars?.filter((s) => s.remaining > 0);
  const h = civ.hazards?.find((x) => x.type === type);
  if (!h) return;
  h.containment = 1;
  h.severity = Math.max(0, h.severity - RISK.recoverySeverityReduction);
  h.remaining = Math.max(0, h.remaining - RISK.recoveryRoundsReduction);
  civ.hazards = civ.hazards!.filter((x) => x.severity > 0 && x.remaining > 0);
}
export function tickRecovery(s: GameState, c: CivId) {
  const town = s.civs[c];
  town.damageScars = (town.damageScars ?? []).filter(
    (scar) => --scar.remaining > 0,
  );
  for (const h of town.hazards ?? []) {
    const p = profile(h.type);
    h.remaining--;
    h.severity = Math.max(
      RISK.minimumSeverity,
      Math.min(
        RISK.maxSeverity,
        h.severity + (h.containment < 0.5 ? p.growth : -RISK.containedRecovery),
      ),
    );
    h.containment = Math.max(0, h.containment - RISK.containmentDecay);
  }
  town.hazards = (town.hazards ?? []).filter((h) => h.remaining > 0);
  if (town.research && --town.research.remaining <= 0) {
    const id = town.research.id;
    (town.technologies ??= []).push(id);
    town.research = undefined;
    s.news.push({
      round: s.round,
      civ: c,
      text: `${CIVS[c].name} completed ${RESEARCH[id].name}: ${RESEARCH[id].description}`,
    });
  }
}

export function upkeep(c: Civ): Stock {
  const out = stock({
    wheat:
      ECONOMY.foodUpkeep +
      Math.floor(
        c.buildings.filter((b) => b === "house").length /
          ECONOMY.houseFoodEvery,
      ),
  });
  const dirty = c.buildings.filter((b) => BUILDINGS[b]?.dirty).length;
  out.ore = Math.floor(dirty / ECONOMY.industryUpkeepEvery);
  for (const b of c.buildings)
    for (const r of RESOURCES) out[r] += BUILDINGS[b]?.upkeep?.[r] ?? 0;
  if (technologies(c).some((t) => RESEARCH[t]?.maintenanceReduction))
    out.ore = Math.max(0, out.ore - 1);
  return out;
}
/** Guidance names an affordable concrete action rather than silently punishing the player. */
export function recommendations(s: GameState, c: CivId): string[] {
  const town = s.civs[c],
    lines: string[] = [];
  if (town.stock.wheat <= upkeep(town).wheat + 1)
    lines.push(
      "Prioritize food: keep wheat for upkeep. Build a farm or trade a surplus for wheat before expanding housing.",
    );
  if (recoveryNeeds(town).length) {
    const h = recoveryNeeds(town).sort((a, b) => b.severity - a.severity)[0];
    lines.push(
      `${EVENTS[h.type].name}: severity ${h.severity.toFixed(1)}, ${h.remaining} round(s) left. ${h.severity >= 1 ? "Fund recovery to lower severity and shorten disruption." : "Damage is mild; letting recovery finish naturally can save resources for food and research."}`,
    );
  }
  if (!town.research && !technologies(town).includes("solar_power"))
    lines.push(
      "Research solar power to unlock clean production. Research progresses at the end of each round.",
    );
  lines.push(
    `${Math.max(0, ECONOMY.actionsPerRound - (town.actionsUsed ?? 0))} project actions left. Building, research and recovery each use one; trading does not.`,
  );
  return lines;
}
