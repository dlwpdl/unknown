import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export function FestivalVideo({ youtubeId, ambient = false, muted = false, visible = true, onPlaying, onError }: { youtubeId: string; ambient?: boolean; muted?: boolean; visible?: boolean; onPlaying?: () => void; onError?: () => void }) {
  const source = useMemo(() => ({
    html: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}iframe{position:absolute;left:50%;top:50%;width:${ambient ? '177.78vh' : '100vw'};height:100vh;transform:translate(-50%,-50%);border:0}</style></head><body><iframe id="player" src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=${ambient || muted ? 1 : 0}&playsinline=1&loop=${ambient ? 1 : 0}&playlist=${youtubeId}&controls=${ambient ? 0 : 1}&enablejsapi=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture"></iframe><script src="https://www.youtube.com/iframe_api"></script><script>function onYouTubeIframeAPIReady(){new YT.Player('player',{events:{onReady:function(e){${ambient || muted ? 'e.target.mute();' : ''}e.target.playVideo()},onStateChange:function(e){if(e.data===1)window.ReactNativeWebView.postMessage('playing')},onError:function(){window.ReactNativeWebView.postMessage('error')}}})}</script></body></html>`,
    baseUrl: 'https://www.youtube-nocookie.com',
  }), [ambient, muted, youtubeId]);

  return <View style={[styles.video, { opacity: visible ? 1 : 0 }]} pointerEvents={ambient ? 'none' : 'auto'}>
    <WebView source={source} style={styles.player} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} scrollEnabled={false} bounces={false} onMessage={message => { if (message.nativeEvent.data === 'playing') onPlaying?.(); else if (message.nativeEvent.data === 'error') onError?.(); }} onError={onError} accessible={!ambient} accessibilityLabel={ambient ? undefined : '행사 영상 재생'} />
  </View>;
}

const styles = StyleSheet.create({ video: { ...StyleSheet.absoluteFill, zIndex: 1, backgroundColor: '#111' }, player: { flex: 1, backgroundColor: '#111' } });
