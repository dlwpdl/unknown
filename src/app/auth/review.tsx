import { Redirect, router } from 'expo-router';

import { LoginPanel } from '@/components/login-panel';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';

export default function ReviewAccessRoute() {
  const { isAuthed, isAuthLoading, authError, signInReview } = useAuth();
  if (isAuthed) return <Redirect href="/profile" />;
  return (
    <LoginPanel
      reason={t.auth.reviewLoginTitle}
      onReviewLogin={signInReview}
      loading={isAuthLoading}
      error={authError}
      onClose={() => router.canGoBack() ? router.back() : router.replace('/profile')}
    />
  );
}
