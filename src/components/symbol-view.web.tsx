import { lazy, Suspense } from 'react';
import { View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

// expo-symbols carries a ~100 KB symbol name table. Public pages draw no symbol, so on web it loads on first use;
// the fallback is the same sized empty box SymbolView itself shows until its font loads.
const LazySymbolView = lazy(() => import('expo-symbols').then(module => ({ default: module.SymbolView })));

export function SymbolView(props: SymbolViewProps) {
  const size = props.size ?? 24;
  return <Suspense fallback={<View style={[{ width: size, height: size }, props.style]} />}><LazySymbolView {...props} /></Suspense>;
}
