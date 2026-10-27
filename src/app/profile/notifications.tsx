import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView, Switch } from '@/components/analytics-controls';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, DeviceEventEmitter, Linking, Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ControlMotion } from '@/constants/design-system';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { parseHashtags } from '@/lib/hashtags';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES, TAGS } from '@/lib/mock';
import { loadNotificationPreferences, NOTIFICATION_PREFERENCES_CHANGED, NOTIFICATION_SETTING_GROUPS, saveNotificationPreferences, settingPatch, settingState, type NotificationPreferences } from '@/lib/notification-preferences';
import { pushConfigured, pushPermissionGranted, pushSupported, registerPushDevice, unregisterPushDevice } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

export default function NotificationSettingsScreen() {

  const { isAuthLoading, isAuthed, me } = useAuth();
  if (isAuthLoading) return <GlingLoader style={styles.loading} />;
  if (!isAuthed) return <Redirect href="/profile" />;
  return <NotificationSettings key={me.id} userId={me.id} cityName={CITIES.find(city => city.id === me.cityId)?.name ?? '선호 지역'} />;
}

function NotificationSettings({ userId, cityName }: { userId: string; cityName: string }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
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
          play('warning');
          Alert.alert(tr("휴대폰 알림이 꺼져 있어요"), tr("기기 설정에서 글링 알림을 허용한 뒤 다시 켜주세요."), [
            { text: tr("닫기"), style: 'cancel' }, { text: tr("기기 설정 열기"), onPress: () => void Linking.openSettings() },
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
      play('selection');
    } catch {
      if (active.current) {
        play('warning');
        setSaveError(true);
        if (pushSupported) Alert.alert(tr("알림 설정을 저장하지 못했어요"), tr("연결 상태를 확인하고 다시 시도해 주세요."));
      }
    } finally { saving.current = false; if (active.current) setBusy(false); }
  };
  const parsedHashtags = parseHashtags(hashtags, 21);
  const invalidHashtags = parsedHashtags.length > 20 || parsedHashtags.some(tag => [...tag].length > 50);
  const interestsChanged = preferences && (JSON.stringify(tagIds) !== JSON.stringify(preferences.interest_tag_ids)
    || JSON.stringify(parsedHashtags) !== JSON.stringify(preferences.interest_hashtags));
  if (!preferences) return <View style={styles.loading}>{error ? <>
    <ThemedText>{tr("알림 설정을 불러오지 못했어요.")}</ThemedText>
    <Pressable analyticsId="app_profile_notifications.pressable.1" accessibilityRole="button" style={styles.button} onPress={() => { play('selection'); void load(); }}><ThemedText themeColor="accent">{tr("다시 시도")}</ThemedText></Pressable>
  </> : <GlingLoader color={theme.accent} />}</View>;
  return <SafeAreaView key={fontScale} style={styles.container} edges={['bottom']}>
    <ScrollView analyticsId="app_profile_notifications.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <ThemedText type="small" themeColor="textSecondary">{tr("종류마다 앱 알림 목록과 휴대폰 푸시를 따로 켜고 끌 수 있어요.")}</ThemedText>
      {saveError && <ThemedText accessibilityRole="alert" type="small" themeColor="accent">{tr("설정을 저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.")}</ThemedText>}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ToggleRow label={tr("휴대폰 푸시 알림")} value={preferences.push_enabled} onChange={value => void save({ push_enabled: value })} disabled={busy || (!pushConfigured && !preferences.push_enabled)} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>{!pushSupported ? tr("휴대폰 앱에서 푸시 알림을 켤 수 있어요.")
          : !pushConfigured ? tr("휴대폰 알림 연결을 준비하고 있어요.")
          : preferences.push_enabled && !permission ? tr("기기 설정에서 글링 알림이 꺼져 있어요.") : tr("앱을 닫아도 선택한 소식을 받을 수 있어요.")}</ThemedText>
        {pushSupported && <Pressable analyticsId="app_profile_notifications.pressable.2" accessibilityRole="button" style={styles.button} onPress={() => { play('selection'); void Linking.openSettings(); }}><ThemedText type="smallBold" themeColor="accent">{tr("기기 알림 설정")}</ThemedText></Pressable>}
      </View>
      {NOTIFICATION_SETTING_GROUPS.map(group => <View key={group.id} style={styles.group}>
        <View style={styles.groupHead}>
          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.label}>{group.id === 'mine' ? tr("나한테 온 것") : group.id === 'city' ? tr("{0} 소식", tr(cityName)) : tr("계정")}</ThemedText>
        </View>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          {group.rows.map(row => {
            const state = settingState(preferences, row);
            const description = row.id === 'interests' && preferences.interest_hashtags.length ? preferences.interest_hashtags.map(tag => `#${tag}`).join(' ') : row.description && tr(row.description);
            return <CategoryRow key={row.id} label={tr(row.label)} description={description || undefined} app={state.app} push={state.push} pushDisabled={state.pushDisabled} locked={!!row.locked} disabled={busy}
              onApp={value => void save(settingPatch(preferences, row, 'app', value))} onPush={value => void save(settingPatch(preferences, row, 'push', value))} />;
          })}
        </View>
      </View>)}
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">{tr("미리보기")}</ThemedText>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ToggleRow label={tr("잠금화면에 메시지 내용 보이기")} value={preferences.message_preview ?? false} onChange={value => void save({ message_preview: value })} disabled={busy} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>{preferences.message_preview
          ? tr("잠금 화면에 보낸 사람과 짧은 메시지가 표시돼요. 사진은 사진 안내만 보여요.")
          : tr("보낸 사람과 내용 없이 “메시지가 도착했어요.”만 표시돼요.")}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>{tr("변경 후 발송되는 푸시부터 적용돼요.")}</ThemedText>
      </View>
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">{tr("관심 태그")}</ThemedText>
      <View style={styles.tags}>{TAGS.map(tag => <Pressable analyticsId="app_profile_notifications.pressable.3" key={tag.id} accessibilityRole="checkbox" accessibilityState={{ checked: tagIds.includes(tag.id), disabled: busy }}
        aria-checked={tagIds.includes(tag.id)}
        disabled={busy} onPress={() => { play('selection'); setTagIds(current => current.includes(tag.id) ? current.filter(id => id !== tag.id) : [...current, tag.id].sort((a, b) => a - b)); }}
        style={({ pressed }) => [styles.tag, Depth.control, { backgroundColor: tagIds.includes(tag.id) ? theme.accent : theme.backgroundElement, borderBottomColor: tagIds.includes(tag.id) ? theme.accentDepth : theme.line, borderBottomWidth: 3, }]}>
        <ThemedText type="smallBold" style={{ color: tagIds.includes(tag.id) ? theme.accentInk : theme.textSecondary }}>{tr(tag.label)}</ThemedText>
      </Pressable>)}</View>
      <TextInput accessibilityLabel={tr("관심 해시태그")} value={hashtags} onChangeText={setHashtags} editable={!busy}
        placeholder={tr("#러닝 #맛집 #워홀")} placeholderTextColor={theme.textSecondary} maxLength={1000} autoCapitalize="none" autoCorrect={false}
        style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
      <ThemedText type="small" themeColor="textSecondary">{tr("카테고리나 해시태그를 골라주세요. 해시태그는 최대 20개까지, 공백으로 나눠 적을 수 있어요.")}</ThemedText>
      {invalidHashtags && <ThemedText accessibilityRole="alert" type="small" themeColor="accent">{tr("해시태그는 20개까지, 각각 50자 이내로 적어주세요.")}</ThemedText>}
      <Pressable analyticsId="app_profile_notifications.pressable.4" accessibilityRole="button" disabled={busy || !interestsChanged || invalidHashtags} accessibilityState={{ disabled: busy || !interestsChanged || invalidHashtags, busy }}
        aria-busy={busy}
        style={({ pressed }) => [styles.save, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: busy || !interestsChanged || invalidHashtags ? 0.45 : 1, }]}
        onPress={() => { play('selection'); void save({ interest_tag_ids: tagIds, interest_hashtags: parsedHashtags }); }}>
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("관심 태그 저장")}</ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">{tr("안전·계정 이용에 꼭 필요한 안내는 앱의 알림 목록에 남습니다.")}</ThemedText>
    </ScrollView>
  </SafeAreaView>;
}

// One category row: 앱 controls the in-app list (and push), 푸시 only the phone alert. Locked rows stay on.
function CategoryRow({ label, description, app, push, pushDisabled, locked, disabled, onApp, onPush }: { label: string; description?: string; app: boolean; push: boolean; pushDisabled: boolean; locked: boolean; disabled: boolean; onApp: (next: boolean) => void; onPush: (next: boolean) => void }) {
  const { tr } = useLanguage();
  return <View style={styles.row}>
    <View style={styles.label}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {description && <ThemedText type="small" themeColor="textSecondary">{description}</ThemedText>}
    </View>
    <Pill text={tr("앱")} label={tr("{0} 앱 알림", label)} value={app} disabled={disabled || locked} locked={locked} onChange={onApp} />
    <Pill text={tr("푸시")} label={tr("{0} 푸시 알림", label)} value={push} disabled={disabled || pushDisabled} locked={locked} onChange={onPush} />
  </View>;
}

function Pill({ text, label, value, disabled, locked, onChange }: { text: string; label: string; value: boolean; disabled: boolean; locked: boolean; onChange: (next: boolean) => void }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <Pressable analyticsId="app_profile_notifications.pressable.5" accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} aria-checked={value}
    disabled={disabled} hitSlop={{ top: 8, bottom: 8 }} onPress={() => { play('selection'); onChange(!value); }}
    style={({ pressed }) => [styles.pill, { backgroundColor: value ? theme.accent : theme.backgroundSelected,
      opacity: locked ? 0.55 : disabled ? ControlMotion.disabledOpacity : pressed ? ControlMotion.pressedOpacity : 1 }]}>
    <ThemedText type="smallBold" style={{ color: value ? theme.accentInk : theme.textSecondary }}>{text}</ThemedText>
  </Pressable>;
}

function ToggleRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (next: boolean) => void; disabled: boolean }) {

  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <View style={styles.row}>
    <ThemedText style={styles.label}>{label}</ThemedText>
    <Switch analyticsId="app_profile_notifications.switch.1" accessibilityLabel={label} hitSlop={{ top: 8, bottom: 8 }} style={styles.switch} value={value} disabled={disabled} onValueChange={next => { play('selection'); onChange(next); }}
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
  switch: { minHeight: Platform.OS === 'web' ? 44 : undefined, minWidth: 44 },
  label: { flex: 1, minWidth: 0 }, note: { paddingBottom: Spacing.two }, button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  group: { gap: Spacing.two }, groupHead: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingHorizontal: Spacing.three },
  pill: { width: 44, minHeight: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, tag: { minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: Spacing.three, fontSize: 16 },
  save: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: Spacing.two },
});
