import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect, useState } from 'react';
import { DeviceEventEmitter, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadDailyQuota, POST_QUOTA_CHANGED_EVENT } from '@/lib/community-data';
import { INITIAL_QUOTA } from '@/lib/mock';
import { supabase } from '@/lib/supabase';

// 일력 종이탭: 종이색 배경 + 상단 헤어라인 + 활성 탭은 인주(빨강) 틴트.
// 아이콘은 SF Symbols(iOS) / Material(Android). 오늘=일력, 채팅=말풍선, 나=사람.
export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { isAuthed, me } = useAuth();
  const [quota, setQuota] = useState(INITIAL_QUOTA);

  useEffect(() => {
    if (!isAuthed) return;
    void loadDailyQuota(supabase).then(setQuota).catch(() => {});
    const subscription = DeviceEventEmitter.addListener(POST_QUOTA_CHANGED_EVENT, setQuota);
    return () => subscription.remove();
  }, [isAuthed, me.id]);

  return (
    <NativeTabs
      disableTransparentOnScrollEdge
      backgroundColor={colors.background}
      shadowColor={colors.line}
      tintColor={colors.accent}
      indicatorColor={colors.backgroundElement}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t.tabs.today}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'calendar', selected: 'calendar.circle.fill' }}
          md="today"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="compose">
        <NativeTabs.Trigger.Label>{t.feed.write}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/brand/gling-mark-light.png')}
          renderingMode="original"
        />
        <NativeTabs.Trigger.Badge>{t.feed.remaining(quota.used, quota.max)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>{t.tabs.chat}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }}
          md="forum"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>{t.tabs.profile}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          md="person"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
