// Only fixed UI identifiers and numeric measurements. Never pass user input here.
export type BehaviorEvent = { seq: number; screen: string; kind: 'view' | 'press' | 'scroll' | 'dwell' | 'success'; target: string; value: number };
export type BehaviorBatch = { session: string; events: BehaviorEvent[] };
let send: ((batch: BehaviorBatch) => Promise<boolean>) | null = null;
let session = '';
let sequence = 0;
let screen = 'feed';
let view = 0;
export function behaviorView() { return view; }
let queue: BehaviorEvent[] = [];
let pending = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function configureBehavior(transport: typeof send) {
  generation++;
  send = transport;
  // Correlation only, never an authentication credential. Memory-only, reset on account change.
  session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  sequence = 0;
  queue = [];
  clearTimeout(timer);
  timer = undefined;
}
// A phone left open sent a dwell row every 30 seconds for days, so counting stops after this long without a touch.
// shortcut: typing on the keyboard is not a touch here, so a long compose undercounts; count it too if compose time ever matters.
const IDLE_AFTER_MS = 5 * 60 * 1000;
let lastTouch = Date.now();
export function noteTouch() { lastTouch = Date.now(); }
export function isIdle(now = Date.now()) { return now - lastTouch >= IDLE_AFTER_MS; }
export function behaviorScreen(name: string) { screen = name; view++; behavior('view', 'screen'); }
export function behavior(kind: BehaviorEvent['kind'], target: string, value = 1) {
  if (!send || !Number.isFinite(value)) return;
  if (kind === 'success') {
    // Send before onboarding/logout can rotate the queue. Never delay the completed action.
    void send({ session, events: [{ seq: ++sequence, screen, kind, target, value: 1 }] }).catch(() => {});
    return;
  }
  if (queue.length >= 100) queue.shift(); // Best effort; never persist sensitive activity on disk.
  queue.push({ seq: ++sequence, screen, kind, target, value: Math.round(value) });
  if (!timer) timer = setTimeout(() => { timer = undefined; void flushBehavior(); }, 5000);
}
export async function flushBehavior() {
  if (pending || !send || !queue.length) return;
  const epoch = generation;
  const events = queue.slice(0, 25);
  const transport = send;
  pending = true;
  try {
    if (await transport({ session, events }) && generation === epoch) {
      const last = events.at(-1)!.seq;
      queue = queue.filter((event) => event.seq > last);
    }
  } catch { /* Analytics must never interrupt the product. */ }
  finally {
    pending = false;
    if (queue.length && !timer) timer = setTimeout(() => { timer = undefined; void flushBehavior(); }, 5000);
  }
}
export function scrollThresholds(offset: number, viewport: number, content: number, previous: number) {
  if (![offset, viewport, content].every(Number.isFinite) || viewport <= 0 || content <= viewport) return [];
  const depth = Math.min(100, Math.max(0, (offset + viewport) / content * 100));
  return [25, 50, 75, 100].filter((value) => value > previous && depth >= value - 0.1);
}
