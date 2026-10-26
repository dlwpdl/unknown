import assets from '../../assets/maps/maplibre.bundle.js';
import { getLocale, tr } from '../i18n/index.ts';
import { googlePinUrl, type PostPin } from './post-maps.ts';

const credits = ['https://openfreemap.org/', 'https://www.openmaptiles.org/', 'https://www.openstreetmap.org/copyright'];
const centers: Record<string, [number, number]> = {
  Vancouver: [49.28, -123.12], Toronto: [43.65, -79.38], Montréal: [45.5, -73.57], Calgary: [51.05, -114.07],
  Edmonton: [53.55, -113.49], Winnipeg: [49.9, -97.14], Saskatoon: [52.16, -106.67], Ottawa: [45.42, -75.7],
  Regina: [50.45, -104.62], 'Saint John': [45.27, -66.06], Halifax: [44.65, -63.58],
};
export function mapCityCenter(cityName: string): [number, number] {
  const [latitude, longitude] = Object.hasOwn(centers, cityName) ? centers[cityName] : centers.Vancouver;
  return [longitude, latitude];
}
type MapMessage = { type: 'pick'; pin: PostPin; label: string } | { type: 'ready' | 'error' | 'feedback' }
  | { type: 'credit'; url: string } | { type: 'snapshot'; uri: string };
const snapshot = (uri: unknown): uri is string => typeof uri === 'string' && uri.length <= 290000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri);

export function mapMessage(raw: string): MapMessage | null {
  if (raw.length > 300000) return null;
  try {
    const message = JSON.parse(raw);
    if (message.type === 'pick') {
      googlePinUrl(message.pin);
      const label = typeof message.label === 'string' ? message.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) : '';
      return { type: 'pick', pin: { latitude: message.pin.latitude, longitude: message.pin.longitude }, label };
    }
    if (['ready', 'error', 'feedback'].includes(message.type)) return { type: message.type };
    if (message.type === 'credit' && credits.includes(message.url)) return { type: 'credit', url: message.url };
    if (message.type === 'snapshot' && snapshot(message.uri)) return { type: 'snapshot', uri: message.uri };
  } catch { /* WebView messages are untrusted. */ }
  return null;
}

export const mapPreviews = new Map<string, string>();
export function rememberMapPreview(key: string, uri: string) {
  if (!snapshot(uri)) throw new Error('INVALID_MAP_PREVIEW');
  mapPreviews.delete(key); mapPreviews.set(key, uri);
  if (mapPreviews.size > 24) mapPreviews.delete(mapPreviews.keys().next().value!);
}

export function mapPinScript(pin: PostPin | null, bottomInset = 0) {
  if (!Number.isFinite(bottomInset) || bottomInset < 0 || bottomInset > 1000) throw new Error('INVALID_MAP_INSET');
  if (pin) googlePinUrl(pin);
  return `window.glingSetInset?.(${bottomInset});window.glingSetPin?.(${JSON.stringify(pin && { latitude: pin.latitude, longitude: pin.longitude })});true;`;
}

export function mapHtml({ pin, cityName = '', preview = false, accent = '#CBB9FF', bottomInset = 0 }: { pin: PostPin | null; cityName?: string; preview?: boolean; accent?: string; bottomInset?: number }) {
  if (!/^#[a-f\d]{6}$/i.test(accent)) throw new Error('INVALID_MAP_COLOR');
  if (!Number.isFinite(bottomInset) || bottomInset < 0 || bottomInset > 1000) throw new Error('INVALID_MAP_INSET');
  if (pin) googlePinUrl(pin);
  const [longitude, latitude] = mapCityCenter(cityName);
  const config = JSON.stringify({ pin: pin && { latitude: pin.latitude, longitude: pin.longitude }, center: [pin?.longitude ?? longitude, pin?.latitude ?? latitude], preview, accent });
  return `<!doctype html><html lang="${getLocale().slice(0, 2)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-gling-map' blob:; style-src 'unsafe-inline'; worker-src blob:; connect-src https://tiles.openfreemap.org; img-src data: blob: https://tiles.openfreemap.org; base-uri 'none'; form-action 'none'; object-src 'none'"><style>${assets.css}
html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#dedbcf}.maplibregl-ctrl-top-right{top:${preview ? 0 : 74}px}.maplibregl-ctrl-bottom-right{bottom:${bottomInset}px}.maplibregl-ctrl-group button{width:44px;height:44px}#credits{display:${preview ? 'none' : 'block'};position:absolute;right:0;bottom:0;max-width:100%;font:9px/1.5 system-ui;background:#fffffff0;color:#333;z-index:4;padding:2px 4px}#credits a{color:#333}.pin{width:34px;height:44px;cursor:grab}.pin::before{content:'';position:absolute;left:3px;top:1px;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;background:${accent};box-shadow:0 2px 6px #0003}.pin::after{content:'';position:absolute;left:13px;top:11px;width:8px;height:8px;border-radius:50%;background:#302047}
</style></head><body><div id="map" aria-label="${tr('지도에서 위치 선택')}"></div><div id="credits"><a href="https://openfreemap.org/">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a></div><script nonce="gling-map">${assets.javascript}</script><script nonce="gling-map">
const config=${config};let map,marker,pin=config.pin,failed=false,snapped=false,snapshotUri=null;
const send=(payload)=>{const text=JSON.stringify(payload);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(text);else window.parent.postMessage(text,'*')};
const valid=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
const fail=()=>{if(!failed){failed=true;send({type:'error'})}};
window.glingSetPin=p=>{if(snapshotUri){send({type:'snapshot',uri:snapshotUri});return}if(p!==null&&!valid(p))return;pin=p;if(!map)return;if(marker){marker.remove();marker=null}if(pin&&!config.preview){const el=document.createElement('div');el.className='pin';marker=new maplibregl.Marker({element:el,anchor:'bottom',draggable:true}).setLngLat([pin.longitude,pin.latitude]).addTo(map);marker.on('dragend',()=>{const ll=marker.getLngLat().wrap();pin={latitude:ll.lat,longitude:ll.lng};send({type:'pick',pin,label:''})})}if(pin)map.jumpTo({center:[pin.longitude,pin.latitude]});if(map.isStyleLoaded())send({type:'ready'})};
window.glingSetInset=n=>{if(Number.isFinite(n)&&n>=0&&n<=1000){const control=document.querySelector('#credits');if(control)control.style.bottom=n+'px'}};
window.addEventListener('message',e=>{if(e.source!==window.parent||!e.data||e.data.type!=='move')return;window.glingSetPin(e.data.pin);window.glingSetInset(e.data.bottomInset)});
document.addEventListener('click',e=>{const a=e.target.closest?.('#credits a');if(a){e.preventDefault();send({type:'credit',url:a.href})}else if(e.target.closest?.('.maplibregl-ctrl-group button'))send({type:'feedback'})});
try{
 map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/positron',center:config.center,zoom:config.preview?14.5:15,interactive:!config.preview,attributionControl:false,canvasContextAttributes:{preserveDrawingBuffer:config.preview},pixelRatio:config.preview?1.5:undefined});
 window.glingMap=map;
 if(!config.preview)map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
 const timer=setTimeout(fail,15000);
 map.on('load',()=>{clearTimeout(timer);failed=false;window.glingSetPin(pin);send({type:'ready'})});
 map.on('error',()=>{if(!map.isStyleLoaded())fail()});
 if(!config.preview)map.on('click',e=>{const poi=map.queryRenderedFeatures(e.point).find(f=>f.layer.type==='symbol'&&/poi/i.test(f.layer.id));const coordinate=poi?.geometry?.type==='Point'?poi.geometry.coordinates:null;const ll=coordinate&&Number.isFinite(coordinate[0])&&Number.isFinite(coordinate[1])&&Math.abs(coordinate[1])<=90?new maplibregl.LngLat(coordinate[0],coordinate[1]).wrap():e.lngLat.wrap();pin={latitude:ll.lat,longitude:ll.lng};window.glingSetPin(pin);send({type:'pick',pin,label:poi?.properties?.name||poi?.properties?.['name:en']||''})});
 if(config.preview)map.on('idle',()=>{if(snapped||!pin)return;snapped=true;try{
  const original=map.getCanvas(),canvas=document.createElement('canvas');canvas.width=original.width;canvas.height=original.height;const ctx=canvas.getContext('2d');ctx.drawImage(original,0,0);
  const ratio=canvas.width/map.getContainer().clientWidth,point=map.project([pin.longitude,pin.latitude]);ctx.save();ctx.scale(ratio,ratio);ctx.translate(point.x,point.y);ctx.fillStyle=config.accent;ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-17,12,Math.PI*.75,Math.PI*2.25);ctx.lineTo(0,1);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(0,-17,4,0,Math.PI*2);ctx.fillStyle='#302047';ctx.fill();ctx.restore();
  const uri=canvas.toDataURL('image/jpeg',.7);if(uri.length>290000){fail();map.remove();return}snapshotUri=uri;send({type:'snapshot',uri});map.remove();
 }catch{fail();map.remove()}});
}catch{fail()}
</script></body></html>`;
}
