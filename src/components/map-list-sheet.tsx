import { memo, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable } from '@/components/analytics-controls';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';
const SNAPS: SheetSnap[] = ['full', 'half', 'peek', 'closed'];
type Positions = Record<SheetSnap, number>;
type Latest = { snap: SheetSnap; positions: Positions; onSnap: (snap: SheetSnap) => void; reduced: boolean; play: ReturnType<typeof useInteractionFeedback>['play'] };

/** The latest props, read by pan handlers built once on the first render. */
class SheetLive {
  props: Latest; start = 0; dragging = false; settled: { snap: SheetSnap; at: number } | null = null;
  constructor(props: Latest) { this.props = props; }
  update(props: Latest) { this.props = props; }
}

// The cards are first drawn when the sheet first opens, and a closed sheet keeps its last cards without redrawing them (map lag 2026-11-11).
const Body = memo(function Body({ children }: { open: boolean; children: ReactNode }) { return children; }, (_, next) => !next.open);

// Apple's momentum projection (decelerationRate 0.998); vy is px per ms.
const project = (vy: number) => vy * 0.998 / (1 - 0.998);
const rubberband = (overshoot: number) => (1 - 1 / (overshoot * 0.55 / 240 + 1)) * 240;

/**
 * A list that rises over the map without a backdrop, so the map stays usable above it.
 * `positions` are the sheet's top edge for each stop, measured by the screen; dragging the grip or header throws it to the nearest stop.
 */
export function MapListSheet({ snap, positions, onSnap, header, children }: { snap: SheetSnap; positions: Positions; onSnap: (snap: SheetSnap) => void; header: ReactNode; children: ReactNode }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const [y] = useState(() => new Animated.Value(positions.closed || 2000));
  const [live] = useState(() => new SheetLive({ snap, positions, onSnap, reduced, play }));
  useLayoutEffect(() => { live.update({ snap, positions, onSnap, reduced, play }); });
  const [settle] = useState(() => (target: SheetSnap, velocity = 0) => {
    const at = live.props.positions[target];
    const first = !live.settled;
    live.settled = { snap: target, at };
    if (first || live.props.reduced) { y.stopAnimation(); y.setValue(at); return; }
    Animated.spring(y, { toValue: at, velocity, damping: 30, stiffness: 300, mass: 0.9, overshootClamping: target === 'closed', useNativeDriver: true }).start();
  });
  const at = positions[snap];
  // Follow the stop the screen asks for, and new measurements; a stop the finger just threw to is already moving there.
  // The first measured stop is placed without motion.
  useEffect(() => { if (positions.closed > 0 && !live.dragging && (live.settled?.snap !== snap || live.settled.at !== at)) settle(snap); }, [snap, at, positions.closed, live, settle]);
  const [pan] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { y.stopAnimation(); live.dragging = true; live.start = live.props.positions[live.props.snap]; },
    onPanResponderMove: (_, g) => {
      const raw = live.start + g.dy, top = live.props.positions.full;
      y.setValue(raw < top ? top - rubberband(top - raw) : raw);
    },
    onPanResponderRelease: (_, g) => {
      live.dragging = false;
      const projected = live.start + g.dy + project(g.vy), stops = live.props.positions;
      const target = SNAPS.reduce((best, value) => Math.abs(stops[value] - projected) < Math.abs(stops[best] - projected) ? value : best);
      settle(target, g.vy * 1000);
      if (target !== live.props.snap) { live.props.play('selection'); live.props.onSnap(target); }
    },
    onPanResponderTerminate: () => { live.dragging = false; settle(live.props.snap); },
  }));
  const grow = () => { play('selection'); onSnap(snap === 'full' ? 'half' : 'full'); };
  const open = snap !== 'closed', [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return <View pointerEvents="box-none" style={styles.frame}><Animated.View pointerEvents={open ? 'box-none' : 'none'} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    style={[styles.sheet, { top: 0, height: Math.max(positions.closed - positions.full, 0), backgroundColor: theme.card, borderColor: theme.line, transform: [{ translateY: y }] }]}>
    <View {...pan.panHandlers}>
      <Pressable analyticsId="discovery.sheet" accessibilityRole="button" accessibilityLabel={snap === 'full' ? tr('목록 줄이기') : tr('목록 크게 보기')}
        accessibilityState={{ expanded: snap === 'full' }} onPress={grow} style={styles.gripZone}>
        <View style={[styles.grip, { backgroundColor: theme.line }]} />
      </Pressable>
      {header}
    </View>
    <View style={styles.body}>{opened && <Body open={open}>{children}</Body>}</View>
  </Animated.View></View>;
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  sheet: { position: 'absolute', left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 6 },
  gripZone: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 36, height: 4, borderRadius: 2 },
  body: { flex: 1, minHeight: 0 },
});
