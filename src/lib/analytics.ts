// Keep identifiers, OAuth parameters, searches and private text out of analytics.
export function analyticsScreen(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/^\/gling(?=\/|$)/, '').replace(/\/$/, '');
  if (/^\/post\/[^/]+$/.test(path)) return 'post';
  const screens: Record<string, string> = {
    '': 'feed', '/meetups': 'meetups', '/compose': 'write', '/chat': 'chat',
    '/post': 'post', '/meetup-create': 'meetup-create', '/meetup-join': 'meetup-join',
    '/meetup-profile': 'meetup-profile', '/meetup-application': 'meetup-application',
    '/profile/inbox': 'inbox', '/profile/notifications': 'notification-settings',
    '/profile/promotions': 'promotions', '/profile/guidelines': 'guidelines',
    '/notifications': 'notifications', '/profile': 'profile',
    '/profile/membership': 'membership', '/profile/settings': 'settings',
  };
  return screens[path] ?? null;
}
