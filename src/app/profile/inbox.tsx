import NotificationsScreen from '@/app/(tabs)/notifications';

// 프로필에서 열면 스택 헤더(뒤로가기)가 붙는다. 탭의 알림 화면을 그대로 쓴다.
export default function ProfileInbox() {
  return <NotificationsScreen embedded />;
}
