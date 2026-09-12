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
  return <NativeAdView nativeAd={ad} style={[styles.ad, { borderColor: theme.line }]}>
    <View style={styles.identity}>
      {ad.icon && <NativeAsset assetType={NativeAssetType.ICON}><Image source={{ uri: ad.icon.url }} style={styles.icon} /></NativeAsset>}
      <View style={styles.advertiser}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>광고</Text>
        {!!ad.advertiser && <NativeAsset assetType={NativeAssetType.ADVERTISER}><Text style={{ color: theme.text }}>{ad.advertiser}</Text></NativeAsset>}
      </View>
    </View>
    <NativeAsset assetType={NativeAssetType.HEADLINE}><Text style={[styles.headline, { color: theme.text }]}>{ad.headline}</Text></NativeAsset>
    {!!ad.body && <NativeAsset assetType={NativeAssetType.BODY}><Text style={[styles.body, { color: theme.textSecondary }]}>{ad.body}</Text></NativeAsset>}
    <NativeMediaView resizeMode="contain" style={styles.media} />
    {!!ad.callToAction && <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}><Text style={[styles.action, { color: theme.accent }]}>{ad.callToAction}</Text></NativeAsset>}
  </NativeAdView>;
}

const styles = StyleSheet.create({
  ad: { marginTop: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingRight: 32 },
  advertiser: { flex: 1, gap: Spacing.one }, icon: { width: 32, height: 32, borderRadius: 6 },
  label: { fontSize: 12, lineHeight: 18 }, headline: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 }, media: { width: '100%', minHeight: 160, aspectRatio: 1.8 },
  action: { minHeight: 44, paddingVertical: 12, fontSize: 14, fontWeight: '600' },
});
