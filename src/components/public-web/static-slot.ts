// Build-time copy (scripts/finish-public-web.mjs, prerender-public-posts.mjs) sits before the app root.
// Moving that node into an empty element React renders keeps it visible in the page layout after hydration;
// React never renders children into the slot, so it leaves the adopted node alone.
// Home, city and /meetups pages also ship #gling-static-wait, which hides #root until the live feed is in:
// their copy fills the slots only then, in the same step that shows the reader, so nothing on screen jumps.
const waiting = new Map<string, HTMLElement>();
// A feed that never answers must not keep the reader hidden; after this long it shows below the copy as before.
const REVEAL_FALLBACK_MS = 8000;
let fallback: ReturnType<typeof setTimeout> | undefined;

const byId = (id: string) => globalThis.document?.getElementById?.(id) ?? null;

function adopt(id: string, slot: HTMLElement) {
  const node = byId(id);
  if (node && node.parentNode !== slot) slot.appendChild(node);
}

export function adoptStatic(id: string) {
  return (slot: HTMLElement | null) => {
    if (!slot) return;
    if (!byId('gling-static-wait')) return adopt(id, slot);
    waiting.set(id, slot);
    fallback ??= setTimeout(() => revealStatic([]), REVEAL_FALLBACK_MS);
  };
}

// Fill the waiting slots, drop the crawler-only copy and show the reader in one go.
export function revealStatic(drop: string[]) {
  clearTimeout(fallback);
  fallback = undefined;
  for (const [id, slot] of waiting) if (slot.isConnected) adopt(id, slot);
  waiting.clear();
  for (const id of drop) byId(id)?.remove();
  byId('gling-static-wait')?.remove();
}
