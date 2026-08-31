import { AdminScreen } from '@/components/admin/admin-screen';
import { ThemeOverrideProvider } from '@/hooks/use-theme';

export default function AdminWebRoute() {
  return (
    <ThemeOverrideProvider scheme="light">
      <AdminScreen />
    </ThemeOverrideProvider>
  );
}
