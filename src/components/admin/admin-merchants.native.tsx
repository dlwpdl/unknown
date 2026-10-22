import { ThemedText } from '@/components/themed-text';
import { View } from 'react-native';
import { AdminMerchantReceiptQueue } from '@/components/admin/admin-merchant-receipt-queue';
export function AdminMerchantsView(props: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  return <View><ThemedText accessibilityLiveRegion="polite">벤더 관리와 보고서는 관리자 웹에서 이용할 수 있습니다.</ThemedText><AdminMerchantReceiptQueue {...props} /></View>;
}
