import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMerchantSource, trackMerchantSourceClick, type MerchantSource } from '@/lib/merchant-source';
import { supabase } from '@/lib/supabase';

export function MerchantSourceLink({ postId }: { postId: string }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [result, setResult] = useState<{ id: string; source: MerchantSource } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadMerchantSource(supabase, postId).then((source) => { if (active) { setResult(source ? { id: postId, source } : null); setError(''); } });
    return () => { active = false; };
  }, [postId]);
  if (result?.id !== postId) return null;
  return <View style={styles.section}>
    <ThemedText type="small" themeColor="textSecondary">{result.source.merchant_name} · 업체가 허락한 안내</ThemedText>
    <Pressable accessibilityRole="link" accessibilityLabel={`${result.source.merchant_name} 계정으로 가기, 외부 페이지 열기`} style={({ pressed }) => [styles.button, { borderColor: theme.line, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => {
        play('selection'); setError('');
        void trackMerchantSourceClick(supabase, postId, Platform.OS);
        void Linking.openURL(result.source.original_url).catch(() => { setError('업체 페이지를 열지 못했어요. 잠시 후 다시 눌러주세요.'); play('warning'); });
      }}><ThemedText type="smallBold" themeColor="accent">업체 계정으로 가기 ↗</ThemedText></Pressable>
    {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  section: { marginTop: 16, gap: 8 },
  button: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 12 },
});
