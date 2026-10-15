import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import type { PartnershipView } from '@/lib/admin-partnerships';

export function AdminPartnershipsView(_props: { kind: PartnershipView; refreshSignal: number; onUser: (id: string) => void; onStateChange?: (state: { dirty: boolean; busy: boolean }) => void }) {
  return <View><ThemedText>크리에이터·협업·혜택 관리는 관리자 웹에서 이용할 수 있습니다.</ThemedText></View>;
}
