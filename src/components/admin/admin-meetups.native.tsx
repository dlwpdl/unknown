import { ThemedText } from '@/components/themed-text';
export function AdminMeetupsView(_props: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  return <ThemedText accessibilityLiveRegion="polite">모임 모니터링은 관리자 웹에서 이용할 수 있습니다.</ThemedText>;
}
