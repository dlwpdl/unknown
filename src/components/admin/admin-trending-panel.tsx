import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { loadAdminTrending, saveAdminTrending } from '@/lib/admin-data';
import { trendingConfigPatch, type AdminTrendingConfig, type AdminTrendingState } from '@/lib/admin-trending';
import { count } from '@/i18n/ko';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { AdminButton, AdminCard, AdminInfo, AdminPill } from './admin-ui';

// 값을 바꾸면 곧바로 "지금 기준이면 이 글이 나갑니다"가 다시 계산된다.
// 미리보기가 없으면 운영자는 감으로 숫자를 만지게 된다.
type NumberField = { key: keyof AdminTrendingConfig; label: string; hint: string };
const GROUPS: { title: string; fields: NumberField[] }[] = [
  { title: '점수 가중치', fields: [
    { key: 'like_weight', label: '공감 가중치', hint: '' },
    { key: 'comment_weight', label: '댓글 가중치', hint: '' },
    { key: 'view_weight', label: '로그인 조회 가중치', hint: '로그인 조회: 회원이 연 횟수예요.' },
    { key: 'anon_view_weight', label: '비로그인 조회 가중치', hint: '비로그인 조회: 둘러보기만 한 열람이라 조작에 약해요. 낮게 두세요.' },
  ] },
  { title: '시간', fields: [
    { key: 'window_hours', label: '집계 구간(시간)', hint: '집계 구간: 이 시간 안에 생긴 조회·공감·댓글만 세요. 누적 조회수는 점수에 들어가지 않아요.' },
    { key: 'repeat_after_hours', label: '재등장 대기(시간)', hint: '재등장 대기: 한 번 알린 글이 다시 후보가 되기까지 기다리는 시간이에요.' },
    { key: 'quiet_start_hour', label: '조용한 시간 시작', hint: '조용한 시간: 0~23시로 적어요. 시작과 끝이 같으면 항상 보내요.' },
    { key: 'quiet_end_hour', label: '조용한 시간 끝', hint: '' },
  ] },
  { title: '발송 한도', fields: [
    { key: 'min_score', label: '최소 점수', hint: '최소 점수: 이 점수 아래면 아무것도 보내지 않아요.' },
    { key: 'max_per_city_per_day', label: '도시별 하루 최대 발송', hint: '' },
  ] },
];
const NUMBERS = GROUPS.flatMap(group => group.fields);
const cityName = (id: string) => CITIES.find(city => city.id === id)?.name ?? '도시 미확인';
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AdminTrendingPanel({ localPreview }: { localPreview?: boolean }) {
  const { play } = useInteractionFeedback();
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
      Alert.alert('설정을 저장하지 못했어요.', '값의 범위와 권한을 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const saveNumbers = () => {
    if (!state) return;
    const result = trendingConfigPatch(draft, state.config);
    if ('invalid' in result) {
      const field = NUMBERS.find(({ key }) => key === result.invalid);
      return Alert.alert('숫자를 확인해 주세요.', `${field?.label ?? result.invalid} 값이 올바르지 않아요.`);
    }
    if (Object.keys(result.patch).length === 0) return;
    void save(result.patch);
  };

  if (localPreview) return <Note text="로컬 미리보기에서는 발송 설정을 불러오지 않아요." />;
  if (failed) return <Note text="설정을 불러오지 못했어요. 관리자 권한과 연결을 확인해 주세요." />;
  if (!state) return <ActivityIndicator color={Colors.admin.accent} style={{ paddingVertical: Spacing.five }} accessibilityLabel="설정 불러오는 중" />;

  const { config, quietNow, preview, recent } = state;
  const wouldSend = preview.filter((row) => row.score >= config.min_score);
  const peak = Math.max(config.min_score, ...preview.map(row => row.score), 1);
  const statusLabel = !config.enabled ? '꺼짐' : quietNow ? '조용한 시간' : '정상';

  return (
    <View style={{ gap: Spacing.three }}>
      <AdminCard icon="i" tone={config.enabled ? 'success' : 'neutral'} title={config.enabled ? '발송 켜짐' : '발송 꺼짐'}
        info={`15분마다 도시별로 최근 ${config.window_hours}시간 안에 반응이 가장 많은 글 하나를 골라 보내요. 누적 조회수는 점수에 들어가지 않아요.`}
        action={<View style={styles.inline}>
          <AdminPill label={statusLabel} tone={!config.enabled ? 'neutral' : quietNow ? 'warning' : 'success'} />
          <Switch value={config.enabled} disabled={busy} accessibilityLabel="뜨는 글 알림 발송" accessibilityState={{ checked: config.enabled, disabled: busy }}
            onValueChange={(enabled) => { play(enabled ? 'selection' : 'warning'); void save({ enabled }); }} trackColor={{ true: Colors.admin.accent }} />
        </View>}>
        <ThemedText type="small" style={styles.muted}>
          {quietNow ? '지금은 조용한 시간이라 보내지 않아요.' : `최근 ${config.window_hours}시간 반응 기준 · ${config.min_score}점 이상 · 도시마다 한 편`}
        </ThemedText>
      </AdminCard>

      <View style={styles.columns}>
        <AdminCard icon="↗" tone="accent" title="지금 기준이면 나갈 글" count={`${wouldSend.length}개 도시`} style={styles.wide}
          info={`최근 ${config.window_hours}시간 기준 점수예요. ${config.min_score}점 이상만, 도시마다 한 편씩 나가요.`}>
          {preview.length === 0 && <ThemedText type="small" style={styles.muted}>후보 글이 없어요.</ThemedText>}
          {preview.map((row) => {
            const passes = row.score >= config.min_score;
            return <View key={row.post_id} style={[styles.candidate, !passes && styles.dim]}>
              <View style={styles.rowTop}>
                <ThemedText type="smallBold">{cityName(row.city_id)}</ThemedText>
                {!passes && <AdminPill label="기준 점수 미달" />}
                <View style={{ flex: 1 }} />
                <ThemedText type="smallBold" style={passes ? styles.accent : styles.muted}>{row.score}점</ThemedText>
              </View>
              <ThemedText type="small" numberOfLines={1}>{row.title}</ThemedText>
              <ThemedText type="small" style={styles.muted}>
                조회 {count(row.authed_views)}+{count(row.anon_views)} · 공감 {count(row.like_count)} · 댓글 {count(row.comment_count)}{passes ? '' : ` · 기준 ${config.min_score}점`}
              </ThemedText>
              <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.fill, { width: `${Math.min(100, row.score / peak * 100)}%` }, !passes && styles.fillMuted]} />
              </View>
            </View>;
          })}
          {preview.length > 0 && wouldSend.length === 0 && (
            <ThemedText type="small" style={styles.muted}>지금은 기준을 넘는 글이 없어 아무것도 보내지 않아요.</ThemedText>
          )}
        </AdminCard>

        <AdminCard icon="⚙" tone="navy" title="발송 기준" style={styles.side}
          action={<AdminButton kind="primary" label="저장" accessibilityLabel="발송 기준 저장" onPress={saveNumbers} disabled={busy} />}>
          {GROUPS.map(group => <View key={group.title} style={styles.group}>
            <View style={styles.inline}>
              <ThemedText type="smallBold" style={styles.muted}>{group.title}</ThemedText>
              {group.fields.some(field => field.hint) && <AdminInfo label={`${group.title} 설명`} text={group.fields.map(field => field.hint).filter(Boolean)} />}
            </View>
            {group.fields.map(({ key, label }) => (
              <View key={key} style={styles.field}>
                <ThemedText type="small" style={{ flex: 1, minWidth: 0 }}>{label}</ThemedText>
                <TextInput
                  value={draft[key] ?? ''}
                  onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
                  inputMode="decimal"
                  accessibilityLabel={label}
                  editable={!busy}
                  onFocus={() => play('selection')}
                  style={styles.input}
                />
              </View>
            ))}
          </View>)}
        </AdminCard>
      </View>

      <AdminCard icon="✓" tone="success" title="최근 발송" count={recent.length}>
        {recent.length === 0 ? <ThemedText type="small" style={styles.muted}>아직 보낸 알림이 없어요.</ThemedText> : <View>
          <View style={[styles.tableRow, styles.tableHead]}>
            {['도시', '글', '점수', '받은 사람', '시각'].map((label, index) => <ThemedText key={label} type="small" style={[styles.muted, index === 1 ? styles.titleCell : styles.cell]}>{label}</ThemedText>)}
          </View>
          {recent.map((row) => (
            <View key={`${row.postId}:${row.sentAt}`} style={styles.tableRow}>
              <ThemedText type="smallBold" style={styles.cell}>{cityName(row.cityId)}</ThemedText>
              <ThemedText type="small" numberOfLines={1} style={styles.titleCell}>{row.title}</ThemedText>
              <ThemedText type="small" style={styles.cell}>{row.score}</ThemedText>
              <ThemedText type="small" style={styles.cell}>{count(row.recipients)}명</ThemedText>
              <ThemedText type="small" style={[styles.cell, styles.muted]}>{time(row.sentAt)}</ThemedText>
            </View>
          ))}
        </View>}
      </AdminCard>
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View style={styles.note}>
      <ThemedText type="small" style={styles.muted}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, alignItems: 'flex-start' },
  wide: { flexBasis: 420, flexGrow: 2 },
  side: { flexBasis: 300, flexGrow: 1 },
  candidate: { gap: 4, paddingBottom: Spacing.two, borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  dim: { opacity: 0.7 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  track: { height: 5, borderRadius: 3, backgroundColor: Colors.admin.backgroundElement, marginTop: 4 },
  fill: { height: 5, borderRadius: 3, backgroundColor: Colors.admin.accent },
  fillMuted: { backgroundColor: Colors.admin.textSecondary },
  group: { gap: Spacing.one },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { width: 96, minHeight: 44, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, color: Colors.admin.text, backgroundColor: Colors.admin.card, textAlign: 'right', fontVariant: ['tabular-nums'] },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  tableHead: { minHeight: 32 },
  cell: { flexBasis: 72, flexShrink: 0 },
  titleCell: { flex: 1, minWidth: 0 },
  note: { alignItems: 'center', padding: Spacing.four, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 12, backgroundColor: Colors.admin.card },
  muted: { color: Colors.admin.textSecondary },
  accent: { color: Colors.admin.accent },
});
