import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';

export function AdminUserMembership(_props: { userId: string; active: boolean }) {
  return <View><ThemedText accessibilityLiveRegion="polite">멤버십 변경은 관리자 웹에서 할 수 있어요.</ThemedText></View>;
}
