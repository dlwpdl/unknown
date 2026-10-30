import { lazy, Suspense, type ComponentProps } from 'react';

// Web pages mount AuthProvider everywhere but show these panels only after a login or signup starts.
const Login = lazy(() => import('@/components/login-panel').then(module => ({ default: module.LoginPanel })));
const Onboarding = lazy(() => import('@/components/profile-onboarding').then(module => ({ default: module.ProfileOnboarding })));

export function LoginPanel(props: ComponentProps<typeof Login>) {
  return <Suspense fallback={null}><Login {...props} /></Suspense>;
}
export function ProfileOnboarding(props: ComponentProps<typeof Onboarding>) {
  return <Suspense fallback={null}><Onboarding {...props} /></Suspense>;
}
