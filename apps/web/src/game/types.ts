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

/** Every hazard in the event matrix is a playable cycle event. */
export type EventId = DisasterId;

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
  /** What happened to this town this cycle, for the narrator. */
  report: string[];
}
export interface News {
  round: number;
  civ?: CivId;
  text: string;
  /**
   * "trade": a resource exchange (drives port traffic). "event": a town's disaster and how it
   * responded. "spill": damage a neighbor's cheap fix pushed onto this town. Events and spills let
   * the map draw lasting scars that heal over the following decades.
   */
  kind?: "trade" | "event" | "spill";
  give?: Resource;
  get?: Resource;
  event?: EventId;
  option?: 0 | 1 | 2;
  from?: CivId;
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
}

export type Action =
  | { type: "acknowledge"; civ: CivId }
  | { type: "choose"; civ: CivId; option: 0 | 1 | 2 }
  | { type: "build"; civ: CivId; building: string }
  | { type: "exchange"; civ: CivId; give: Resource; get: Resource }
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
