import { useLanguage } from '@/hooks/use-language';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable } from '@/components/analytics-controls';
import { MerchantProfileHeader } from '@/components/merchant-profile-header';
import { MerchantHelp } from '@/components/merchant-ui';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyMerchantProfile, saveMyMerchantProfile, saveMyMerchantProfilePhotos, uploadMerchantProfileImage, type MyMerchantProfile } from '@/lib/merchant-profile-editor';
import { saveMerchantContact } from '@/lib/merchant-conveniences';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { supabase } from '@/lib/supabase';
import { publicCompanyUrl } from '@/lib/public-seo';
import { CONTACT_EMAIL } from '@/lib/legal-documents';

type Photo = { path: string | null; uri: string | null; image?: PreparedImage };
type Photos = { avatar: Photo; banner: Photo; map: Photo };
const savedPhotos = (profile: MyMerchantProfile): Photos => ({ avatar: { path: profile.avatar_path, uri: profile.avatarUri }, banner: { path: profile.banner_path, uri: profile.bannerUri }, map: { path: profile.map_photo_path ?? null, uri: profile.mapPhotoUri ?? null } });

function ProfileAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {

  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable lens analyticsId="merchant.profile.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={() => { play('selection'); onPress(); }}
    style={[styles.button, { borderColor: theme.line, backgroundColor: primary ? theme.accent : 'transparent', opacity: disabled ? 0.45 : 1 }]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : theme.accent }}>{label}</ThemedText>
  </Pressable>;
}

// bare: the business web renders the page title itself, so only the public-profile link stays on top.
export function MerchantProfileEditor({ merchantId, onDirty, bare = false }: { merchantId: string; onDirty: (dirty: boolean) => void; bare?: boolean }) {

  const { me, isAuthed } = useAuth();
  return <ScopedProfileEditor key={`${merchantId}:${isAuthed ? me.id : 'guest'}`} merchantId={merchantId} onDirty={onDirty} bare={bare} />;
}

function ScopedProfileEditor({ merchantId, onDirty, bare = false }: { merchantId: string; onDirty: (dirty: boolean) => void; bare?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter(), { me } = useAuth(), { play } = useInteractionFeedback();
  const [profile, setProfile] = useState<MyMerchantProfile | null>(null), [photos, setPhotos] = useState<Photos | null>(null);
  const [contact, setContact] = useState<{ phone: string; hours: string } | null>(null);
  const contactDraft = useRef<{ phone: string; hours: string } | null>(null);
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), working = useRef(false), draft = useRef<Photos | null>(null), uploads = useRef(new Set<string>());
  const change = (next: Photos | null) => { draft.current = next; setPhotos(next); setNotice(''); };
  const photoDirty = !!profile && !!photos && (!!photos.avatar.image || !!photos.banner.image || !!photos.map.image || photos.avatar.path !== profile.avatar_path || photos.banner.path !== profile.banner_path || photos.map.path !== (profile.map_photo_path ?? null));
  const contactDirty = !!profile && !!contact && (contact.phone !== (profile.public_phone ?? '') || contact.hours !== (profile.business_hours ?? ''));
  const dirty = photoDirty || contactDirty;
  const changeContact = (next: { phone: string; hours: string }) => { contactDraft.current = next; setContact(next); setNotice(''); };

  useEffect(() => {
    mounted.current = true;
    const tracked = uploads.current;
    return () => {
      mounted.current = false;
      // Storage serializes this cleanup with saving and refuses every bound path.
      if (tracked.size) void supabase.storage.from('merchant-profile-images').remove([...tracked]).catch(() => {});
    };
  }, []);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    void loadMyMerchantProfile(supabase, merchantId).then((next) => {
      if (!active) return;
      setProfile(next);
      if (!draft.current) { draft.current = savedPhotos(next); setPhotos(draft.current); }
      if (!contactDraft.current) { contactDraft.current = { phone: next.public_phone ?? '', hours: next.business_hours ?? '' }; setContact(contactDraft.current); }
      setError('');
    }).catch(() => { if (active) setError("프로필을 불러오지 못했어요. 비즈니스 권한과 연결 상태를 확인해 주세요."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [merchantId, revision]);

  const choose = async (kind: keyof Photos) => {
    if (working.current || !profile?.can_edit || !draft.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (selected.canceled || !mounted.current) return;
      const asset = selected.assets?.[0];
      if (!asset?.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg')) throw new Error('IMAGE_UNSUPPORTED');
      const image = await preparePostImage(asset);
      if (mounted.current && draft.current) { change({ ...draft.current, [kind]: { path: null, uri: image.uri, image } }); play('selection'); }
    } catch { if (mounted.current) { setError("사진을 준비하지 못했어요. JPEG, PNG, WebP 사진으로 다시 선택해 주세요."); play('warning'); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };

  const save = async () => {
    if (working.current || !profile?.can_edit || !draft.current || !photoDirty) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      let next = draft.current;
      for (const kind of ['avatar', 'banner', 'map'] as const) {
        const photo = next[kind];
        if (!photo.image) continue;
        const path = await uploadMerchantProfileImage(supabase, me.id, merchantId, photo.image);
        uploads.current.add(path);
        if (!mounted.current) { void supabase.storage.from('merchant-profile-images').remove([path]).catch(() => {}); return; }
        next = { ...next, [kind]: { path, uri: photo.uri } }; change(next);
      }
      const patch = { avatarPath: next.avatar.path, bannerPath: next.banner.path, mapPhotoPath: next.map.path, updatedAt: profile.updated_at };
      const saved = next.map.path !== (profile.map_photo_path ?? null)
        ? await saveMyMerchantProfilePhotos(supabase, merchantId, patch) : await saveMyMerchantProfile(supabase, merchantId, patch);
      if (!mounted.current) return;
      setProfile(saved); change(savedPhotos(saved)); setNotice("프로필 사진을 저장했어요. 공개 가능한 비즈니스 프로필에 표시돼요."); play('success');
      const old = [profile.avatar_path, profile.banner_path, profile.map_photo_path, ...uploads.current].filter((path): path is string => !!path);
      if (old.length) void supabase.storage.from('merchant-profile-images').remove([...new Set(old)]).catch(() => {});
    } catch (failure) {
      if (!mounted.current) return;
      const message = failure instanceof Error ? failure.message : '';
      setError(message.includes('MERCHANT_PROFILE_CHANGED') ? "다른 곳에서 프로필이 바뀌었어요. 선택한 사진은 남아 있어요. 최근 저장본을 확인하려면 취소 후 다시 열어주세요."
        : message.includes('ACCOUNT_CHANGED') ? "계정이 바뀌었어요. 현재 계정으로 다시 열어주세요."
        : "저장을 확인하지 못했어요. 사진은 남아 있으니 같은 내용으로 다시 시도해 주세요.");
      play('warning');
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const saveContact = async () => {
    if (working.current || !profile?.can_edit || !contactDraft.current || !contactDirty) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      const saved = await saveMerchantContact(supabase, merchantId, contactDraft.current.phone, contactDraft.current.hours, profile.updated_at);
      if (!mounted.current) return;
      setProfile(saved); changeContact({ phone: saved.public_phone ?? '', hours: saved.business_hours ?? '' });
      setNotice("공개 전화번호와 영업시간을 저장했어요."); play('success');
    } catch (failure) {
      if (mounted.current) {
        const message = failure instanceof Error ? failure.message : '';
        setError(message.includes('MERCHANT_PROFILE_CHANGED') ? "다른 곳에서 프로필이 바뀌었어요. 입력한 연락 정보는 남아 있어요. 수정 취소 후 최근 저장본을 다시 확인해 주세요."
          : message.includes('ACCOUNT_CHANGED') ? "계정이 바뀌었어요. 현재 계정으로 다시 열어주세요."
          : message.includes('INVALID') ? "전화번호는 국가번호와 숫자, 공백·괄호·하이픈으로 적어주세요. 영업시간은 500자 이내로 입력해 주세요."
          : "연락 정보 저장을 확인하지 못했어요. 입력한 내용은 남아 있으니 다시 시도해 주세요.");
        play('warning');
      }
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const reload = () => { setLoading(true); setError(''); setRevision((value) => value + 1); };
  const cancel = () => {
    if (uploads.current.size) void supabase.storage.from('merchant-profile-images').remove([...uploads.current]).catch(() => {});
    contactDraft.current = null; setContact(null); change(null); reload();
  };
  const name = (kind: keyof Photos) => kind === 'banner' ? tr("채널 배너") : kind === 'avatar' ? tr("가게 로고") : tr("지도 대표 사진");
  const short = (kind: keyof Photos) => kind === 'banner' ? tr('배너') : kind === 'avatar' ? tr('로고') : tr('지도 사진');
  const card = [styles.card, { borderColor: theme.line, backgroundColor: theme.card }];
  // Public profile fields guests see; [label, fillable on this screen].
  const missing = !profile ? [] : ([[tr("배너"), !profile.banner_path], [tr("로고"), !profile.avatar_path], [tr("주소"), !profile.address?.trim(), false],
    [tr("영업시간"), !profile.business_hours?.trim()], [tr("전화번호"), !profile.public_phone?.trim()], [tr("소개"), !profile.services?.trim(), false]] as [string, boolean, boolean?][])
    .filter(([, empty]) => empty).map(([label, , here = true]) => [label, here] as const);
  return <View style={styles.page}>
    {(!bare || profile) && <View style={[styles.row, bare && styles.end]}>
      {!bare && <ThemedText type="subtitle">{tr("비즈니스 프로필")}</ThemedText>}
      {profile && <ProfileAction label={tr("공개 프로필 보기")} onPress={() => {
        if (Platform.OS === 'web') void Linking.openURL(publicCompanyUrl(merchantId)).catch(() => setError("프로필을 열지 못했어요. 잠시 후 다시 시도해 주세요."));
        else router.push({ pathname: '/company/[id]', params: { id: merchantId } });
      }} disabled={busy} />}
    </View>}
    {loading ? <ThemedText type="small" accessibilityLiveRegion="polite">{tr("프로필을 불러오는 중…")}</ThemedText>
      : profile && photos && <>
        {profile.can_edit && missing.length > 0 && <View style={card} accessibilityRole="summary">
          <ThemedText type="smallBold">{tr("배너·주소·영업시간을 채우면 더 잘 보여요")}</ThemedText>
          <ThemedText type="small">{tr("아직 비어 있어요: {0}", missing.map(([label]) => label).join(', '))}</ThemedText>
          {missing.some(([, here]) => !here) && <ThemedText type="small" themeColor="textSecondary">{tr("주소와 소개는 {0}로 보내 주시면 넣어 드려요.", CONTACT_EMAIL)}</ThemedText>}
        </View>}
        <View style={card}>
          <ThemedText type="smallBold">{tr("사진")}</ThemedText>
          <MerchantProfileHeader profile={{ ...profile, avatarUri: photos.avatar.uri, bannerUri: photos.banner.uri }} />
          {!profile.can_edit && <ThemedText type="small" themeColor="textSecondary">{tr("비즈니스 계정과 소유 확인이 완료되면 사진을 바꿀 수 있어요.")}</ThemedText>}
          {profile.can_edit && <>
            <View style={styles.tiles}>{(['banner', 'avatar', 'map'] as const).map((kind) => {
              const photo = photos[kind], has = !!(photo.uri || photo.path || photo.image);
              return <View key={kind} style={styles.tile}>
                <ThemedText type="smallBold">{name(kind)}</ThemedText>
                {photo.uri ? <Image source={{ uri: photo.uri }} style={[styles.thumb, { backgroundColor: theme.backgroundElement }, kind === 'avatar' && styles.logo]} contentFit="cover"
                  accessibilityLabel={kind === 'banner' ? tr("채널 배너 미리보기") : kind === 'avatar' ? tr("가게 로고 미리보기") : tr("지도 대표 사진 미리보기")}
                  onError={kind !== 'map' ? undefined : () => { if (!draft.current || draft.current.map.uri !== photos.map.uri) return;
                    setProfile(current => current ? { ...current, imageLoadFailed: true } : current); change({ ...draft.current, map: { ...draft.current.map, uri: null } }); }} />
                  : <Pressable analyticsId="merchant.profile.action" accessibilityRole="button" accessibilityLabel={tr("{0} {1}", short(kind), has ? tr('교체') : tr('선택'))} accessibilityState={{ disabled: busy }}
                    disabled={busy} onPress={() => { play('selection'); void choose(kind); }}
                    style={({ pressed }) => [styles.thumb, styles.empty, { borderColor: theme.line, opacity: busy ? 0.45 : pressed ? 0.7 : 1 }, kind === 'avatar' && styles.logo]}>
                    <ThemedText type="smallBold" themeColor="accent">{tr("+ 추가")}</ThemedText>
                  </Pressable>}
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{kind === 'banner' ? tr("가로 · 가운데 기준") : kind === 'avatar' ? tr("원형으로 보여요") : tr("없으면 장소 사진을 써요")}</ThemedText>
                <View style={styles.actions}>
                  <ProfileAction label={tr("{0} {1}", short(kind), has ? tr('교체') : tr('선택'))} onPress={() => { void choose(kind); }} disabled={busy} />
                  {has && <ProfileAction label={tr("{0} 제거", short(kind))} onPress={() => change({ ...photos, [kind]: { path: null, uri: null } })} disabled={busy} />}
                </View>
              </View>;
            })}</View>
            <View style={[styles.actions, styles.end]}>
              {dirty && <ProfileAction label={tr("취소")} onPress={cancel} disabled={busy} />}
              <ProfileAction label={busy ? tr("처리 중…") : tr("프로필 사진 저장")} onPress={() => { void save(); }} disabled={busy || !photoDirty} primary={photoDirty} />
            </View>
          </>}
          {profile.imageLoadFailed && !dirty && <View style={styles.row}><ThemedText type="small" themeColor="textSecondary">{tr("사진 일부를 불러오지 못했어요. 저장된 사진은 유지돼요.")}</ThemedText><ProfileAction label={tr("사진 다시 확인")} onPress={() => { change(null); reload(); }} disabled={busy} /></View>}
        </View>
        {profile.can_edit && contact && <View style={card}>
          <View style={styles.title}>
            <ThemedText type="smallBold">{tr("공개 연락 정보")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{tr("비워 두면 공개하지 않아요.")}</ThemedText>
          </View>
          <View style={styles.fields}>
            <View style={styles.field}>
              <ThemedText type="smallBold">{tr("전화번호")}</ThemedText>
              <TextInput accessibilityLabel={tr("비즈니스 공개 전화번호")} value={contact.phone} editable={!busy} maxLength={40} keyboardType="phone-pad" autoCapitalize="none"
                placeholder="+1 604 555 0101" placeholderTextColor={theme.textSecondary} onFocus={() => play('selection')} onChangeText={phone => changeContact({ ...contact, phone })}
                style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
            </View>
            <View style={styles.field}>
              <ThemedText type="smallBold">{tr("영업시간")}</ThemedText>
              <TextInput accessibilityLabel={tr("비즈니스 영업시간")} value={contact.hours} editable={!busy} maxLength={500} multiline
                placeholder={tr("월–금 09:00–18:00\n토·일 휴무")} placeholderTextColor={theme.textSecondary} onFocus={() => play('selection')} onChangeText={hours => changeContact({ ...contact, hours })}
                style={[styles.input, styles.hours, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{tr("손님에게 공개돼요. 내부 담당자 연락처와는 따로예요.")}</ThemedText>
          <View style={[styles.actions, styles.end]}>
            <ProfileAction label={busy ? tr("연락 정보 처리 중…") : tr("연락 정보 저장")} onPress={() => { void saveContact(); }} disabled={busy || !contactDirty} primary={!photoDirty && contactDirty} />
          </View>
        </View>}
      </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
    {!loading && !profile && <ProfileAction label={tr("다시 불러오기")} onPress={reload} disabled={busy} />}
    {!!notice && <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">{tr(notice)}</ThemedText>}
    {profile?.can_edit && <MerchantHelp items={[tr("저장 전 미리보기에서 확인해 주세요."), tr("지도 대표 사진은 연결된 장소 카드에 표시돼요. 사진을 제거하면 기존 장소 사진을 사용해요.")]} />}
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  end: { justifyContent: 'flex-end' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  tile: { flexGrow: 1, flexBasis: 200, minWidth: 0, gap: 8 },
  thumb: { width: '100%', height: 96, borderRadius: 10 },
  logo: { width: 96, borderRadius: 48 },
  empty: { borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12 },
  hours: { minHeight: 100, textAlignVertical: 'top' },
});
