import { useLanguage } from '@/hooks/use-language';
import { tr } from '@/i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
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
import { selectChatBusiness } from '@/lib/chat-identity';

function AccountAction({ label, onPress, disabled, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {

  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable lens analyticsId="merchant.connection.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [styles.action, { borderColor: theme.line, backgroundColor: primary ? theme.accent : theme.backgroundElement, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={primary ? { color: theme.background } : undefined}>{label}</ThemedText>
  </Pressable>;
}
async function confirmConnection(message: string) {
  if (Platform.OS === 'web') return window.confirm(message);
  return new Promise<boolean>(resolve => Alert.alert(tr("비즈니스 계정 확인"), message, [
    { text: tr("취소"), style: 'cancel', onPress: () => resolve(false) }, { text: tr("계속"), onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function MerchantAccountEntry() {
  const { tr } = useLanguage();
  const { me, isAuthed, isAdmin } = useAuth(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const [response, setResponse] = useState<MyMerchantConnections | null>(null), [busy, setBusy] = useState(false);
  const current = useRef(me.id), serial = useRef(0), opening = useRef(false);
  useLayoutEffect(() => { current.current = me.id; return () => { current.current = ''; }; }, [me.id]);
  useFocusEffect(useCallback(() => {
    let active = true;
    const check = async () => {
      const request = ++serial.current;
      try { const next = await loadMyMerchantConnections(supabase, me.id, isAdmin); if (active && request === serial.current) setResponse(next); }
      catch { if (active && request === serial.current) setResponse(null); }
    };
    if (isAuthed) void check();
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && isAuthed) void check(); });
    return () => { active = false; serial.current++; listener.remove(); };
  }, [isAuthed, isAdmin, me.id]));
  const data = response?.user_id === me.id ? response : null;
  if (!isAuthed || (!data?.merchants.length && !data?.invitations.length)) return null;
  async function open() {
    if (opening.current) return;
    opening.current = true; setBusy(true); play('selection');
    const request = ++serial.current;
    try {
      const next = await loadMyMerchantConnections(supabase, me.id, isAdmin);
      if (current.current !== me.id || serial.current !== request) return;
      setResponse(next);
      if (next.merchants.length === 1 && next.merchants[0].role !== 'admin') {
        selectChatBusiness(me.id, next.merchants[0]);
        router.push({ pathname: '/profile/merchant', params: { merchant: next.merchants[0].id, tab: 'drafts' } });
      }
      else if (next.merchants.length || next.invitations.length) router.push('/profile/merchant');
    } catch { if (current.current === me.id) { setResponse(null); play('warning'); } }
    finally { opening.current = false; if (current.current === me.id) setBusy(false); }
  }
  const invitationOnly = !data?.merchants.length && !!data?.invitations.length;
  return <Pressable analyticsId="app_profile_index.merchant" accessibilityRole="button" accessibilityLabel={invitationOnly ? tr("비즈니스 계정 초대 확인") : tr("비즈니스 프로필 전환")} disabled={busy}
    accessibilityState={{ disabled: busy }} onPress={() => { void open(); }} style={({ pressed }) => [styles.entry, { backgroundColor: pressed ? theme.backgroundSelected : theme.card, borderColor: theme.line }]}>
    <View style={[styles.entryIcon, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} size={22} tintColor={theme.navy} />
    </View>
    <View style={{ flex: 1, gap: 4 }}><ThemedText type="smallBold">{invitationOnly ? tr("비즈니스 계정 초대") : data?.merchants.length === 1 ? tr('{0}로 글쓰기', data.merchants[0].name) : tr("비즈니스")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{busy ? tr("현재 연결 확인 중…") : invitationOnly ? tr("초대한 비즈니스와 권한을 확인해 주세요.") : data?.merchants.length === 1 ? tr('비즈니스 프로필 · 개인 닉네임은 유지돼요.') : tr('{0}개 비즈니스 · 프로필 전환', data?.merchants.length ?? 0)}</ThemedText></View>
    <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
  </Pressable>;
}

export function MerchantAccountInvitations({ refreshSignal = 0, onChanged }: { refreshSignal?: number; onChanged: () => void }) {
  const { tr, locale: appLocale } = useLanguage();
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
      MERCHANT_ACCOUNT_ROLES[invitation.role], '', accept ? '이 비즈니스 계정을 연결할까요?' : '이 초대를 거절할까요?',
    ].join('\n'))) return;
    if (current.current !== me.id) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (accept) await acceptMerchantAccountInvitation(supabase, invitation);
      else await cancelMerchantAccountInvitation(supabase, invitation.id);
      if (current.current === me.id) { setResponse(null); onChanged(); }
    } catch { if (current.current === me.id) { setResponse(null); setError("초대가 만료되었거나 비즈니스 정보가 바뀌었어요. 다시 확인해 주세요."); play('warning'); onChanged(); } }
    finally { pending.current = false; if (current.current === me.id) setBusy(false); }
  }
  if (!isAuthed || (!invitations.length && !error)) return null;
  return <View style={styles.list}>{error && <ThemedText accessibilityRole="alert">{tr(error)}</ThemedText>}{invitations.map(invitation => <View key={invitation.id} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="smallBold">{tr("비즈니스 계정 초대")}</ThemedText><ThemedText type="subtitle">{invitation.merchant_name}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{invitation.address} · {invitation.city_name}</ThemedText>
    <ThemedText type="small">{MERCHANT_ACCOUNT_ROLES[invitation.role]} · {new Date(invitation.expires_at).toLocaleDateString(appLocale)}{tr("까지")}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{invitation.role === 'owner' ? tr("비즈니스 전체 정보와 운영 도구를 관리해요.") : tr("비즈니스 프로필·글·사진·초안을 관리해요.")}</ThemedText>
    {!invitation.can_accept && <ThemedText type="small" accessibilityRole="alert">{tr("비즈니스 정보가 바뀌었어요. 관리자에게 새 초대를 요청해 주세요.")}</ThemedText>}
    <View style={styles.actions}><AccountAction label={tr("거절")} disabled={busy} onPress={() => { void act(invitation, false); }} /><AccountAction primary label={tr("확인하고 연결")} disabled={busy || !invitation.can_accept} onPress={() => { void act(invitation, true); }} /></View>
  </View>)}</View>;
}

export function MerchantAccountManagement({ merchantId, merchantName, refreshSignal, onChanged }: { merchantId: string; merchantName: string; refreshSignal: number; onChanged: () => void }) {
  const { tr } = useLanguage();
  const { me, isAdmin } = useAuth(), theme = useTheme(), { play } = useInteractionFeedback();
  const scope = me.id + ':' + merchantId;
  const current = useRef(scope), pending = useRef(false);
  useLayoutEffect(() => { current.current = scope; return () => { current.current = ''; }; }, [scope]);
  const [response, setResponse] = useState<{ scope: string; data: MerchantAccountConnections } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void loadMerchantAccountConnections(supabase, merchantId).then(data => { if (active) { setResponse({ scope, data }); setError(''); } })
      .catch(() => { if (active) { setResponse(null); setError("연결을 확인하지 못했어요. 현재 비즈니스 권한을 다시 확인해 주세요."); } });
    return () => { active = false; };
  }, [merchantId, scope, refreshSignal, retry]);
  const data = response?.scope === scope ? response.data : null;
  async function revoke(action: () => Promise<unknown>, message: string) {
    if (pending.current) return;
    play('warning');
    if (!await confirmConnection(merchantName + '\n\n' + message) || current.current !== scope) return;
    pending.current = true; setBusy(true);
    try { await action(); if (current.current === scope) { setResponse(null); onChanged(); setRetry(v => v + 1); } }
    catch { if (current.current === scope) { setResponse(null); setError("연결 상태가 바뀌었어요. 다시 확인한 뒤 시도해 주세요."); play('warning'); setRetry(v => v + 1); } }
    finally { pending.current = false; if (current.current === scope) setBusy(false); }
  }
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="subtitle">{tr("비즈니스 계정 연결")}</ThemedText>
    {error && <ThemedText accessibilityRole="alert">{tr(error)}</ThemedText>}
    {!data ? <AccountAction label={tr("연결 다시 확인")} disabled={busy} onPress={() => setRetry(v => v + 1)} /> : <>
      {[...(data.owner ? [data.owner] : []), ...data.operators].map(connection => <View key={connection.user_id + connection.role} style={styles.row}>
        <View style={{ flex: 1 }}><ThemedText type="smallBold">{connection.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{MERCHANT_ACCOUNT_ROLES[connection.role]} · ID {connection.user_id.slice(-6)}</ThemedText></View>
        {(connection.role === 'operator' || connection.user_id === me.id || isAdmin) && <AccountAction label={tr("연결 해제")} disabled={busy} onPress={() => { void revoke(
          () => disconnectMerchantAccount(supabase, merchantId, connection, data.updated_at, '비즈니스 소유자가 계정 연결을 해제함'),
          connection.nickname + ' · ' + MERCHANT_ACCOUNT_ROLES[connection.role] + '\n\n' + (connection.role === 'owner' ? '소유자와 운영 담당자 연결, 대기 중인 초대를 모두 해제해요. ' : '') + '비즈니스와 저장한 글은 보존돼요.',
        ); }} />}
      </View>)}
      {data.invitations.map(invitation => <View key={invitation.id} style={styles.row}><ThemedText style={{ flex: 1 }} type="small">{invitation.nickname} · {MERCHANT_ACCOUNT_ROLES[invitation.role]}{" " + tr("· 수락 대기")}</ThemedText><AccountAction label={tr("초대 취소")} disabled={busy} onPress={() => { void revoke(() => cancelMerchantAccountInvitation(supabase, invitation.id), invitation.nickname + ' 초대를 취소할까요?'); }} /></View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  entry: { minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  entryIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 12, marginBottom: 16 }, card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, action: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
});
