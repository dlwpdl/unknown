import { lazy, Suspense, type ComponentProps } from 'react';

// Business profiles, festival lists and ads show on only some public views, so their code loads on first use.
const MerchantProfile = lazy(() => import('./merchant-profile').then(module => ({ default: module.PublicMerchantProfile })));
const MerchantProfileLink = lazy(() => import('./merchant-profile').then(module => ({ default: module.PublicMerchantProfileLink })));
const Festivals = lazy(() => import('./festivals').then(module => ({ default: module.PublicFestivals })));
const Ad = lazy(() => import('@/components/feed-ad').then(module => ({ default: module.FeedAd })));

export function PublicMerchantProfile(props: ComponentProps<typeof MerchantProfile>) {
  return <Suspense fallback={null}><MerchantProfile {...props} /></Suspense>;
}
export function PublicMerchantProfileLink(props: ComponentProps<typeof MerchantProfileLink>) {
  return <Suspense fallback={null}><MerchantProfileLink {...props} /></Suspense>;
}
export function PublicFestivals(props: ComponentProps<typeof Festivals>) {
  return <Suspense fallback={null}><Festivals {...props} /></Suspense>;
}
export function FeedAd(props: ComponentProps<typeof Ad>) {
  return <Suspense fallback={null}><Ad {...props} /></Suspense>;
}
