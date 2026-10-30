// Build-time copy (scripts/finish-public-web.mjs, prerender-public-posts.mjs) sits before the app root.
// Moving that node into an empty element React renders keeps it visible in the page layout after hydration;
// React never renders children into the slot, so it leaves the adopted node alone.
export function adoptStatic(id: string) {
  return (slot: HTMLElement | null) => {
    const node = slot ? globalThis.document?.getElementById?.(id) : null;
    if (slot && node && node.parentNode !== slot) slot.appendChild(node);
  };
}
