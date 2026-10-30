import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { chillingSchedule } from '@/lib/chilling';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { loadWelcomeMeetups, meetupLabels, MEETUP_LABEL_TEXT, type WelcomeMeetups } from '@/lib/newcomer';
import { supabase } from '@/lib/supabase';

const confetti = [
  [-144, -250, '#F9C76C', -32], [-68, -310, '#CBB9FF', 18], [48, -290, '#F35CBB', 43], [142, -232, '#83D9E7', -18],
  [-158, -92, '#F35CBB', 28], [152, -82, '#F9C76C', -38], [-138, 92, '#83D9E7', 45], [132, 116, '#CBB9FF', 16],
  [-98, 244, '#F9C76C', -20], [20, 280, '#F35CBB', 35], [112, 235, '#83D9E7', -42], [-10, -350, '#F9C76C', 12],
] as const;

export function WelcomeMoment({ nickname, cityId, onContinue }: { nickname: string; cityId: string; onContinue: () => void }) {
  const { tr, locale } = useLanguage();
  const router = useRouter();
  const city = tr(CITIES.find(item => item.id === cityId)?.name ?? cityId);
  // No meetups (or a failed load) keeps the original greeting-only screen.
  const [meetups, setMeetups] = useState<WelcomeMeetups | null>(null);
  useEffect(() => {
    let active = true;
    loadWelcomeMeetups(supabase).then(value => { if (active) setMeetups(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const list = meetups && meetups.mode !== 'none' ? meetups : null;
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [burst] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [rise] = useState(() => new Animated.Value(reducedMotion ? 0 : 24));

  useEffect(() => {
    if (reducedMotion) return;
    Animated.parallel([
      Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, speed: 13, bounciness: 7, useNativeDriver: true }),
    ]).start();
  }, [burst, reducedMotion, rise]);

  return <SafeAreaView style={styles.screen}>
    <Image source={require('@/assets/brand/gling-night-splash-light.png')} resizeMode="cover" style={styles.light} />
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, list && styles.contentTop]} showsVerticalScrollIndicator={false}>
      {!reducedMotion && confetti.map(([x, y, color, angle], index) => <Animated.View key={index} pointerEvents="none" style={[styles.confetti, list && styles.confettiTop, {
        backgroundColor: color,
        opacity: burst.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 0.75, 0] }),
        transform: [
          { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
          // With meetups below, the burst stays above the list.
          { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, list ? Math.min(y, 0) * 0.55 : y] }) },
          { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${angle}deg`] }) },
        ],
      }]} />)}
      <Animated.View style={{ alignItems: 'center', transform: [{ translateY: rise }] }}>
        <Animated.View style={{ transform: reducedMotion ? undefined : [{ scale: burst.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0.72, 1.08, 1] }) }] }}>
          <Image source={require('@/assets/brand/gling-night-wordmark.png')} resizeMode="contain" style={[styles.mark, list && styles.markSmall]} />
        </Animated.View>
        <ThemedText accessibilityRole="header" style={styles.title}>{tr('{0}님, 반가워요!', nickname)}</ThemedText>
        <ThemedText style={styles.subtitle}>{tr("페스티벌도, 동네의 작은 한잔도. 마음 맞는 사람을 여기서 만나요.")}</ThemedText>
      </Animated.View>
      {list && <View style={styles.meetups}>
        {list.mode === 'welcome' ? <View style={styles.sectionCopy}>
          <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{tr('처음 가도 괜찮은 이번 주 {0} 모임', city)}</ThemedText>
          <ThemedText style={styles.sectionNote}>{tr('호스트가 처음 오는 분도 반긴다고 한 모임이에요.')}</ThemedText>
        </View> : <ThemedText style={styles.sectionNote}>{tr('아직 처음 와도 되는 {0} 모임이 없어요. 이번 주 새로 열린 모임을 먼저 보여 드릴게요.', city)}</ThemedText>}
        {list.posts.map(post => {
          const room = post.room!;
          const labels = meetupLabels(post).map(label => tr(MEETUP_LABEL_TEXT[label]));
          const people = tr(room.capacity ? '{0} / {1}명' : '{0}명', room.memberCount, room.capacity);
          const schedule = chillingSchedule(room, locale);
          return <Pressable key={post.id} analyticsId="onboarding.welcome.meetup" accessibilityRole="button"
            accessibilityLabel={[...labels, post.title, schedule, city, people].join(', ')}
            onPress={() => { play('selection'); onContinue(); router.push({ pathname: '/post/[id]', params: { id: post.id } }); }}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.82 : 1 }]}>
            <View style={styles.rowCopy}>
              <ThemedText style={styles.rowTitle} numberOfLines={2}>{post.title}</ThemedText>
              <ThemedText style={styles.rowMeta}>{`${schedule} · ${city}`}</ThemedText>
              <ThemedText style={styles.rowMeta}>{[people, ...labels].join(' · ')}</ThemedText>
            </View>
            <ThemedText style={styles.chevron}>›</ThemedText>
          </Pressable>;
        })}
      </View>}
    </ScrollView>
    <Pressable analyticsId="onboarding.welcome.start" accessibilityRole="button" onPress={() => { play('selection'); onContinue(); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }] }]}>
      <ThemedText type="smallBold" style={styles.buttonText}>{tr("글링 시작하기")}</ThemedText>
    </Pressable>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B12', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 28 },
  light: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  scroll: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  contentTop: { justifyContent: 'flex-start', paddingTop: 32 },
  confetti: { position: 'absolute', width: 11, height: 22, borderRadius: 3 },
  confettiTop: { top: 120 },
  mark: { width: 250, height: 110, marginBottom: 20 },
  markSmall: { width: 180, height: 80, marginBottom: 12 },
  title: { color: '#F6F3F0', fontSize: 27, lineHeight: 36, fontWeight: '800', textAlign: 'center', letterSpacing: -1 },
  subtitle: { color: '#D2CBDB', fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 12, maxWidth: 285 },
  meetups: { alignSelf: 'stretch', marginTop: 32, gap: 10 },
  sectionCopy: { gap: 4, marginBottom: 4 },
  sectionTitle: { color: '#F6F3F0', fontSize: 18, lineHeight: 26, fontWeight: '700' },
  sectionNote: { color: '#D2CBDB', fontSize: 14, lineHeight: 20 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: '#F6F3F0', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  rowMeta: { color: '#D2CBDB', fontSize: 13, lineHeight: 19 },
  chevron: { color: '#CBB9FF', fontSize: 22, lineHeight: 26 },
  button: { marginTop: 12, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: '#CBB9FF' },
  buttonText: { color: '#171123', fontSize: 16 },
});
