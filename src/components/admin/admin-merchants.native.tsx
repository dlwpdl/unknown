import { ThemedText } from '@/components/themed-text';
import { View } from 'react-native';
import { AdminMerchantReceiptQueue } from '@/components/admin/admin-merchant-receipt-queue';
export function AdminMerchantsView(props: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  return <View><ThemedText accessibilityLiveRegion="polite">비즈니스 관리와 보고서는 관리자 웹에서 쓸 수 있어요.</ThemedText><AdminMerchantReceiptQueue {...props} /></View>;
}
