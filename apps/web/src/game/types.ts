export const CIV_IDS = [
  "heartland",
  "enclave",
  "petrostate",
  "archipelago",
] as const;
export type CivId = (typeof CIV_IDS)[number];
export const RESOURCES = ["sheep", "wheat", "wood", "brick", "ore"] as const;
export type Resource = (typeof RESOURCES)[number];
export type Stock = Record<Resource, number>;

/** Hazard types that quiz questions are tagged with (src/data/quiz.json). */
export type DisasterId =
  | "flood"
  | "dam_failure"
  | "hurricane"
  | "tornado"
  | "earthquake"
  | "tsunami"
  | "volcano"
  | "drought"
  | "heatwave"
  | "wildfire"
  | "spill"
  | "smog"
  | "sea_rise"
  | "landslide"
  | "grid_failure"
  | "pandemic"
  | "supply_shock";
export type AddedDisasterId = "tornado" | "small_quake" | "mega_tsunami";

/** Every hazard in the event matrix is a playable cycle event. */
export type EventId = DisasterId | AddedDisasterId;

/**
 * Each cycle: the event is told → everyone answers a quiz → an affected neighbor responds
 * → everyone makes a choice (cheap vs sustainable) → everyone builds → the cycle ends.
 */
export type Phase =
  "event" | "quiz" | "response" | "choice" | "build" | "ended";

export interface CycleEvent {
  type: EventId;
  /** A neighbor whose buildings made this event more likely (shown in the narration). */
  cause?: CivId;
  /** Losses before the quiz and the choice soften them. */
  loss: Partial<Stock>;
  severity?: number;
  ongoing?: boolean;
  origin?: CivId;
  reason?: string;
  started?: number;
}
export interface RegionalHazard {
  type: EventId;
  severity: number;
  remaining: number;
  containment: number;
  started: number;
  origin: CivId;
  destroyed: number;
}
export interface ScheduledHazard {
  type: EventId;
  target: CivId;
  origin: CivId;
  arrives: number;
  severity: number;
  reason: string;
}
export interface QuizRecord {
  questionId: string;
  option?: number;
  correct?: boolean;
  ms?: number;
}
export interface Civ {
  id: CivId;
  stock: Stock;
  buildings: string[];
  quiz?: QuizRecord;
  /** The player has heard the affected neighbor's response this cycle. */
  responded?: boolean;
  /** 0 = cheap now, 1 = sustainable, 2 = brace and take the full loss. */
  choice?: 0 | 1 | 2;
  ready: boolean;
  /** Questions already asked, so they don't repeat. */
  asked: string[];
  /** This town's last few events (newest last), so the next draw avoids repeating them. */
  recent?: EventId[];
  /** What happened to this town this cycle, for the narrator. */
  report: string[];
  /** Optional fields allow version-2 saves to migrate without losing progress. */
  hazards?: RegionalHazard[];
  damageScars?: {
    type: EventId;
    started: number;
    remaining: number;
    severity: number;
    destroyed?: number;
  }[];
  technologies?: string[];
  research?: { id: string; remaining: number };
  actionsUsed?: number;
  lastMajor?: number;
  hardship?: number;
  eliminated?: boolean;
  productionCarry?: Partial<Stock>;
}
export interface News {
  round: number;
  civ?: CivId;
  text: string;
  /** Resource exchanges trigger shared, replayable port traffic. */
  kind?: "trade";
  give?: Resource;
  get?: Resource;
}
export interface GameState {
  version: 2;
  seed: number;
  rng: number;
  round: number;
  phase: Phase;
  mode: "solo" | "hotseat";
  player: CivId;
  /** Civilizations controlled by people; everyone else is an AI neighbor. */
  humans: CivId[];
  civs: Record<CivId, Civ>;
  events: Record<CivId, CycleEvent>;
  climate: number;
  history: { round: number; climate: number }[];
  news: News[];
  outcome?: "collapse" | "survived";
  collapseCause?: { type: "mega_tsunami"; origin: CivId; started: number };
  scheduled?: ScheduledHazard[];
  minorEvents?: Partial<Record<CivId, CycleEvent>>;
}

export type Action =
  | { type: "acknowledge"; civ: CivId }
  | { type: "choose"; civ: CivId; option: 0 | 1 | 2 }
  | { type: "build"; civ: CivId; building: string }
  | { type: "exchange"; civ: CivId; give: Resource; get: Resource }
  | { type: "research"; civ: CivId; technology: string }
  | { type: "contain"; civ: CivId; hazard: EventId }
  | { type: "ready"; civ: CivId };

export interface Question {
  id: string;
  types: DisasterId[];
  difficulty: 1 | 2 | 3;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  source: string;
  sourceLabel: string;
}
