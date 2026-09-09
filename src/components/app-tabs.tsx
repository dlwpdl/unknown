import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { t } from '@/i18n/ko';
import { useUnreadCount } from '@/hooks/use-unread-count';

// 일력 종이탭: 종이색 배경 + 상단 헤어라인 + 활성 탭은 인주(빨강) 틴트.
// 아이콘은 SF Symbols(iOS) / Material(Android), 선택 상태는 인주색으로 구분한다.
export default function AppTabs() {
  const unreadCount = useUnreadCount();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

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
          sf="calendar"
          md="today"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="meetups">
        <NativeTabs.Trigger.Label>{t.tabs.meetups}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="groups" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="compose">
        <NativeTabs.Trigger.Label>{t.tabs.write}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf="square.and.pencil"
          md="edit_square"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>{t.tabs.chat}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }}
          md="forum"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Label>{t.tabs.notifications}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bell', selected: 'bell.fill' }}
          md="notifications"
        />
        {unreadCount > 0 && <NativeTabs.Trigger.Badge>{unreadCount > 99 ? '99+' : String(unreadCount)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
