import { AdminScreen } from '@/components/admin/admin-screen';

// 관리자 알림을 탭하면 이 화면이 열린다. 권한 확인은 AdminScreen 안에서 한다.
export default function AdminRoute() {
  return <AdminScreen />;
}
