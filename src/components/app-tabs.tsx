import { useLanguage } from '@/hooks/use-language';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useState } from 'react';
import { Platform } from 'react-native';
import { LIVE_ACCESSORY, LiveBubbleAccessory } from '@/components/live-bubble-bar';
import { useMineUp } from '@/components/live-bubbles';
import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Native selected-state motion stays quiet; the commit actions get stronger feedback elsewhere.
export default function AppTabs() {
  const { t, tr } = useLanguage();
  const business = useChatIdentity();
  const { play } = useInteractionFeedback();
  const unreadCount = useUnreadCount('other');
  const chatCount = useUnreadCount('chat');
  const colors = useTheme();
  const mineUp = useMineUp(), [onMap, setOnMap] = useState(false);

  return (
    <NativeTabs
      screenListeners={({ route }) => ({ tabPress: () => play('selection'), focus: () => setOnMap(route.name === 'discover') })}
      disableTransparentOnScrollEdge
      backgroundColor={Platform.OS === 'ios' ? undefined : colors.background}
      blurEffect={Platform.OS === 'ios' ? colors === Colors.dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight' : undefined}
      shadowColor={colors.line}
      tintColor={colors.accent}
      iconColor={{ default: colors.textSecondary, selected: colors.accent }}
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.accent, fontWeight: '600' } }}
      indicatorColor={colors.backgroundElement}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t.tabs.today}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md="home"
        />
      </NativeTabs.Trigger>

      {/* Acting as a business, the meetup tab becomes the business home (meetups stay personal-only). */}
      <NativeTabs.Trigger name="meetups">
        <NativeTabs.Trigger.Label>{business ? tr('내 가게') : t.tabs.meetups}</NativeTabs.Trigger.Label>
        {business ? <NativeTabs.Trigger.Icon sf="storefront" md="storefront" /> : <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="groups" />}
      </NativeTabs.Trigger>

      {/* 지도가 글쓰기 탭 자리로 (owner 2026-11-01 A안). 글쓰기는 오늘 화면의 떠 있는 버튼. */}
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Label>{t.tabs.map}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'map', selected: 'map.fill' }}
          md="map"
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

      {/* 옛 /compose 링크는 +native-intent가 오늘 화면 글쓰기로 바꾼다. */}
      <NativeTabs.Trigger name="compose" hidden />

      {/* 내 말풍선은 탭 바 바로 위에 (iOS 26+, owner 9148628c). 지도 탭에선 아래 카드가 같은 걸 보여 줘서 뺀다. */}
      {LIVE_ACCESSORY && mineUp && !onMap && <NativeTabs.BottomAccessory><LiveBubbleAccessory /></NativeTabs.BottomAccessory>}
    </NativeTabs>
  );
}
