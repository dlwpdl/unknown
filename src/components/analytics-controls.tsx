import { useRef, type ComponentProps } from 'react';
import { Switch as NativeSwitch, SectionList as NativeSectionList, type SectionListProps, type DefaultSectionT, Pressable as NativePressable, ScrollView as NativeScrollView, FlatList as NativeFlatList, type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native';
import { behavior, behaviorView, scrollThresholds } from '@/lib/behavior-analytics';

type Tracking = { analyticsId: string };
export function Pressable({ analyticsId, onPress, ...props }: ComponentProps<typeof NativePressable> & Tracking) {
  return <NativePressable {...props} onPress={onPress ? (event) => { behavior('press', analyticsId); onPress(event); } : undefined} />;
}
function useScroll(id: string, horizontal?: boolean | null, original?: ScrollViewProps['onScroll']) {
  const reached = useRef(0);
  const view = useRef(behaviorView());
  return (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    original?.(event);
    if (view.current !== behaviorView()) { view.current = behaviorView(); reached.current = 0; }
    if (horizontal) return;
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    for (const depth of scrollThresholds(contentOffset.y, layoutMeasurement.height, contentSize.height, reached.current)) {
      reached.current = depth;
      behavior('scroll', id, depth);
    }
  };
}
export function ScrollView({ analyticsId, onScroll, ...props }: ComponentProps<typeof NativeScrollView> & Tracking) {
  const record = useScroll(analyticsId, props.horizontal, onScroll);
  return <NativeScrollView {...props} onScroll={record} scrollEventThrottle={props.scrollEventThrottle ?? 250} />;
}
export function FlatList<T>({ analyticsId, onScroll, ...props }: FlatListProps<T> & Tracking & { ref?: React.Ref<NativeFlatList<T>> }) {
  const record = useScroll(analyticsId, props.horizontal, onScroll);
  return <NativeFlatList {...props} onScroll={record} scrollEventThrottle={props.scrollEventThrottle ?? 250} />;
}

export function Switch({ analyticsId, onValueChange, ...props }: ComponentProps<typeof NativeSwitch> & Tracking) {
  return <NativeSwitch {...props} onValueChange={(value) => { behavior('press', `${analyticsId}.${value ? 'on' : 'off'}`); onValueChange?.(value); }} />;
}
export function SectionList<T, S = DefaultSectionT>({ analyticsId, onScroll, ...props }: SectionListProps<T, S> & Tracking) {
  const record = useScroll(analyticsId, props.horizontal, onScroll);
  return <NativeSectionList {...props} onScroll={record} scrollEventThrottle={props.scrollEventThrottle ?? 250} />;
}
