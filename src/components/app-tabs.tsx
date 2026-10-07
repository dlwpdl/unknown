import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Native selected-state motion stays quiet; the commit actions get stronger feedback elsewhere.
export default function AppTabs() {
  const { play } = useInteractionFeedback();
  const unreadCount = useUnreadCount('other');
  const chatCount = useUnreadCount('chat');
  const colors = useTheme();

  return (
    <NativeTabs
      screenListeners={({ route }) => ({ tabPress: () => play(route.name === 'compose' ? 'reaction' : 'selection') })}
      disableTransparentOnScrollEdge
      backgroundColor={Platform.OS === 'ios' ? undefined : colors.background}
      blurEffect={Platform.OS === 'ios' ? 'systemChromeMaterialDark' : undefined}
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
        {chatCount > 0 && <NativeTabs.Trigger.Badge>{chatCount > 99 ? '99+' : String(chatCount)}</NativeTabs.Trigger.Badge>}
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
