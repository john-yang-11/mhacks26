import civData from "../../../../src/data/civs.json";
import buildingData from "../../../../src/data/buildings.json";
import eventData from "../../../../src/data/events.json";
import reactionData from "../../../../src/data/reactions.json";
import resourceData from "../../../../src/data/resources.json";
import type {
  CivId,
  DisasterId,
  EventId,
  ReactionKind,
  Resource,
  Stock,
} from "./types";

export const stock = (values: Partial<Stock> = {}): Stock => ({
  sheep: 0,
  wheat: 0,
  wood: 0,
  brick: 0,
  ore: 0,
  ...values,
});

export const RESOURCE_META = resourceData as Record<
  Resource,
  { name: string; icon: string; color: string }
>;

export const CIVS = civData as Record<
  CivId,
  {
    name: string;
    title: string;
    color: string;
    crest: string;
    description: string;
    strength: string;
    weakness: string;
    /** Starting stock. */
    start: Stock;
    /** What the home land yields every cycle before any buildings. */
    base: Stock;
    buildings: string[];
  }
>;

export interface BuildingDef {
  name: string;
  icon: string;
  cost: Partial<Stock>;
  description: string;
  yields?: Partial<Stock>;
  /** °C added (or removed, if negative) every cycle. */
  climate?: number;
  points?: number;
  /** How many one town can have. */
  max?: number;
  /** Pollutes; a windmill halves it. */
  dirty?: boolean;
  green?: boolean;
  /** Events whose future losses this building halves. */
  protects?: EventId[];
  /** Only earned through a sustainable choice, not built from the build menu. */
  earned?: boolean;
}
export const BUILDINGS = buildingData as Record<string, BuildingDef>;

export interface ChoiceDef {
  label: string;
  cost: Partial<Stock>;
  effect: string;
  climate?: number;
  /** Which neighbor gets the pushed-off damage. */
  spillTo?: "downstream" | "downwind" | "shared";
  spill?: Partial<Stock>;
  /** The protective building a sustainable choice earns. */
  build?: string;
}
export interface EventDef {
  name: string;
  icon: string;
  color: string;
  carrier: string;
  quizTypes: DisasterId[];
  regions: Partial<Record<CivId, number>>;
  loss: Partial<Stock>;
  /** A building in a neighboring town that makes this event likelier. */
  cause?: string;
  climateDriven?: boolean;
  /** Chain-only hazards replace one of these primary events after a second seeded roll. */
  chainFrom?: EventId[];
  chainChance?: number;
  tell: string;
  caused?: string;
  /** Spoken by the neighbor who would receive the cheap option's consequences. */
  neighbor: string;
  cheap: ChoiceDef;
  green: ChoiceDef;
  lesson: string;
  source: string;
}
export const EVENTS = eventData as Record<EventId, EventDef>;

export interface ReactionDef {
  label: string;
  description: string;
  cost: Partial<Stock>;
  lossMultiplier?: number;
  incomePenalty?: number;
}
export const REACTIONS = reactionData as Record<ReactionKind, ReactionDef>;
