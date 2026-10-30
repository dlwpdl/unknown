import type { BadgeLevels } from '@/lib/meetup-loyalty';
import type { Post } from '@/lib/types';

// Host loyalty tools (follow, encore, notices, badges, roster) are mobile-only, like meetup reviews;
// importing the native file would pull private meetup RPC names into the public web export.
export function useMeetupBadges(_userIds: string[] | null, _postId?: string): Record<string, BadgeLevels> { return {}; }
export function MeetupBadgeChips(_props: { levels: Partial<BadgeLevels> | undefined }) { return null; }
export function MeetupFollowEncore(_props: { post: Post }) { return null; }
export function MeetupProfileLoyalty(_props: { postId: string; userId?: string }) { return null; }
export function MeetupPinnedNotice(_props: { postId: string }) { return null; }
export function MeetupLoyaltyTools(_props: { postId: string }) { return null; }
