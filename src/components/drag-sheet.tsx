import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SymbolView } from '@/components/symbol-view';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { onLinkOpen } from '@/lib/link-open';

type Latest = { onClose: () => void; onDismissed?: () => void; dismissible: boolean; reduced: boolean; play: ReturnType<typeof useInteractionFeedback>['play'] };

/** The latest props and measured height. The pan handlers are built on the first render and read this only while a finger moves. */
class SheetLive {
  props: Latest; height = 0;
  constructor(props: Latest) { this.props = props; }
  update(props: Latest) { this.props = props; }
  measure(height: number) { this.height = height; }
}

type Props = {
  visible: boolean; onClose: () => void;
  // Runs once the sheet is really gone: iOS drops an Alert or Modal presented while another is still leaving.
  onDismissed?: () => void;
  // False while saving: the handle, backdrop and back gesture cannot discard the work.
  dismissible?: boolean;
  title?: string; children: ReactNode;
};

/** The one bottom sheet: slides up, fades its backdrop, and follows a finger on the handle or title to close. */
export function DragSheet({ visible, onClose, onDismissed, dismissible = true, title, children }: Props) {
  const { tr } = useLanguage();
  const theme = useTheme(), insets = useSafeAreaInsets(), { play } = useInteractionFeedback();
  const reduced = useReducedMotion(), { height: screen } = useWindowDimensions();
  const [y] = useState(() => new Animated.Value(screen)), [fade] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const [live] = useState(() => new SheetLive({ onClose, onDismissed, dismissible, reduced, play }));
  useLayoutEffect(() => { live.update({ onClose, onDismissed, dismissible, reduced, play }); });
  const settle = () => Animated.parallel([
    Animated.spring(y, { toValue: 0, damping: 28, stiffness: 320, mass: 0.9, overshootClamping: true, useNativeDriver: true }),
    Animated.timing(fade, { toValue: 1, duration: ControlMotion.settleMs, useNativeDriver: true }),
  ]).start();
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible === wasVisible.current) return;
    wasVisible.current = visible;
    if (visible) {
      if (live.props.reduced) { y.setValue(0); Animated.timing(fade, { toValue: 1, duration: ControlMotion.settleMs, useNativeDriver: true }).start(); }
      else { y.setValue(live.height || screen); fade.setValue(0); settle(); }
      return;
    }
    const finish = () => { setMounted(false); if (Platform.OS !== 'ios') live.props.onDismissed?.(); };
    if (live.props.reduced) Animated.timing(fade, { toValue: 0, duration: ControlMotion.settleMs, useNativeDriver: true }).start(finish);
    else Animated.parallel([
      Animated.timing(y, { toValue: live.height || screen, duration: ControlMotion.sheetCloseMs, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: ControlMotion.sheetCloseMs, useNativeDriver: true }),
    ]).start(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the visible flag starts a transition
  }, [visible]);
  // A link or tapped push changes the screen behind every sheet, so an open sheet steps aside (QA Q08). Saving sheets stay.
  useEffect(() => visible ? onLinkOpen(() => { if (live.props.dismissible) live.props.onClose(); }) : undefined, [visible, live]);
  const [pan] = useState(() => {
    const claim = (_: unknown, g: { dx: number; dy: number }) => live.props.dismissible && Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx);
    return PanResponder.create({
      // RN's Modal takes every touch no child takes, and then never offers the move to us: the title only drags if we take the touch first.
      onStartShouldSetPanResponder: () => live.props.dismissible,
      onMoveShouldSetPanResponder: claim, onMoveShouldSetPanResponderCapture: claim,
      onPanResponderGrant: () => y.stopAnimation(),
      onPanResponderMove: (_, g) => {
        const dy = Math.max(0, g.dy);
        y.setValue(dy); fade.setValue(1 - dy / Math.max(live.height || screen, 1));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > Math.min(96, (live.height || screen) * 0.25) || g.vy > 0.9) { live.props.play('selection'); live.props.onClose(); }
        else settle();
      },
      onPanResponderTerminate: () => settle(),
    });
  });
  const close = () => { play('selection'); onClose(); };
  return <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={() => { if (dismissible) close(); }} onDismiss={() => live.props.onDismissed?.()}>
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: fade }]} />
      <Pressable analyticsId="sheet.dismiss" accessibilityRole="button" accessibilityLabel={tr('닫기')} disabled={!dismissible} style={StyleSheet.absoluteFill} onPress={close} />
      <Animated.View accessibilityViewIsModal onAccessibilityEscape={() => { if (dismissible) onClose(); }}
        onLayout={event => live.measure(event.nativeEvent.layout.height)}
        style={[styles.sheet, { backgroundColor: theme.card, borderTopColor: theme.line, paddingBottom: Math.max(insets.bottom, Spacing.three), opacity: reduced ? fade : 1, transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers}>
          <Pressable analyticsId="sheet.grip" accessibilityRole="button" accessibilityLabel={tr('닫기')} disabled={!dismissible} onPress={close} style={styles.gripZone}>
            <View style={[styles.grip, { backgroundColor: theme.line }]} />
          </Pressable>
          {!!title && <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" numberOfLines={2} style={[Typography.sheetTitle, styles.title]}>{title}</ThemedText>
            <Pressable analyticsId="sheet.close" accessibilityRole="button" accessibilityLabel={tr('닫기')} disabled={!dismissible} onPress={close}
              style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed, disabled: !dismissible }).container]}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.inline} tintColor={theme.textSecondary} />
            </Pressable>
          </View>}
        </View>
        {children}
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '92%', paddingHorizontal: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  gripZone: { minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 36, height: 4, borderRadius: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, marginBottom: Spacing.two },
  title: { flex: 1 },
});
