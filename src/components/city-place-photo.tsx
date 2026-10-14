import { Image } from 'expo-image';
import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { CityPlace } from '@/lib/city-places';

export function CityPlacePhoto({ place, style }: { place: CityPlace; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme(), [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = place.photo?.uri;
  return <View style={[styles.frame, { backgroundColor: theme.backgroundElement }, style]}>
    {uri && failedUri !== uri
      ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk"
          recyclingKey={uri} transition={0} accessibilityLabel={`${place.name} 사진`} onError={() => setFailedUri(uri)} />
      : <SymbolView name={{ ios: 'photo', android: 'image', web: 'image' }} size={24} tintColor={theme.textSecondary} />}
  </View>;
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
