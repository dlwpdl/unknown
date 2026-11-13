import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';

// Room left beside a revealed chip so the next one still peeks out and the row reads as scrollable.
const EDGE = 24;

/** Which ends of a sideways row still have chips past them. */
export function scrollEdges(offset: number, viewport: number, content: number) {
  return { start: offset > 1, end: offset + viewport < content - 1 };
}

/** The scroll offset that shows [x, x + width] whole; the same offset when it already shows. */
export function revealOffset(offset: number, viewport: number, content: number, x: number, width: number) {
  const target = x - EDGE < offset ? x - EDGE : x + width + EDGE > offset + viewport ? x + width + EDGE - viewport : offset;
  return Math.max(0, Math.min(target, content - viewport));
}

/** A sideways chip row that scrolls the chosen chip into view when it sits off screen or cut at the edge (QA Q07).
 * `fade` (Android only; callers pass Platform.OS === 'android') also fades each end only while more chips sit past it:
 * Android's fadingEdgeLength draws both ends at full strength whatever the scroll position, so a row still at its start had its first chip dimmed (QA new-left-fade). */
export function useRevealChip(selected: string, animated: boolean, fade = false) {
  const ref = useRef<ScrollViewInstance>(null);
  const row = useRef({ offset: 0, viewport: 0, content: 0 });
  const chips = useRef(new Map<string, { x: number; width: number }>());
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = () => {
    if (!fade) return;
    const next = scrollEdges(row.current.offset, row.current.viewport, row.current.content);
    setEdges(old => old.start === next.start && old.end === next.end ? old : next);
  };
  const reveal = () => {
    const chip = chips.current.get(selected), { offset, viewport, content } = row.current;
    if (!chip || !viewport || !content) return;
    const next = revealOffset(offset, viewport, content, chip.x, chip.width);
    if (Math.abs(next - offset) < 1) return;
    row.current.offset = next;
    ref.current?.scrollTo({ x: next, animated });
  };
  useEffect(reveal, [selected]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new choice scrolls the row
  return {
    scroll: {
      ref, scrollEventThrottle: 16,
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { row.current.offset = event.nativeEvent.contentOffset.x; measure(); },
      onLayout: (event: LayoutChangeEvent) => { row.current.viewport = event.nativeEvent.layout.width; reveal(); measure(); },
      // A chip chosen from a sheet is added at the end, so the row grows after the choice.
      onContentSizeChange: (width: number) => { row.current.content = width; reveal(); measure(); },
      ...(fade ? { fadingEdgeLength: { start: edges.start ? EDGE : 0, end: edges.end ? EDGE : 0 } } : {}),
    },
    chip: (key: string) => (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      chips.current.set(key, { x, width });
      if (key === selected) reveal();
    },
  };
}
