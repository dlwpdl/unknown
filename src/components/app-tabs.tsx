import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { t } from '@/i18n/ko';

// 일력 종이탭: 종이색 배경 + 상단 헤어라인 + 활성 탭은 인주(빨강) 틴트.
// 아이콘은 SF Symbols(iOS) / Material(Android). 오늘=일력, 채팅=말풍선, 나=사람.
export default function AppTabs() {
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
          sf={{ default: 'calendar', selected: 'calendar.circle.fill' }}
          md="today"
        />
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
