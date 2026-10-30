// Same read-once matchMedia check as Reanimated's web hook, without bundling Reanimated into web pages.
const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useReducedMotion() {
  return reducedMotion;
}
