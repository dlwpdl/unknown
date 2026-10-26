import { ThemedText } from '@/components/themed-text';
export function AdminMeetupsView(_props: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  return <ThemedText accessibilityLiveRegion="polite">모임은 관리자 웹에서 볼 수 있어요.</ThemedText>;
}
