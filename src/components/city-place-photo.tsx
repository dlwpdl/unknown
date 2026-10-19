import { useLanguage } from '@/hooks/use-language';
import { Image } from 'expo-image';
import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { CityPlace } from '@/lib/city-places';

const bundledPhotos: Record<string, number> = {
  'ba8982d7e04fab85f39585935ee2c859c9dea7b25cdcf65b65475dfd6ded77f1': require('../../assets/images/city-places/montreal-osm-way-21258128.jpg'),
  'f65d0d310712633ff227c9c8687691c5ce8b48ebde506ffee3216782d50a3eeb': require('../../assets/images/city-places/calgary-osm-way-496824026.jpg'),
  '2f87f5fff70d48bd2a04b635dec36dc7982b43fb7e65f8214c9bf61fbfc5e597': require('../../assets/images/city-places/edmonton-osm-way-582712469.jpg'),
  '0293e4fc007bb87e4326edab9fd17b36035713158bb5d38087e48f06300e721b': require('../../assets/images/city-places/saskatoon-osm-way-533217382.jpg'),
  'fec244321772d366cf3dd7815d53c1744429f10e61320d591150aa59017906de': require('../../assets/images/city-places/ottawa-osm-node-1735093018.jpg'),
  '19d00a784278bbc6ab0d5a6ef94958e81a8762b35ba4f685dda4810d10577aec': require('../../assets/images/city-places/saint-john-osm-relation-19244398.jpg'),
  '71958c060ee24183e67e6cbc6591ab80d393b6fb0ff82132fedf74d05fef7813': require('../../assets/images/city-places/vancouver-osm-way-58754861.jpg'),
  '619bf79140122c630249278b1f28bd8159aa68299e15819c54c65b20226b423a': require('../../assets/images/city-places/montreal-osm-way-87415559.jpg'),
  '163bd6013ee50c587b7dd159c3487391b9702b80e45b25540a9b0f6b8d58390a': require('../../assets/images/city-places/calgary-osm-way-1313657677.jpg'),
  'e35c8294dd1b95e7d713c658e1d1651a8d680d11ba63040b3daf3551922a8570': require('../../assets/images/city-places/winnipeg-osm-way-131229325.jpg'),
  'be18b5c89bd9f6744158c1210590769101b35c7e62eb694eb62052f16fb50033': require('../../assets/images/city-places/saskatoon-osm-way-630123772.jpg'),
  '84d8cff37476fe2b2b5c21942bda8ac41db0334ce2c39d0d639a8bcc4e1dbd74': require('../../assets/images/city-places/saskatoon-osm-way-298718480.jpg'),
};

export function CityPlacePhoto({ place, style }: { place: CityPlace; style?: StyleProp<ViewStyle> }) {
  const { tr } = useLanguage();
  const theme = useTheme(), [failedImage, setFailedImage] = useState<string | null>(null);
  const uri = place.photo?.uri;
  const localSource = place.photo ? bundledPhotos[place.photo.imageSha256] : undefined;
  const imageKey = localSource ? place.photo?.imageSha256 : uri;
  return <View style={[styles.frame, { backgroundColor: theme.backgroundElement }, style]}>
    {imageKey && failedImage !== imageKey
      ? <Image source={localSource ?? { uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk"
          recyclingKey={imageKey} transition={0} accessibilityLabel={tr("{0} 사진", (place.name))} onError={() => setFailedImage(imageKey)} />
      : <SymbolView name={{ ios: 'photo', android: 'image', web: 'image' }} size={24} tintColor={theme.textSecondary} />}
  </View>;
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
