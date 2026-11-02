/** Where a dragged row lands, from how far it moved and one row's height. */
export function dropIndex(from: number, dy: number, rowHeight: number, count: number) {
  if (rowHeight <= 0) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / rowHeight)));
}

/** How many rows a resting row steps aside while another is held over its place. */
export function dragOffset(index: number, from: number, to: number) {
  if (from < index && index <= to) return -1;
  if (to <= index && index < from) return 1;
  return 0;
}

/** Moves one photo. The public photo is stored by position, so the choice follows its picture. */
export function movePhoto<T>(photos: T[], publicIndex: number | null, from: number, to: number) {
  const order = photos.map((_, index) => index);
  const [moved] = order.splice(from, 1);
  if (moved === undefined || to < 0 || to >= photos.length) return { photos, publicIndex };
  order.splice(to, 0, moved);
  return { photos: order.map(index => photos[index]), publicIndex: publicIndex === null ? null : order.indexOf(publicIndex) };
}
