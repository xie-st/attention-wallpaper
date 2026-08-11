export type PetState =
  | "idle"
  | "drift-right"
  | "drift-left"
  | "celebrate"
  | "hop"
  | "end-of-article"
  | "pause"
  | "walk-down"
  | "walk-up";

export type PetEvent =
  | "double-click"
  | "article-end"
  | "article-start"
  | "pause"
  | "resume";

export interface PetBehaviorInput {
  currentState: PetState;
  dt: number;
  rng: () => number;
  events: PetEvent[];
  articleProgress: number;
  savedWalkingState?: PetState;
  celebratedMs?: number;
}

export interface PetBehaviorOutput {
  nextState: PetState;
  positionDelta: { dx: number; dy: number };
  currentRow: number;
  savedWalkingState?: PetState;
  celebratedMs?: number;
  articleSwitch?: boolean;
}

export interface PetBehaviorConfig {
  petRate: number;
  flourishMs: number;
  driftProb: number;
  hopProb: number;
  idleProb: number;
  driftMaxMs: number;
}

export const DEFAULT_CONFIG: PetBehaviorConfig = {
  petRate: 30,
  flourishMs: 800,
  driftProb: 0.04,
  hopProb: 0.02,
  idleProb: 0.03,
  driftMaxMs: 600,
};

export const ROW_BY_STATE: Record<PetState, number> = {
  idle: 0,
  "drift-right": 1,
  "drift-left": 2,
  celebrate: 3,
  hop: 4,
  "end-of-article": 5,
  pause: 6,
  "walk-down": 7,
  "walk-up": 8,
};

export type PetStateName = "idle" | "drift" | "hop";

function pickFlavor(
  rng: () => number,
  config: PetBehaviorConfig,
): PetStateName | "walk" {
  const r = rng();
  const { idleProb, hopProb, driftProb } = config;
  if (r < idleProb) return "idle";
  if (r < idleProb + hopProb) return "hop";
  if (r < idleProb + hopProb + driftProb) return "drift";
  return "walk";
}

const FLAVOR_STATES: ReadonlySet<PetState> = new Set([
  "idle",
  "drift-right",
  "drift-left",
  "hop",
]);

export function step(
  input: PetBehaviorInput,
  config: PetBehaviorConfig = DEFAULT_CONFIG,
): PetBehaviorOutput {
  let nextState: PetState = input.currentState;
  const atEnd =
    input.articleProgress >= 1.0 || input.events.includes("article-end");
  let savedWalkingState: PetState | undefined;
  let celebratedMs: number | undefined;
  let articleSwitch = false;

  const isWalking =
    input.currentState === "walk-down" || input.currentState === "walk-up";

  if (isWalking && input.events.includes("pause")) {
    nextState = "pause";
    savedWalkingState = input.currentState;
  } else if (
    input.currentState === "pause" &&
    input.events.includes("resume") &&
    input.savedWalkingState
  ) {
    nextState = input.savedWalkingState;
  } else if (input.currentState === "walk-down" && atEnd) {
    nextState = "end-of-article";
  } else if (
    input.currentState === "end-of-article" &&
    input.events.includes("double-click")
  ) {
    nextState = "celebrate";
    celebratedMs = input.dt;
  } else if (
    input.currentState === "walk-down" &&
    input.events.includes("double-click")
  ) {
    nextState = "walk-up";
  } else if (
    input.currentState === "walk-up" &&
    input.events.includes("article-start")
  ) {
    nextState = "walk-down";
  } else if (input.currentState === "celebrate") {
    const acc = (input.celebratedMs ?? 0) + input.dt;
    if (acc >= config.flourishMs) {
      nextState = "walk-down";
      articleSwitch = true;
    } else {
      nextState = "celebrate";
      celebratedMs = acc;
    }
  } else if (input.currentState === "walk-down") {
    const flavor = pickFlavor(input.rng, config);
    if (flavor === "drift") {
      nextState = input.rng() < 0.5 ? "drift-right" : "drift-left";
    } else if (flavor === "hop") {
      nextState = "hop";
    } else if (flavor === "idle") {
      nextState = "idle";
    }
  } else if (FLAVOR_STATES.has(input.currentState)) {
    nextState = "walk-down";
  }

  const dy = nextState === "walk-down" ? (config.petRate * input.dt) / 1000 : 0;
  const out: PetBehaviorOutput = {
    nextState,
    positionDelta: { dx: 0, dy },
    currentRow: ROW_BY_STATE[nextState],
    articleSwitch,
  };
  if (savedWalkingState !== undefined) out.savedWalkingState = savedWalkingState;
  if (celebratedMs !== undefined) out.celebratedMs = celebratedMs;
  return out;
}
