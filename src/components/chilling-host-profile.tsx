import { Pressable } from '@/components/analytics-controls';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { ChillingEventSchedule } from '@/components/chilling-event';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { getChillingError, loadChillingHostProfile, type ChillingProfile } from '@/lib/chilling-data';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export function ChillingHostProfile({ post }: { post: Post }) {
  const { isAuthed, promptLogin } = useAuth(), hidden = useContentVisibility(), theme = useTheme();
  const [profile, setProfile] = useState<ChillingProfile | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  if (!post.room || hidden('post', post.id, post.author.id)) return null;
  const load = async () => {
    if (!isAuthed) return promptLogin('호스트 모임 프로필을 보려면 로그인해 주세요.');
    if (loading) return;
    setLoading(true); setError('');
    try { const value = await loadChillingHostProfile(supabase, post.id); setProfile(value); if (!value) setError('지금은 프로필을 볼 수 없어요.'); }
    catch (e) { setError(getChillingError(e)); }
    finally { setLoading(false); }
  };
  return <View style={{ padding: Spacing.three, gap: Spacing.three }}>
    <ChillingEventSchedule room={post.room} />
    {!!post.room.eventKind && <>
      <Pressable analyticsId="components_chilling-host-profile.pressable.1" onPress={() => profile ? setProfile(null) : void load()} accessibilityRole="button" accessibilityState={{ expanded: !!profile, busy: loading }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <ThemedText type="smallBold" themeColor="accent">{post.author.nickname}님의 모임 프로필 {profile ? '접기' : '보기'}</ThemedText>
      </Pressable>
      {loading && <ActivityIndicator color={theme.accent} />}
      {profile && <ChillingProfileCard profile={profile} />}
      {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">정확한 집결 장소는 승인 후 모임 대화에서 안내해요.</ThemedText>
    </>}
  </View>;
}
