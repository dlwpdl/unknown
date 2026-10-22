import { Redirect } from 'expo-router';

// 관리자 화면은 Mac의 비공개 웹 대시보드에서만 연다.
export default function AdminRoute() {
  return <Redirect href="/notifications" />;
}
