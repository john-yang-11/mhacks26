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
 * → everyone makes a choice (cheap vs sustainable) → victims react to incoming effects
 * → everyone builds → the cycle ends.
 */
export type Phase =
  "event" | "quiz" | "response" | "choice" | "reaction" | "build" | "ended";

export type ReactionKind = "absorb" | "redirect" | "embargo" | "accept";
export interface EffectReaction {
  kind: ReactionKind;
  redirectTo?: CivId;
  resource?: Resource;
}
export interface PendingEffect {
  id: string;
  from: CivId;
  /** The civilization that has the right to react. */
  to: CivId;
  event: EventId;
  route: "downstream" | "downwind" | "shared";
  loss: Partial<Stock>;
  reaction?: EffectReaction;
}
export interface Embargo {
  by: CivId;
  on: CivId;
  resource: Resource;
  /** The decade in which bank trade and income are restricted. */
  round: number;
}

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
}
export interface GameState {
  version: 3;
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
  /** Cross-border effects waiting for their victims during the reaction phase. */
  pendingEffects: PendingEffect[];
  /** Retaliatory restrictions active for one decade. */
  embargoes: Embargo[];
  outcome?: "collapse" | "survived";
}

export type Action =
  | { type: "acknowledge"; civ: CivId }
  | { type: "choose"; civ: CivId; option: 0 | 1 | 2 }
  | {
      type: "react";
      civ: CivId;
      effectId: string;
      kind: ReactionKind;
      redirectTo?: CivId;
      resource?: Resource;
    }
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
