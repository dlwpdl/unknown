import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { loadAdminTrending, saveAdminTrending } from '@/lib/admin-data';
import { trendingConfigPatch, type AdminTrendingConfig, type AdminTrendingState } from '@/lib/admin-trending';
import { supabase } from '@/lib/supabase';

// 값을 바꾸면 곧바로 "지금 기준이면 이 글이 나갑니다"가 다시 계산된다.
// 미리보기가 없으면 운영자는 감으로 숫자를 만지게 된다.
const NUMBERS: { key: keyof AdminTrendingConfig; label: string; hint: string }[] = [
  { key: 'view_weight', label: '로그인 조회 가중치', hint: '회원이 연 횟수' },
  { key: 'anon_view_weight', label: '비로그인 조회 가중치', hint: '둘러보기만 한 열람. 조작에 약하니 낮게 둔다' },
  { key: 'like_weight', label: '공감 가중치', hint: '' },
  { key: 'comment_weight', label: '댓글 가중치', hint: '' },
  { key: 'half_life_hours', label: '반감기(시간)', hint: '이 시간이 지나면 점수가 절반' },
  { key: 'min_score', label: '최소 점수', hint: '이 아래면 아무것도 보내지 않는다' },
  { key: 'max_age_hours', label: '후보 최대 나이(시간)', hint: '' },
  { key: 'max_per_city_per_day', label: '도시별 하루 최대 발송', hint: '' },
  { key: 'quiet_start_hour', label: '조용한 시간 시작', hint: '0~23시' },
  { key: 'quiet_end_hour', label: '조용한 시간 끝', hint: '같은 값이면 항상 발송' },
];

export function AdminTrendingPanel({ localPreview }: { localPreview?: boolean }) {
  const [state, setState] = useState<AdminTrendingState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const apply = useCallback((next: AdminTrendingState) => {
    setState(next);
    setDraft(Object.fromEntries(NUMBERS.map(({ key }) => [key, String(next.config[key])])));
  }, []);

  useEffect(() => {
    if (localPreview) return;
    let active = true;
    loadAdminTrending(supabase)
      .then((next) => { if (active) apply(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [apply, localPreview]);

  const save = async (patch: Partial<AdminTrendingConfig>) => {
    if (localPreview || busy) return;
    setBusy(true);
    try {
      apply(await saveAdminTrending(supabase, patch));
    } catch {
      Alert.alert('설정을 저장하지 못했습니다.', '값의 범위와 권한을 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const saveNumbers = () => {
    if (!state) return;
    const result = trendingConfigPatch(draft, state.config);
    if ('invalid' in result) {
      const field = NUMBERS.find(({ key }) => key === result.invalid);
      return Alert.alert('숫자를 확인해주세요.', `${field?.label ?? result.invalid} 값이 올바르지 않습니다.`);
    }
    if (Object.keys(result.patch).length === 0) return;
    void save(result.patch);
  };

  if (localPreview) return <Note text="로컬 미리보기에서는 발송 설정을 불러오지 않습니다." />;
  if (failed) return <Note text="설정을 불러오지 못했습니다. 관리자 권한과 연결을 확인해주세요." />;
  if (!state) return <ActivityIndicator color={Colors.light.accent} style={{ paddingVertical: Spacing.five }} accessibilityLabel="설정 불러오는 중" />;

  const { config, quietNow, preview, recent } = state;
  const wouldSend = preview.filter((row) => row.score >= config.min_score);

  return (
    <View style={{ gap: Spacing.four }}>
      <View style={styles.card}>
        <View style={styles.rowTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText type="smallBold">{config.enabled ? '발송 켜짐' : '발송 꺼짐'}</ThemedText>
            <ThemedText type="small" style={styles.muted}>
              15분마다 도시별로 가장 점수가 높은 글 하나를 고릅니다. 한 글은 한 번만 알립니다.
              {quietNow ? ' 지금은 조용한 시간이라 보내지 않습니다.' : ''}
            </ThemedText>
          </View>
          <Action label={config.enabled ? '끄기' : '켜기'} onPress={() => void save({ enabled: !config.enabled })} disabled={busy} danger={config.enabled} />
        </View>
      </View>

      <View style={{ gap: Spacing.two }}>
        {NUMBERS.map(({ key, label, hint }) => (
          <View key={key} style={styles.field}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold">{label}</ThemedText>
              {!!hint && <ThemedText type="small" style={styles.muted}>{hint}</ThemedText>}
            </View>
            <TextInput
              value={draft[key] ?? ''}
              onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
              inputMode="decimal"
              accessibilityLabel={label}
              editable={!busy}
              style={styles.input}
            />
          </View>
        ))}
        <Action label="값 저장" onPress={saveNumbers} disabled={busy} />
      </View>

      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">지금 기준이면 나갈 글</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          최소 점수 {config.min_score} 이상만 발송됩니다. 도시마다 한 편씩 나갑니다.
        </ThemedText>
        {preview.length === 0 && <Note text="후보 글이 없습니다." />}
        {preview.map((row) => (
          <View key={row.post_id} style={[styles.card, row.score >= config.min_score && styles.cardActive]}>
            <View style={styles.rowTop}>
              <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>{row.title}</ThemedText>
              <ThemedText type="smallBold" style={row.score >= config.min_score ? styles.urgent : styles.muted}>{row.score}</ThemedText>
            </View>
            <ThemedText type="small" style={styles.muted}>
              {row.city_id} · 조회 {row.authed_views}+{row.anon_views} · 공감 {row.like_count} · 댓글 {row.comment_count}
            </ThemedText>
          </View>
        ))}
        {preview.length > 0 && wouldSend.length === 0 && (
          <ThemedText type="small" style={styles.muted}>지금은 기준을 넘는 글이 없어 아무것도 보내지 않습니다.</ThemedText>
        )}
      </View>

      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">최근 발송</ThemedText>
        {recent.length === 0 && <Note text="아직 보낸 알림이 없습니다." />}
        {recent.map((row) => (
          <View key={row.postId} style={styles.card}>
            <ThemedText type="smallBold" numberOfLines={1}>{row.title}</ThemedText>
            <ThemedText type="small" style={styles.muted}>
              {row.cityId} · 점수 {row.score} · {row.recipients}명 · {new Date(row.sentAt).toLocaleString('ko-KR')}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function Action({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, opacity: disabled ? 0.5 : 1 }}>
      <ThemedText type="smallBold" style={danger ? styles.urgent : undefined}>{label}</ThemedText>
    </Pressable>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View style={[styles.card, { alignItems: 'center', paddingVertical: Spacing.four }]}>
      <ThemedText type="small" style={styles.muted}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, backgroundColor: Colors.light.card },
  cardActive: { borderColor: '#E8B8AE', backgroundColor: '#FDF6F4' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, backgroundColor: Colors.light.card },
  input: { flexBasis: 110, minHeight: 44, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, color: Colors.light.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
  muted: { color: Colors.light.textSecondary },
  urgent: { color: Colors.light.accent },
});
