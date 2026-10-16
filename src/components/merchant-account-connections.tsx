import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, AppState, Platform, StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  MERCHANT_ACCOUNT_ROLES, acceptMerchantAccountInvitation, cancelMerchantAccountInvitation, disconnectMerchantAccount,
  loadMerchantAccountConnections, loadMyMerchantConnections,
  type MyMerchantConnections, type MerchantAccountConnections, type MerchantAccountInvitation,
} from '@/lib/merchant-connections';
import { supabase } from '@/lib/supabase';

function AccountAction({ label, onPress, disabled, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId="merchant.connection.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [styles.action, { borderColor: theme.line, backgroundColor: primary ? theme.accent : theme.backgroundElement, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={primary ? { color: theme.background } : undefined}>{label}</ThemedText>
  </Pressable>;
}
async function confirmConnection(message: string) {
  if (Platform.OS === 'web') return window.confirm(message);
  return new Promise<boolean>(resolve => Alert.alert('업체 계정 확인', message, [
    { text: '취소', style: 'cancel', onPress: () => resolve(false) }, { text: '계속', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function MerchantAccountEntry() {
  const { me, isAuthed, isAdmin } = useAuth(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const [response, setResponse] = useState<MyMerchantConnections | null>(null), [busy, setBusy] = useState(false);
  const current = useRef(me.id), serial = useRef(0), opening = useRef(false);
  useLayoutEffect(() => { current.current = me.id; return () => { current.current = ''; }; }, [me.id]);
  useFocusEffect(useCallback(() => {
    let active = true;
    const check = async () => {
      const request = ++serial.current;
      try { const next = await loadMyMerchantConnections(supabase, me.id); if (active && request === serial.current) setResponse(next); }
      catch { if (active && request === serial.current) setResponse(null); }
    };
    if (isAuthed) void check();
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && isAuthed) void check(); });
    return () => { active = false; serial.current++; listener.remove(); };
  }, [isAuthed, me.id]));
  const data = response?.user_id === me.id ? response : null;
  if (!isAuthed || (!isAdmin && !data?.merchants.length && !data?.invitations.length)) return null;
  async function open() {
    if (opening.current) return;
    opening.current = true; setBusy(true); play('selection');
    const request = ++serial.current;
    try {
      const next = await loadMyMerchantConnections(supabase, me.id);
      if (current.current !== me.id || serial.current !== request) return;
      setResponse(next);
      if (next.merchants.length || next.invitations.length || isAdmin) router.push('/profile/merchant');
    } catch { if (current.current === me.id) { setResponse(null); if (isAdmin) router.push('/profile/merchant'); else play('warning'); } }
    finally { opening.current = false; if (current.current === me.id) setBusy(false); }
  }
  const invitationOnly = !data?.merchants.length && !!data?.invitations.length;
  return <Pressable analyticsId="app_profile_index.merchant" accessibilityRole="button" accessibilityLabel={invitationOnly ? '업체 계정 초대 확인' : '비즈니스 프로필 전환'} disabled={busy}
    accessibilityState={{ disabled: busy }} onPress={() => { void open(); }} style={({ pressed }) => [styles.entry, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, borderColor: theme.line }]}>
    <View style={{ flex: 1, gap: 4 }}><ThemedText type="smallBold">{invitationOnly ? '업체 계정 초대' : '비즈니스'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{busy ? '현재 연결 확인 중…' : invitationOnly ? '초대한 업체와 권한을 확인해 주세요.' : (data?.merchants.length ?? 0) + '개 업체 · 프로필 전환'}</ThemedText></View>
    <ThemedText themeColor="textSecondary">›</ThemedText>
  </Pressable>;
}

export function MerchantAccountInvitations({ refreshSignal = 0, onChanged }: { refreshSignal?: number; onChanged: () => void }) {
  const { me, isAuthed } = useAuth(), theme = useTheme(), { play } = useInteractionFeedback();
  const [response, setResponse] = useState<MyMerchantConnections | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(me.id), pending = useRef(false);
  useLayoutEffect(() => { current.current = me.id; return () => { current.current = ''; }; }, [me.id]);
  useEffect(() => {
    let active = true, sequence = 0;
    const check = async () => {
      const request = ++sequence;
      try { const next = await loadMyMerchantConnections(supabase, me.id); if (active && request === sequence) setResponse(next); }
      catch { if (active && request === sequence) setResponse(null); }
    };
    if (isAuthed) void check();
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && isAuthed) void check(); });
    return () => { active = false; listener.remove(); };
  }, [isAuthed, me.id, refreshSignal]);
  const invitations = response?.user_id === me.id ? response.invitations : [];
  async function act(invitation: MerchantAccountInvitation, accept: boolean) {
    if (pending.current) return;
    play(accept ? 'selection' : 'warning');
    if (!await confirmConnection([invitation.merchant_name, invitation.address, invitation.city_name,
      MERCHANT_ACCOUNT_ROLES[invitation.role], '', accept ? '이 업체 계정을 연결할까요?' : '이 초대를 거절할까요?',
    ].join('\n'))) return;
    if (current.current !== me.id) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (accept) await acceptMerchantAccountInvitation(supabase, invitation);
      else await cancelMerchantAccountInvitation(supabase, invitation.id);
      if (current.current === me.id) { setResponse(null); onChanged(); }
    } catch { if (current.current === me.id) { setResponse(null); setError('초대가 만료되었거나 업체 정보가 바뀌었어요. 다시 확인해 주세요.'); play('warning'); onChanged(); } }
    finally { pending.current = false; if (current.current === me.id) setBusy(false); }
  }
  if (!isAuthed || (!invitations.length && !error)) return null;
  return <View style={styles.list}>{error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}{invitations.map(invitation => <View key={invitation.id} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="smallBold">업체 계정 초대</ThemedText><ThemedText type="subtitle">{invitation.merchant_name}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{invitation.address} · {invitation.city_name}</ThemedText>
    <ThemedText type="small">{MERCHANT_ACCOUNT_ROLES[invitation.role]} · {new Date(invitation.expires_at).toLocaleDateString('ko-KR')}까지</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{invitation.role === 'owner' ? '업체 전체 정보와 운영 도구를 관리해요.' : '업체 프로필·글·사진·초안을 관리해요.'}</ThemedText>
    {!invitation.can_accept && <ThemedText type="small" accessibilityRole="alert">업체 정보가 바뀌었어요. 관리자에게 새 초대를 요청해 주세요.</ThemedText>}
    <View style={styles.actions}><AccountAction label="거절" disabled={busy} onPress={() => { void act(invitation, false); }} /><AccountAction primary label="확인하고 연결" disabled={busy || !invitation.can_accept} onPress={() => { void act(invitation, true); }} /></View>
  </View>)}</View>;
}

export function MerchantAccountManagement({ merchantId, merchantName, refreshSignal, onChanged }: { merchantId: string; merchantName: string; refreshSignal: number; onChanged: () => void }) {
  const { me, isAdmin } = useAuth(), theme = useTheme(), { play } = useInteractionFeedback();
  const scope = me.id + ':' + merchantId;
  const current = useRef(scope), pending = useRef(false);
  useLayoutEffect(() => { current.current = scope; return () => { current.current = ''; }; }, [scope]);
  const [response, setResponse] = useState<{ scope: string; data: MerchantAccountConnections } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void loadMerchantAccountConnections(supabase, merchantId).then(data => { if (active) { setResponse({ scope, data }); setError(''); } })
      .catch(() => { if (active) { setResponse(null); setError('연결을 확인하지 못했어요. 현재 업체 권한을 다시 확인해 주세요.'); } });
    return () => { active = false; };
  }, [merchantId, scope, refreshSignal, retry]);
  const data = response?.scope === scope ? response.data : null;
  async function revoke(action: () => Promise<unknown>, message: string) {
    if (pending.current) return;
    play('warning');
    if (!await confirmConnection(merchantName + '\n\n' + message) || current.current !== scope) return;
    pending.current = true; setBusy(true);
    try { await action(); if (current.current === scope) { setResponse(null); onChanged(); setRetry(v => v + 1); } }
    catch { if (current.current === scope) { setResponse(null); setError('연결 상태가 바뀌었어요. 다시 확인한 뒤 시도해 주세요.'); play('warning'); setRetry(v => v + 1); } }
    finally { pending.current = false; if (current.current === scope) setBusy(false); }
  }
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="subtitle">업체 계정 연결</ThemedText>
    {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {!data ? <AccountAction label="연결 다시 확인" disabled={busy} onPress={() => setRetry(v => v + 1)} /> : <>
      {[...(data.owner ? [data.owner] : []), ...data.operators].map(connection => <View key={connection.user_id + connection.role} style={styles.row}>
        <View style={{ flex: 1 }}><ThemedText type="smallBold">{connection.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{MERCHANT_ACCOUNT_ROLES[connection.role]} · ID {connection.user_id.slice(-6)}</ThemedText></View>
        {(connection.role === 'operator' || connection.user_id === me.id || isAdmin) && <AccountAction label="연결 해제" disabled={busy} onPress={() => { void revoke(
          () => disconnectMerchantAccount(supabase, merchantId, connection, data.updated_at, '업체 소유자가 계정 연결을 해제함'),
          connection.nickname + ' · ' + MERCHANT_ACCOUNT_ROLES[connection.role] + '\n\n' + (connection.role === 'owner' ? '소유자와 운영 담당자 연결, 대기 중인 초대를 모두 해제해요. ' : '') + '업체와 저장한 글은 보존돼요.',
        ); }} />}
      </View>)}
      {data.invitations.map(invitation => <View key={invitation.id} style={styles.row}><ThemedText style={{ flex: 1 }} type="small">{invitation.nickname} · {MERCHANT_ACCOUNT_ROLES[invitation.role]} · 수락 대기</ThemedText><AccountAction label="초대 취소" disabled={busy} onPress={() => { void revoke(() => cancelMerchantAccountInvitation(supabase, invitation.id), invitation.nickname + ' 초대를 취소할까요?'); }} /></View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  entry: { minHeight: 64, borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  list: { gap: 12, marginBottom: 16 }, card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, action: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
});
