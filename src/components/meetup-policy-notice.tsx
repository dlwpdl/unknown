import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, DeviceEventEmitter } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { meetupPolicyNotice, type MeetupPolicy, type MeetupPolicyMode } from '@/lib/meetup-policy';
import { supabase } from '@/lib/supabase';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';

export function MeetupPolicyNotice({ mode }: { mode: MeetupPolicyMode }) {
  const { me, isAuthed } = useAuth();
  const userId = isAuthed ? me.id : null;
  const [state, setState] = useState<{ userId: string; policy: MeetupPolicy | null } | null>(null);
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await supabase.rpc('get_meetup_policy');
        if (active) { setState({ userId, policy: result.error ? null : result.data }); setNow(Date.now()); }
      } catch { if (active) setState({ userId, policy: null }); }
    };
    void refresh();
    const listener = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    const changes = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void refresh());
    const timer = setInterval(() => { setNow(Date.now()); }, 30000);
    return () => { active = false; clearInterval(timer); listener.remove(); changes.remove(); };
  }, [userId]));
  if (!userId) return null;
  const message = state?.userId !== userId ? '이용 상태를 확인하고 있어요…'
    : state.policy ? meetupPolicyNotice(state.policy, mode, now) : '이용 상태를 확인하지 못했어요. 실제 제한 여부는 요청할 때 다시 확인해요. 신고·차단·나가기는 가능해요.';
  return message ? <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{message}</ThemedText> : null;
}
