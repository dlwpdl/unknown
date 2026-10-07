import { AdminScreen } from '@/components/admin/admin-screen';
import { AdminMfaGate } from '@/components/admin/admin-mfa-gate';
export default function AdminIndex() {
  return <AdminMfaGate><AdminScreen /></AdminMfaGate>;
}
