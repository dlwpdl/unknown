import { useEffect, useState } from 'react';
import { DeviceEventEmitter, Image, StyleSheet, Text, View } from 'react-native';
import type { NativeAd } from 'react-native-google-mobile-ads';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AD_PRIVACY_CHANGED, feedAdUnit, prepareAds } from '@/lib/ads';

export function FeedAd() {
  const theme = useTheme();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ ad: NativeAd; sdk: NonNullable<Awaited<ReturnType<typeof prepareAds>>> } | null>(null);
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(AD_PRIVACY_CHANGED, () => { setLoaded(null); setRevision(value => value + 1); });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    let active = true, ad: NativeAd | null = null;
    void prepareAds().then(async (sdk) => {
      if (!sdk || !active) return;
      ad = await sdk.NativeAd.createForAdRequest(feedAdUnit(sdk), {
        requestNonPersonalizedAdsOnly: true, startVideoMuted: true,
        aspectRatio: sdk.NativeMediaAspectRatio.LANDSCAPE,
      });
      if (active) setLoaded({ ad, sdk }); else ad.destroy();
    }).catch((error) => {
      // Keep the feed usable on no-fill or network errors; log only the SDK error code.
      console.warn('[ads] feed load failed', typeof error?.code === 'string' ? error.code : 'LOAD_FAILED');
    });
    return () => { active = false; ad?.destroy(); };
  }, [revision]);
  if (!loaded) return null;
  const { ad, sdk: { NativeAdView, NativeAsset, NativeAssetType, NativeMediaView } } = loaded;
  // Fabric insets the native content view by padding/borders; keep those on the outer View.
  return <View style={[styles.ad, { backgroundColor: theme.background, borderColor: theme.line }]}>
    <NativeAdView nativeAd={ad}>
      <Text accessibilityLabel="광고" style={[styles.category, { color: theme.textSecondary }]}>Ad</Text>
      <NativeAsset assetType={NativeAssetType.HEADLINE}><Text style={[styles.headline, { color: theme.text }]}>{ad.headline}</Text></NativeAsset>
      {!!ad.body && <NativeAsset assetType={NativeAssetType.BODY}><Text style={[styles.body, { color: theme.textSecondary }]}>{ad.body}</Text></NativeAsset>}
      <NativeMediaView resizeMode="contain" style={styles.media} />
      <View style={styles.footer}>
        <View style={styles.identity}>
          {ad.icon && <NativeAsset assetType={NativeAssetType.ICON}><Image source={{ uri: ad.icon.url }} style={styles.icon} /></NativeAsset>}
          {!!ad.advertiser && <NativeAsset assetType={NativeAssetType.ADVERTISER}><Text style={[styles.advertiser, { color: theme.text }]}>{ad.advertiser}</Text></NativeAsset>}
        </View>
        {!!ad.callToAction && <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}><Text accessibilityRole="link" style={[styles.action, { color: theme.accent }]}>{ad.callToAction}</Text></NativeAsset>}
      </View>
    </NativeAdView>
  </View>;
}

const styles = StyleSheet.create({
  ad: { marginTop: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  category: { minWidth: 15, minHeight: 18, paddingRight: 32, marginBottom: Spacing.two, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  headline: { fontSize: 18, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  body: { marginTop: Spacing.two, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  media: { marginTop: Spacing.three, width: '100%', minHeight: 160, aspectRatio: 16 / 9 },
  // iOS can round the last asset 1/3 pt beyond its parent; leave one point inside the ad bounds.
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two, marginBottom: 1 },
  identity: { flexGrow: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  advertiser: { flexShrink: 1, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  icon: { width: 32, height: 32, borderRadius: 6 },
  action: { minHeight: 44, paddingVertical: 12, fontSize: 13, lineHeight: 19, fontWeight: '700', flexShrink: 1 },
});
