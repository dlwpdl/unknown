import { useLanguage } from '@/hooks/use-language';
import { Image } from 'expo-image';
import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { CityPlace } from '@/lib/city-places';

const bundledPhotos: Record<string, number> = {
  '0fb32d52c022465828f0fbede9cb92feeb82d28455aaa24d5759338e63b50ed7': require('../../assets/images/city-places/vancouver-osm-node-12620960872.jpg'),
  '1460af2a3f295835b78f252a27ebafb5acd4a705f3e0390ce996f4f5ebe86b15': require('../../assets/images/city-places/vancouver-osm-way-37084312.jpg'),
  '898aeeb771b2c9c70c09c0e834ffb1595210d842d733cda6d6051e6d91dd94f8': require('../../assets/images/city-places/vancouver-osm-way-316008597.jpg'),
  '81f4f45a8ab6a918af113c85a7cfa5312fcbc62ada0a4776b8a94fe551fbe20e': require('../../assets/images/city-places/saint-john-osm-way-827160392.jpg'),
  'ba99ed62513c41ae631272e7f640c9595033f3f8aef44048bb33fb2f93bf9064': require('../../assets/images/city-places/winnipeg-osm-way-1055784750.jpg'),
  '0b64f3ad345109b16a30e174cee5f8be2336c4af0396c197b94cb60a95163f2e': require('../../assets/images/city-places/ottawa-osm-way-639268732.jpg'),
  '6d097e06fcbd03cb0d46aa157de26e45af72889e5368be57e769e96f8416330a': require('../../assets/images/city-places/montreal-osm-way-26288030.jpg'),
  'fd03f1a124c02ebeb29f619d08f64b203ab83ccc4fa8bbe974f40ebf9ed03b0e': require('../../assets/images/city-places/ottawa-osm-node-7127264485.jpg'),
  '73c988bbf041d0757d2ef1497298ee5fe78ffa68823a3e807e1a635a83e36a38': require('../../assets/images/city-places/edmonton-osm-way-42782487.jpg'),
  '810a673f3242addd9f39c9117d600f1ad6b6b6af90324051fb51c55af9fb48bd': require('../../assets/images/city-places/toronto-osm-way-33408232.jpg'),
  '8ee0b5a7935af0b02c63db7289af9864ab03e0d891ce0b3fc956cd462391e7c6': require('../../assets/images/city-places/vancouver-osm-way-37111640.jpg'),
  'dbc6bff38946aea07917f38ac4cc7f8fa91ad327ba48513f056fd88333fbc043': require('../../assets/images/city-places/toronto-osm-way-300884214.jpg'),
  '62acda4444a055640329aa98c998e8074caf1bc64e8551910dc063a03fb81c86': require('../../assets/images/city-places/saskatoon-osm-node-2828091482.jpg'),
  'e5c89798d26e51b6176be0b124d5bae80578dedd49edecd19ef9674906f01428': require('../../assets/images/city-places/halifax-osm-node-850115195.jpg'),
  '74cad06fd74c0d009b25be9295613ff46510a51265bef2e694be556171edcde0': require('../../assets/images/city-places/saint-john-osm-way-759602407.jpg'),
  '855e25f4b81fd5c70929ef893c8ff0b06484dd0754e166346e63b05fb5a15791': require('../../assets/images/city-places/vancouver-osm-way-23393985.jpg'),
  '8bb0dd3514ba8e32112e15597bd90bf45d8d43c41b05eed708571cf72fe57b88': require('../../assets/images/city-places/halifax-osm-way-915518387.jpg'),
  'be2fd76cbeb4c371ba7cb43e74fbd8695f54591e10129b37c22ba3d7c3e99bf0': require('../../assets/images/city-places/montreal-osm-way-1097403710.jpg'),
  'a4db0b2866192f3d1683317fca3a58dd4cccf326f3db46cc4a15f0254e8fd023': require('../../assets/images/city-places/toronto-osm-node-368385388.jpg'),
  '84abbde8b57a93722c13940c136a778416d9ddcd7a134d8c374e7bb270325d47': require('../../assets/images/city-places/toronto-osm-node-256351459.jpg'),
  '3e270ddc51588b0fe78cf1a08ac3b2b633956d41b762b0585c199882c1cee362': require('../../assets/images/city-places/toronto-osm-node-214312074.jpg'),
  '41cbc515b9a41ae9a86d798850b79ef2685efa1ab8f61115a1d564ffaffaf81d': require('../../assets/images/city-places/toronto-osm-node-277039070.jpg'),
  '16178871b7f4be9f86f53a744b2472c01e41a2a98b742b111a762dcc31c82e20': require('../../assets/images/city-places/toronto-osm-node-281927817.jpg'),
  '33a8e658a327dccda65d8acf65d6ce797945cd7e795d3eb0c2e05306bbb0ed00': require('../../assets/images/city-places/regina-osm-way-285051056.jpg'),
  '158a51897dad1e2a28bb6f009ca46d96206ec0ea848eb27f7e218cff37aa0816': require('../../assets/images/city-places/vancouver-osm-node-1856357128.jpg'),
  'e93829f86a33a0c10c459f032c6a7759a1244c6d23529f49797c793c35599266': require('../../assets/images/city-places/winnipeg-osm-way-306150488.jpg'),
  'd51cecc791da9d38a614020d1b3e037a01435405b730a60d22f405dfaad23447': require('../../assets/images/city-places/halifax-osm-node-4422934789.jpg'),
  'f79eaff069d36e9ea72a31a71f92d668f6c3f55de7c3c5ec584c278d32c08c29': require('../../assets/images/city-places/montreal-osm-way-182750657.jpg'),
  '20b982b9eb93c9ba3b0802e563f31d5d344d00db2025a2f47d9e31aa177f3130': require('../../assets/images/city-places/toronto-osm-way-198500757.jpg'),
  'b6ce2a6300607179077be91433325bb010af9436aba0a3c106a41e0ee0978afa': require('../../assets/images/city-places/edmonton-osm-relation-9911642.jpg'),
  '9ab3212823b931b51cad440f1953146da320000ad2f6639b7092de9d36ff9766': require('../../assets/images/city-places/toronto-osm-way-14344414.jpg'),
  '341dbc62a058cf2831e29f0823ed10f3fc7c33eeb6d2ec3ad72afdf03bc2d36b': require('../../assets/images/city-places/regina-osm-way-71153155.jpg'),
  'f4852a8fea2faeca1a056bef7d7c85e916fe6469813cf9a22105efcf92a91b8e': require('../../assets/images/city-places/edmonton-osm-relation-17644228.jpg'),
  '532178cf153be94d411d6fbcbbfb2c2a7cf59847f5d8a7d09b2ba3a44287565d': require('../../assets/images/city-places/winnipeg-osm-node-639365682.jpg'),
  'c98a870e82ac8e32002442dd06dc588d7949bd4eeebc42f72b9b609d79272966': require('../../assets/images/city-places/saskatoon-osm-way-256402002.jpg'),
  'e81f9c4801620edb6b328c56ba77a394144e5c0bfd1e4ae714305379975e3d61': require('../../assets/images/city-places/toronto-osm-way-189780702.jpg'),
  'be18b5c89bd9f6744158c1210590769101b35c7e62eb694eb62052f16fb50033': require('../../assets/images/city-places/saskatoon-osm-way-630123772.jpg'),
  '84d8cff37476fe2b2b5c21942bda8ac41db0334ce2c39d0d639a8bcc4e1dbd74': require('../../assets/images/city-places/saskatoon-osm-way-298718480.jpg'),
  '2f87f5fff70d48bd2a04b635dec36dc7982b43fb7e65f8214c9bf61fbfc5e597': require('../../assets/images/city-places/edmonton-osm-way-582712469.jpg'),
  '0293e4fc007bb87e4326edab9fd17b36035713158bb5d38087e48f06300e721b': require('../../assets/images/city-places/saskatoon-osm-way-533217382.jpg'),
  'fec244321772d366cf3dd7815d53c1744429f10e61320d591150aa59017906de': require('../../assets/images/city-places/ottawa-osm-node-1735093018.jpg'),
  '71958c060ee24183e67e6cbc6591ab80d393b6fb0ff82132fedf74d05fef7813': require('../../assets/images/city-places/vancouver-osm-way-58754861.jpg'),
  '619bf79140122c630249278b1f28bd8159aa68299e15819c54c65b20226b423a': require('../../assets/images/city-places/montreal-osm-way-87415559.jpg'),
  '163bd6013ee50c587b7dd159c3487391b9702b80e45b25540a9b0f6b8d58390a': require('../../assets/images/city-places/calgary-osm-way-1313657677.jpg'),
  'f65d0d310712633ff227c9c8687691c5ce8b48ebde506ffee3216782d50a3eeb': require('../../assets/images/city-places/calgary-osm-way-496824026.jpg'),
  '19d00a784278bbc6ab0d5a6ef94958e81a8762b35ba4f685dda4810d10577aec': require('../../assets/images/city-places/saint-john-osm-relation-19244398.jpg'),
  'e35c8294dd1b95e7d713c658e1d1651a8d680d11ba63040b3daf3551922a8570': require('../../assets/images/city-places/winnipeg-osm-way-131229325.jpg'),
  'ba8982d7e04fab85f39585935ee2c859c9dea7b25cdcf65b65475dfd6ded77f1': require('../../assets/images/city-places/montreal-osm-way-21258128.jpg'),
  'e20cf3d6614613b2c0d79b900c6bed926f58bc2040d3e5b20b7aff493b26517e': require('../../assets/images/city-places/vancouver-osm-node-703754423.jpg'),
  '0658a06eef7916f64aa26c0c1bac130a193766d3790dea4c50e9fc88fd5f7e41': require('../../assets/images/city-places/winnipeg-osm-node-343302576.jpg'),
  '238d6410877a246221d092c5aa85f200bdfe0a571aec894015085822d66c47d0': require('../../assets/images/city-places/calgary-osm-node-91101395.jpg'),
  '50f42d7d627f37cd8481ab207c4aab8ff361eea0281cb6c51963ca09fa1a5f6d': require('../../assets/images/city-places/winnipeg-osm-node-273549349.jpg'),
  'b99986f43aa6f9e74e89e73d3b2bde2e1f3ae3d022f94b7667370fb19dcb945f': require('../../assets/images/city-places/calgary-osm-node-577280929.jpg'),
  'bf2f349231d41293e72b246a563a75e3f9867d43bdf2d6c0bf8e260ffb75273c': require('../../assets/images/city-places/ottawa-osm-node-955338405.jpg'),
  '015c797bcccd1d18e905830102ff73dcafbe73f42308825b35ad91cda5c9da68': require('../../assets/images/city-places/halifax-osm-node-26286235.jpg'),
  'adc3ee207c08d9bbacc2cb248835f5c564144f4c0feb48b10abcd404444d52af': require('../../assets/images/city-places/halifax-osm-node-850025611.jpg'),
  'f3b6670acbcffd5c387140df4a593127df9d323042dfdbc447f9103a853eb587': require('../../assets/images/city-places/ottawa-osm-node-1020933664.jpg'),
  '0793398b02062711847addc0c7575b4c59fe37138736861df2a178f5c688e5ff': require('../../assets/images/city-places/calgary-osm-node-4365625291.jpg'),
  '0a048b5931c279d239debd46f7a772eff8a83db866445f33e08645e6144043f6': require('../../assets/images/city-places/regina-osm-node-7176377989.jpg'),
  '7c78a47151f6dec1b1f2487ad02ec3ee737a1f0f98302d2935426ff8ec0dbcec': require('../../assets/images/city-places/saint-john-osm-node-1867466385.jpg'),
  '27459770bbe67ff22cc01eed1d906397d75ae54093c8c2570027de6454200810': require('../../assets/images/city-places/vancouver-osm-node-648735254.jpg'),
  '1bfc2d2240961824e680d8d4888dda2263a053cf2bad90e81a8a5dfd94254a20': require('../../assets/images/city-places/montreal-osm-node-465633306.jpg'),
  'c9b65003a3d91d005cbf6f68e0aede95c76280f7b53e1b4b6a32f8cd4aeba993': require('../../assets/images/city-places/regina-osm-node-847186673.jpg'),
  '64c925be5b54d005fce699c8f14acfda503418402f2188899e13b7a9e3674fff': require('../../assets/images/city-places/saint-john-osm-node-1867466143.jpg'),
  '3e6109bfc983c7cb0c6a7599be655083874da61849882c77f32e747eb9cac3c3': require('../../assets/images/city-places/edmonton-osm-node-4263896991.jpg'),
  '855738ca6ad86244a11f5262acbdcb83f5ba2b3177eabfc780ba6d289f7bf35d': require('../../assets/images/city-places/vancouver-osm-node-2410285536.jpg'),
  'dd4c79aedd45831d0bb419891d24999d0060c95e3446b543da1eb148f7593cdb': require('../../assets/images/city-places/saskatoon-osm-node-12763046253.jpg'),
  '37808d3cde2007aeab723a61e37893c4419db98a6cbd7995f39558374a326d84': require('../../assets/images/city-places/winnipeg-osm-node-343302468.jpg'),
  '69418c0abc0a3fdfec32397363a0b2f0af923562772b219e154850cf3097c163': require('../../assets/images/city-places/ottawa-osm-node-292324492.jpg'),
  'ec835a8ddaa573ad9df327a7fe346567f9469d851de13af7e08369d4d03ddbb5': require('../../assets/images/city-places/montreal-osm-node-343490371.jpg'),
  'b73b614f89b793d3cd92a48b63b5e32542edf51f3059d6422a1198d72c756436': require('../../assets/images/city-places/edmonton-osm-node-4546582742.jpg'),
  '6c35d59d4c72d91f7ebe3f3ec37077e1e3ccba2df27b7907e2e1b61d9212f2b7': require('../../assets/images/city-places/saint-john-osm-node-1201111529.jpg'),
  '0a562ca4b2cf29fad5821241feafecd71af0097bbb812e46b1d94cdd6f4cba4e': require('../../assets/images/city-places/regina-osm-node-2445317517.jpg'),
  '7c2ea2990602eb87836d7714cba91185dc5165e28509c2a8272a4a7deb058d88': require('../../assets/images/city-places/edmonton-osm-node-4546582741.jpg'),
  'da5c364c1cfddf4a335de1290c7f300cd9ca7fb485faa5ade5b88c202cc3612c': require('../../assets/images/city-places/halifax-osm-node-962125376.jpg'),
  '133bde09076e99c70ff37b38ff9e3475c43a3288ca269cd9a869da80758c246e': require('../../assets/images/city-places/montreal-osm-node-213716077.jpg'),
  'f40f5168bc6add3b519ad7660fb36dd30911bc3e46361a740d379305b50e6414': require('../../assets/images/city-places/saskatoon-osm-node-9697113058.jpg'),
  'd26c34d60089aa9e011959842eda0cde5065fd6b4b3f7f9fbe5a5826f9a3ed8f': require('../../assets/images/city-places/montreal-osm-node-333465990.jpg'),
  'd93c1c3a5c84d4c8af32f1920c53def616c8e110ba39cea39a48dec81ae946fb': require('../../assets/images/city-places/saskatoon-osm-node-4198123589.jpg'),
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
