export const LAUNCH_DURATION = 950;

function phase(time: number, start: number, duration: number) {
  'worklet';
  const progress = Math.min(1, Math.max(0, (time - start) / duration));
  return 1 - (1 - progress) ** 3;
}

// Coordinates use the unchanged 720 × 320 wordmark asset.
export function launchFrame(time: number, width: number, height: number,
  target: { x: number; y: number; scale: number } | null) {
  'worklet';
  const scale = width * .56 / 720;
  const join = phase(time, 180, 360);
  const reveal = phase(time, 230, 220);
  const travel = target ? phase(time, 500, 450) : 0;
  return {
    x: width * .22 * (1 - travel) + (target?.x ?? 0) * travel,
    y: height * .43 * (1 - travel) + (target?.y ?? 0) * travel,
    scale: scale * (1 - travel) + (target?.scale ?? 0) * travel,
    gx: (width * .28 / scale - 598) * (1 - join),
    gy: (height * .04 / scale - 164) * (1 - join),
    gScale: 1 + .85 * (1 - join),
    clipWidth: 164 + 252 * reveal,
    clipHeight: 142 + 498 * reveal,
    prefix: phase(time, 240, 280),
    ink: phase(time, 240, 210),
    rotation: -215 * (1 - phase(time, 0, 280)),
    logoOpacity: 1 - Math.min(1, Math.max(0, (time - 855) / 95)),
    curtainOpacity: 1 - phase(time, 660, 290),
    headerMaskOpacity: target ? 1 - phase(time, 870, 80) : 0,
  };
}
