import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import type { AdminDirectoryProfile } from '@/lib/admin-user-data';

export function AdminUserBusiness(_props: { account: AdminDirectoryProfile; onChanged: () => void }) {
  return <View><ThemedText accessibilityLiveRegion="polite">회원 비즈니스 연결은 관리자 웹에서 이용할 수 있습니다.</ThemedText></View>;
}
