// Overlay visibility reducer — ADR-0025.
// Pure function: given the foreground-window signal + current alpha + dt,
// returns the next alpha (eased toward 0 or 1 over FADE_MS) and whether the
// PetBehavior step loop should run this tick (only when alpha > 0).

export const FADE_MS = 200;

export interface VisibilityInput {
  /** True when the foreground window is the desktop (Progman/WorkerW). */
  foregroundIsDesktop: boolean;
  /** Current overlay alpha in [0, 1]. */
  currentAlpha: number;
  /** Milliseconds since the last visibility tick. */
  dt: number;
}

export interface VisibilityOutput {
  nextAlpha: number;
  /** True iff PetBehavior.step should run this tick (alpha > 0). */
  shouldStepPet: boolean;
}

export function stepVisibility(input: VisibilityInput): VisibilityOutput {
  const target = input.foregroundIsDesktop ? 1 : 0;
  const delta = (input.dt / FADE_MS) * (target - input.currentAlpha > 0 ? 1 : -1);
  let nextAlpha = input.currentAlpha + delta;
  if (target > input.currentAlpha) nextAlpha = Math.min(target, nextAlpha);
  else nextAlpha = Math.max(target, nextAlpha);
  return { nextAlpha, shouldStepPet: nextAlpha > 0 };
}
