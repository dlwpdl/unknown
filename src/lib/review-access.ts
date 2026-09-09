import type { User } from '@supabase/supabase-js';

export function isReviewUser(user: Pick<User, 'app_metadata'> | null | undefined): boolean {
  return user?.app_metadata.provider === 'email'
    && user.app_metadata.review_access === true
    && user.app_metadata.role !== 'admin';
}
