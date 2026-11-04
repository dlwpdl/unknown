// Owner 2026-11-04 ⑪ "살아 있는 움직임": each map category plays its own gesture once on press, never on repeat and never
// with reduced motion. Copied from output/reviews/category-icon-chips-2026-11-03/index.html (@keyframes a-*, the ALIVE table and
// `.mv-alive … animation: var(--am) .64s cubic-bezier(.25,.8,.35,1)`). CSS times each step between keyframes with that curve.
export const ALIVE_MS = 640;
export const ALIVE_BEZIER = [0.25, 0.8, 0.35, 1] as const;

/** One property's keyframes as [offset 0–1, value]; translate is in points, rotate in degrees. */
export type AliveTrack = readonly (readonly [at: number, value: number])[];
export type AliveTracks = Partial<Record<'x' | 'y' | 'rotate' | 'scaleX' | 'scaleY', AliveTrack>>;

const rest = (from: number, ...steps: [number, number][]): AliveTrack => [[0, from], ...steps, [1, from]];
const rock = (...steps: [number, number][]) => rest(0, ...steps);
const pulse = (...steps: [number, number][]) => rest(1, ...steps);

const MOTIONS = {
  hop: { y: rock([0.22, 1], [0.5, -6], [0.78, 0]), scaleX: pulse([0.22, 1.1], [0.5, 0.94], [0.78, 1.04]), scaleY: pulse([0.22, 0.88], [0.5, 1.07], [0.78, 0.96]) },
  wig: { rotate: rock([0.18, -13], [0.42, 11], [0.66, -6], [0.86, 2]) },
  spin: { rotate: [[0, 0], [1, 360]], scaleX: pulse([0.45, 1.22]), scaleY: pulse([0.45, 1.22]) },
  scoot: { x: rock([0.2, -2], [0.55, 5], [0.8, -1]), rotate: rock([0.2, -7], [0.55, 3], [0.8, 0]) },
  clink: { rotate: rock([0.3, -18], [0.6, 10], [0.82, -3]) },
  burst: { scaleX: pulse([0.25, 0.84], [0.55, 1.24], [0.8, 0.98]), scaleY: pulse([0.25, 0.84], [0.55, 1.24], [0.8, 0.98]), rotate: rock([0.25, -8], [0.55, 10], [0.8, -2]) },
  swing: { rotate: rock([0.28, -22], [0.58, 12], [0.84, -4]) },
  squash: { scaleX: pulse([0.22, 1.16], [0.5, 0.9], [0.76, 1.04]), scaleY: pulse([0.22, 0.8], [0.5, 1.12], [0.76, 0.97]) },
} satisfies Record<string, AliveTracks>;

/** Category → [gesture, transform-origin x, y as fractions of the icon box]. */
export const ALIVE = {
  top25: ['spin', 0.5, 0.5], delivery: ['scoot', 0.5, 0.8], dining: ['clink', 0.5, 0.9], cafe: ['hop', 0.5, 1],
  festival: ['burst', 0.3, 0.8], nightlife: ['swing', 0.5, 0.2], places: ['swing', 0.5, 1],
  housing: ['squash', 0.5, 1], used: ['swing', 0.2, 0.2], events: ['wig', 0.5, 0.5],
} as const satisfies Record<string, readonly [keyof typeof MOTIONS, number, number]>;

/**
 * The gesture one press plays, or null when the phone asks for less motion or the category has none.
 * The origin is in points from the icon's center, for a translate → transform → translate back around it.
 */
export function aliveMotion(id: string, size: number, reduced: boolean): { tracks: AliveTracks; originX: number; originY: number } | null {
  if (reduced || !Object.hasOwn(ALIVE, id)) return null;
  const [gesture, x, y] = ALIVE[id as keyof typeof ALIVE];
  return { tracks: MOTIONS[gesture], originX: (x - 0.5) * size, originY: (y - 0.5) * size };
}

/** A track's steps as [target, ms], each eased on its own like a CSS keyframe step. */
export const aliveSteps = (track: AliveTrack) => track.slice(1).map(([at, value], index) => [value, (at - track[index][0]) * ALIVE_MS] as const);
