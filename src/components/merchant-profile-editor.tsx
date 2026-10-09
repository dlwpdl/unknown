import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Pressable } from '@/components/analytics-controls';
import { MerchantProfileHeader } from '@/components/merchant-profile-header';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyMerchantProfile, saveMyMerchantProfile, uploadMerchantProfileImage, type MyMerchantProfile } from '@/lib/merchant-profile-editor';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { supabase } from '@/lib/supabase';

type Photo = { path: string | null; uri: string | null; image?: PreparedImage };
type Photos = { avatar: Photo; banner: Photo };
const savedPhotos = (profile: MyMerchantProfile): Photos => ({ avatar: { path: profile.avatar_path, uri: profile.avatarUri }, banner: { path: profile.banner_path, uri: profile.bannerUri } });

function ProfileAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId="merchant.profile.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={() => { play('selection'); onPress(); }}
    style={[styles.button, { borderColor: theme.line, backgroundColor: primary ? theme.accent : 'transparent', opacity: disabled ? 0.45 : 1 }]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : theme.accent }}>{label}</ThemedText>
  </Pressable>;
}

export function MerchantProfileEditor({ merchantId, onDirty }: { merchantId: string; onDirty: (dirty: boolean) => void }) {
  const { me, isAuthed } = useAuth();
  return <ScopedProfileEditor key={`${merchantId}:${isAuthed ? me.id : 'guest'}`} merchantId={merchantId} onDirty={onDirty} />;
}

function ScopedProfileEditor({ merchantId, onDirty }: { merchantId: string; onDirty: (dirty: boolean) => void }) {
  const theme = useTheme(), router = useRouter(), { me } = useAuth(), { play } = useInteractionFeedback();
  const [profile, setProfile] = useState<MyMerchantProfile | null>(null), [photos, setPhotos] = useState<Photos | null>(null);
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), working = useRef(false), draft = useRef<Photos | null>(null), uploads = useRef(new Set<string>());
  const change = (next: Photos | null) => { draft.current = next; setPhotos(next); setNotice(''); };
  const dirty = !!profile && !!photos && (!!photos.avatar.image || !!photos.banner.image || photos.avatar.path !== profile.avatar_path || photos.banner.path !== profile.banner_path);

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
      setError('');
    }).catch(() => { if (active) setError('프로필을 불러오지 못했어요. 업체 권한과 연결 상태를 확인해 주세요.'); })
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
    } catch { if (mounted.current) { setError('사진을 준비하지 못했어요. JPEG, PNG, WebP 사진으로 다시 선택해 주세요.'); play('warning'); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };

  const save = async () => {
    if (working.current || !profile?.can_edit || !draft.current || !dirty) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      let next = draft.current;
      for (const kind of ['avatar', 'banner'] as const) {
        const photo = next[kind];
        if (!photo.image) continue;
        const path = await uploadMerchantProfileImage(supabase, me.id, merchantId, photo.image);
        uploads.current.add(path);
        if (!mounted.current) { void supabase.storage.from('merchant-profile-images').remove([path]).catch(() => {}); return; }
        next = { ...next, [kind]: { path, uri: photo.uri } }; change(next);
      }
      const saved = await saveMyMerchantProfile(supabase, merchantId, { avatarPath: next.avatar.path, bannerPath: next.banner.path, updatedAt: profile.updated_at });
      if (!mounted.current) return;
      setProfile(saved); change(savedPhotos(saved)); setNotice('프로필 사진을 저장했어요. 공개 가능한 업체 프로필에 표시돼요.'); play('success');
      const old = [profile.avatar_path, profile.banner_path, ...uploads.current].filter((path): path is string => !!path);
      if (old.length) void supabase.storage.from('merchant-profile-images').remove([...new Set(old)]).catch(() => {});
    } catch (failure) {
      if (!mounted.current) return;
      const message = failure instanceof Error ? failure.message : '';
      setError(message.includes('MERCHANT_PROFILE_CHANGED') ? '다른 곳에서 프로필이 바뀌었어요. 선택한 사진은 남아 있어요. 최근 저장본을 확인하려면 취소 후 다시 열어주세요.'
        : message.includes('ACCOUNT_CHANGED') ? '계정이 바뀌었어요. 현재 계정으로 다시 열어주세요.'
        : '저장을 확인하지 못했어요. 사진은 남아 있으니 같은 내용으로 다시 시도해 주세요.');
      play('warning');
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const reload = () => { setLoading(true); setError(''); setRevision((value) => value + 1); };
  const cancel = () => {
    if (uploads.current.size) void supabase.storage.from('merchant-profile-images').remove([...uploads.current]).catch(() => {});
    change(null); reload();
  };
  return <View style={[styles.section, { borderColor: theme.line, backgroundColor: theme.card }]}>
    <View style={styles.row}><ThemedText type="subtitle">업체 프로필</ThemedText>
      {profile && <ProfileAction label="공개 프로필 보기" onPress={() => {
        if (Platform.OS === 'web') void Linking.openURL(`https://gling.ej-entertainment.com/company?id=${encodeURIComponent(merchantId)}`).catch(() => setError('프로필을 열지 못했어요. 잠시 후 다시 시도해 주세요.'));
        else router.push({ pathname: '/company/[id]', params: { id: merchantId } });
      }} disabled={busy} />}
    </View>
    {loading ? <ThemedText type="small" accessibilityLiveRegion="polite">프로필을 불러오는 중…</ThemedText>
      : profile && photos && <>
        <MerchantProfileHeader profile={{ ...profile, avatarUri: photos.avatar.uri, bannerUri: photos.banner.uri }} />
        {!profile.can_edit && <ThemedText type="small" themeColor="textSecondary">업체 계정과 소유 확인이 완료되면 사진을 바꿀 수 있어요.</ThemedText>}
        {profile.can_edit && <>
          <ThemedText type="small" themeColor="textSecondary">배너는 가운데 기준의 가로 화면, 로고는 원형으로 보여요. 저장 전 미리보기에서 확인해 주세요.</ThemedText>
          {(['banner', 'avatar'] as const).map((kind) => <View key={kind} style={styles.row}>
            <ThemedText type="smallBold">{kind === 'banner' ? '채널 배너' : '가게 로고'}</ThemedText>
            <View style={styles.actions}>
              <ProfileAction label={`${kind === 'banner' ? '배너' : '로고'} ${photos[kind].uri || photos[kind].path ? '교체' : '선택'}`} onPress={() => { void choose(kind); }} disabled={busy} />
              {(photos[kind].uri || photos[kind].path) && <ProfileAction label={`${kind === 'banner' ? '배너' : '로고'} 제거`} onPress={() => change({ ...photos, [kind]: { path: null, uri: null } })} disabled={busy} />}
            </View>
          </View>)}
          <View style={styles.actions}>
            <ProfileAction label={busy ? '처리 중…' : '프로필 사진 저장'} onPress={() => { void save(); }} disabled={busy || !dirty} primary />
            {dirty && <ProfileAction label="선택 취소" onPress={cancel} disabled={busy} />}
          </View>
        </>}
        {profile.imageLoadFailed && !dirty && <View style={styles.row}><ThemedText type="small" themeColor="textSecondary">사진 일부를 불러오지 못했어요. 저장된 사진은 유지돼요.</ThemedText><ProfileAction label="사진 다시 확인" onPress={() => { change(null); reload(); }} disabled={busy} /></View>}
      </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
    {!loading && !profile && <ProfileAction label="다시 불러오기" onPress={reload} disabled={busy} />}
    {!!notice && <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">{notice}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
});
