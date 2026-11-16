// What a new member says brought them here. Kept apart from ACQUISITION_SOURCES, which are the paths the app detects from links and installs.
export const SIGNUP_SOURCES = ['instagram', 'threads', 'naver', 'friend', 'search', 'kakao', 'other'] as const;
export type SignupSource = typeof SIGNUP_SOURCES[number];
