import { Redirect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, DeviceEventEmitter, Linking, Pressable, ScrollView, StyleSheet, Switch, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { parseHashtags } from '@/lib/hashtags';
import { CITIES, TAGS } from '@/lib/mock';
import { loadNotificationPreferences, NOTIFICATION_CATEGORIES, NOTIFICATION_PREFERENCES_CHANGED, saveNotificationPreferences, type NotificationPreferences } from '@/lib/notification-preferences';
import { pushConfigured, pushPermissionGranted, pushSupported, registerPushDevice, unregisterPushDevice } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

export default function NotificationSettingsScreen() {
  const { isAuthLoading, isAuthed, me } = useAuth();
  if (isAuthLoading) return <ActivityIndicator style={styles.loading} />;
  if (!isAuthed) return <Redirect href="/profile" />;
  return <NotificationSettings key={me.id} userId={me.id} cityName={CITIES.find(city => city.id === me.cityId)?.name ?? '선호 지역'} />;
}

function NotificationSettings({ userId, cityName }: { userId: string; cityName: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [hashtags, setHashtags] = useState('');
  const active = useRef(true);
  const saving = useRef(false);
  const load = useCallback(() => loadNotificationPreferences(supabase).then(next => {
      if (!active.current) return;
      setError(false);
      setPreferences(next); setTagIds(next.interest_tag_ids); setHashtags(next.interest_hashtags.map(tag => `#${tag}`).join(' '));
    }).catch(() => { if (active.current) setError(true); }), []);
  useEffect(() => {
    active.current = true;
    void load();
    const refreshPermission = () => { void pushPermissionGranted().then(value => { if (active.current) setPermission(value); }).catch(() => {}); };
    refreshPermission();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshPermission(); });
    return () => { active.current = false; subscription.remove(); };
  }, [load]);

  const save = async (patch: Partial<NotificationPreferences>) => {
    if (!preferences || saving.current) return;
    saving.current = true; setBusy(true); setSaveError(false);
    try {
      if (patch.push_enabled) {
        const granted = await registerPushDevice(supabase, userId, true);
        if (!active.current) return;
        setPermission(granted);
        if (!granted) {
          Alert.alert('휴대폰 알림이 꺼져 있어요', '기기 설정에서 글링 알림을 허용한 뒤 다시 켜주세요.', [
            { text: '닫기', style: 'cancel' }, { text: '기기 설정 열기', onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
      }
      const next = await saveNotificationPreferences(supabase, patch);
      if (!active.current) return;
      setPreferences(next);
      if (patch.interest_tag_ids || patch.interest_hashtags) {
        setTagIds(next.interest_tag_ids);
        setHashtags(next.interest_hashtags.map(tag => `#${tag}`).join(' '));
      }
      DeviceEventEmitter.emit(NOTIFICATION_PREFERENCES_CHANGED, { userId, preferences: next });
      if (patch.push_enabled === false) await unregisterPushDevice(supabase, userId).catch(() => {});
    } catch {
      if (active.current) {
        setSaveError(true);
        if (pushSupported) Alert.alert('알림 설정을 저장하지 못했어요', '연결 상태를 확인하고 다시 시도해 주세요.');
      }
    } finally { saving.current = false; if (active.current) setBusy(false); }
  };
  const parsedHashtags = parseHashtags(hashtags, 21);
  const invalidHashtags = parsedHashtags.length > 20 || parsedHashtags.some(tag => [...tag].length > 50);
  const interestsChanged = preferences && (JSON.stringify(tagIds) !== JSON.stringify(preferences.interest_tag_ids)
    || JSON.stringify(parsedHashtags) !== JSON.stringify(preferences.interest_hashtags));
  if (!preferences) return <View style={styles.loading}>{error ? <>
    <ThemedText>알림 설정을 불러오지 못했어요.</ThemedText>
    <Pressable accessibilityRole="button" style={styles.button} onPress={() => void load()}><ThemedText themeColor="accent">다시 시도</ThemedText></Pressable>
  </> : <ActivityIndicator color={theme.accent} />}</View>;
  return <SafeAreaView key={fontScale} style={styles.container} edges={['bottom']}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <ThemedText type="small" themeColor="textSecondary">받고 싶은 소식만 골라주세요. 아래 설정은 앱의 알림 목록에도 적용돼요.</ThemedText>
      {saveError && <ThemedText accessibilityRole="alert" type="small" themeColor="accent">설정을 저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.</ThemedText>}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ToggleRow label="휴대폰 푸시 알림" value={preferences.push_enabled} onChange={value => void save({ push_enabled: value })} disabled={busy || (!pushConfigured && !preferences.push_enabled)} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>{!pushSupported ? '휴대폰 앱에서 푸시 알림을 켤 수 있어요.'
          : !pushConfigured ? '휴대폰 알림 연결을 준비하고 있어요.'
          : preferences.push_enabled && !permission ? '기기 설정에서 글링 알림이 꺼져 있어요.' : '앱을 닫아도 선택한 소식을 받을 수 있어요.'}</ThemedText>
        {pushSupported && <Pressable accessibilityRole="button" style={styles.button} onPress={() => void Linking.openSettings()}><ThemedText type="smallBold" themeColor="accent">기기 알림 설정</ThemedText></Pressable>}
      </View>
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">나의 활동</ThemedText>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {NOTIFICATION_CATEGORIES.slice(0, 6).map(item => <ToggleRow key={item.key} label={item.label} value={preferences[item.key]} onChange={value => void save({ [item.key]: value })} disabled={busy} />)}
      </View>
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">관심사와 우리 동네</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{cityName}에 올라오는 새 글과 모임을 알려드려요. 이사 후 선호 지역을 바꾸면 알림 지역도 함께 바뀝니다.</ThemedText>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {NOTIFICATION_CATEGORIES.slice(6).map(item => <ToggleRow key={item.key} label={item.label} value={preferences[item.key]} onChange={value => void save({ [item.key]: value })} disabled={busy} />)}
      </View>
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">관심 태그</ThemedText>
      <View style={styles.tags}>{TAGS.map(tag => <Pressable key={tag.id} accessibilityRole="checkbox" accessibilityState={{ checked: tagIds.includes(tag.id), disabled: busy }}
        aria-checked={tagIds.includes(tag.id)}
        disabled={busy} onPress={() => setTagIds(current => current.includes(tag.id) ? current.filter(id => id !== tag.id) : [...current, tag.id].sort((a, b) => a - b))}
        style={[styles.tag, { backgroundColor: tagIds.includes(tag.id) ? theme.accent : theme.backgroundElement }]}>
        <ThemedText type="smallBold" style={{ color: tagIds.includes(tag.id) ? theme.accentInk : theme.textSecondary }}>{tag.label}</ThemedText>
      </Pressable>)}</View>
      <TextInput accessibilityLabel="관심 해시태그" value={hashtags} onChangeText={setHashtags} editable={!busy}
        placeholder="#러닝 #맛집 #워홀" placeholderTextColor={theme.textSecondary} maxLength={1000} autoCapitalize="none" autoCorrect={false}
        style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
      <ThemedText type="small" themeColor="textSecondary">카테고리나 해시태그를 골라주세요. 해시태그는 최대 20개까지, 공백으로 나눠 적을 수 있어요.</ThemedText>
      {invalidHashtags && <ThemedText accessibilityRole="alert" type="small" themeColor="accent">해시태그는 20개까지, 각각 50자 이내로 적어주세요.</ThemedText>}
      <Pressable accessibilityRole="button" disabled={busy || !interestsChanged || invalidHashtags} accessibilityState={{ disabled: busy || !interestsChanged || invalidHashtags, busy }}
        aria-busy={busy}
        style={[styles.save, { backgroundColor: theme.accent, opacity: busy || !interestsChanged || invalidHashtags ? 0.45 : 1 }]}
        onPress={() => void save({ interest_tag_ids: tagIds, interest_hashtags: parsedHashtags })}>
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>관심 태그 저장</ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">안전·계정 이용에 꼭 필요한 안내는 앱의 알림 목록에 남습니다.</ThemedText>
    </ScrollView>
  </SafeAreaView>;
}

function ToggleRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (next: boolean) => void; disabled: boolean }) {
  const theme = useTheme();
  return <View style={styles.row}>
    <ThemedText style={styles.label}>{label}</ThemedText>
    <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange}
      {...(!pushSupported ? { activeThumbColor: theme.accentInk } : {})}
      thumbColor={theme.accentInk}
      trackColor={{ false: theme.line, true: theme.accent }} ios_backgroundColor={theme.line} />
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 56, paddingVertical: Spacing.two },
  label: { flex: 1 }, note: { paddingBottom: Spacing.two }, button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, tag: { minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: Spacing.three, fontSize: 16 },
  save: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: Spacing.two },
});
