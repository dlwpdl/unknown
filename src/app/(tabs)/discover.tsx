import MapScreen from '@/app/map';
import { TabContent } from '@/components/tab-content';

// 지도 탭 (owner 2026-11-01 A안): 글쓰기 탭 자리에 같은 지도 화면을 '전체'로 연다. 링크로 여는 /map은 그대로 둔다.
export default function DiscoverTab() {
  return <TabContent style={{ flex: 1 }}><MapScreen tab /></TabContent>;
}
