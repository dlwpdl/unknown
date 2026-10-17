import assets from '../../assets/maps/maplibre.bundle.js';
import { mapCityCenter } from './post-map-html.ts';
import { TOP25_GOLD } from './discovery.ts';

export type DiscoveryMarker = { id: string; latitude: number; longitude: number; color: string; label: string; top25?: boolean };
type Center = { latitude: number; longitude: number; requestId?: number };
type MapState = { markers: DiscoveryMarker[]; selectedId?: string | null; center?: Center | null; bottomInset?: number };
type DiscoveryMessage = { type: 'ready' | 'error' | 'feedback' } | { type: 'select'; id: string } | { type: 'credits'; url: string };
const credits = ['https://openfreemap.org/', 'https://www.openmaptiles.org/', 'https://www.openstreetmap.org/copyright'];
const text = (value: unknown, length: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= length && !/[\u0000-\u001f\u007f]/.test(value);
const coordinate = (value: Center) => value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
  && (value.requestId === undefined || Number.isSafeInteger(value.requestId) && value.requestId >= 0);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function discoveryMarkers(markers: DiscoveryMarker[]): DiscoveryMarker[] {
  if (!Array.isArray(markers) || markers.length > 500) throw new Error('INVALID_DISCOVERY_MARKERS');
  const ids = new Set<string>();
  return markers.map(marker => {
    if (!marker || !text(marker.id, 180) || ids.has(marker.id) || typeof marker.label !== 'string' || marker.label.length > 80
      || !coordinate(marker) || typeof marker.color !== 'string' || !/^#[a-f\d]{6}$/i.test(marker.color)
      || (marker.top25 !== undefined && typeof marker.top25 !== 'boolean')) throw new Error('INVALID_DISCOVERY_MARKER');
    ids.add(marker.id);
    return { id: marker.id, latitude: marker.latitude, longitude: marker.longitude, color: marker.color, label: marker.label.replace(/[\u0000-\u001f\u007f]/g, ' '), ...(marker.top25 ? { top25: true } : {}) };
  });
}

function state({ markers, selectedId = null, center = null, bottomInset = 0 }: MapState) {
  if (selectedId !== null && !text(selectedId, 180)) throw new Error('INVALID_DISCOVERY_SELECTION');
  if (center !== null && !coordinate(center)) throw new Error('INVALID_DISCOVERY_CENTER');
  if (!Number.isFinite(bottomInset) || bottomInset < 0 || bottomInset > 1000) throw new Error('INVALID_DISCOVERY_INSET');
  return { markers: discoveryMarkers(markers), selectedId, center: center && { latitude: center.latitude, longitude: center.longitude, ...(center.requestId !== undefined ? { requestId: center.requestId } : {}) }, bottomInset };
}

export function discoveryMapMessage(raw: string, sessionId: string, markers: DiscoveryMarker[]): DiscoveryMessage | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const message = JSON.parse(raw);
    if (!message || message.sessionId !== sessionId) return null;
    if (['ready', 'error', 'feedback'].includes(message.type)) return { type: message.type };
    if (message.type === 'select' && text(message.id, 180) && markers.some(marker => marker.id === message.id)) return { type: 'select', id: message.id };
    if (message.type === 'credits' && credits.includes(message.url)) return { type: 'credits', url: message.url };
  } catch { /* The embedded map is an untrusted message boundary. */ }
  return null;
}

export function discoveryMapScript(update: MapState, sessionId: string) {
  if (!text(sessionId, 180)) throw new Error('INVALID_DISCOVERY_SESSION');
  return `window.glingDiscoveryUpdate?.(${json(sessionId)},${json(state(update))});true;`;
}

export function discoveryMapHtml({ markers, cityName, sessionId, selectedId = null, center = null, bottomInset = 0, accent = '#CBB9FF', parentOrigin = 'null', language = 'ko' }: MapState & {
  cityName: string; sessionId: string; accent?: string; parentOrigin?: string; language?: 'ko' | 'en';
}) {
  if (!text(sessionId, 180) || !['ko', 'en'].includes(language) || !/^#[a-f\d]{6}$/i.test(accent)) throw new Error('INVALID_DISCOVERY_CONFIG');
  if (parentOrigin !== 'null' && (!/^https?:\/\//.test(parentOrigin) || new URL(parentOrigin).origin !== parentOrigin)) throw new Error('INVALID_DISCOVERY_ORIGIN');
  const config = json({ ...state({ markers, selectedId, center, bottomInset }), cityCenter: mapCityCenter(cityName), sessionId, parentOrigin, credits });
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-gling-map' blob:; style-src 'unsafe-inline'; worker-src blob:; connect-src https://tiles.openfreemap.org; img-src data: blob: https://tiles.openfreemap.org; base-uri 'none'; form-action 'none'; object-src 'none'"><style>${assets.css}
html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#efeee9}.maplibregl-ctrl-top-right{top:12px;right:12px}.maplibregl-ctrl-group{border-radius:14px;overflow:hidden;box-shadow:0 2px 12px #3020471a}.maplibregl-ctrl-group button{width:44px;height:44px}.maplibregl-ctrl-group button:active{background:#ebe5f6}.maplibregl-ctrl-group button:focus-visible,#credits a:focus-visible{outline:3px solid ${accent};outline-offset:-3px}#credits{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:flex-end;flex-wrap:wrap;font:10px/1.3 system-ui;background:#fffffff0;color:#333;z-index:4}#credits a{color:#333;min-height:44px;display:inline-flex;align-items:center;padding:0 6px;box-sizing:border-box}#credits a:active{background:#ebe5f6}
</style></head><body><div id="map" aria-label="${language === 'en' ? 'City discovery map. Places are also available in the list.' : '도시 탐색 지도. 장소 목록에서도 선택할 수 있어요.'}"></div><div id="credits"><a href="https://openfreemap.org/">OpenFreeMap</a><a href="https://www.openmaptiles.org/">© OpenMapTiles</a><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a></div><script nonce="gling-map">${assets.javascript}</script><script nonce="gling-map">
const config=${config};let map,loaded=false,failed=false,current=config,previousSelection=null,previousCenter=null,previousPadding=null,revision=0;
const send=payload=>{const message=JSON.stringify({...payload,sessionId:config.sessionId});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(message);else window.parent.postMessage(message,config.parentOrigin==='null'?'*':config.parentOrigin)};
const fail=()=>{if(!failed){failed=true;send({type:'error'})}};
const validPoint=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&(p.requestId===undefined||Number.isSafeInteger(p.requestId)&&p.requestId>=0);
const validText=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\\u0000-\\u001f\\u007f]/.test(s);
const validState=s=>{if(!s||!Array.isArray(s.markers)||s.markers.length>500||(s.center!=null&&!validPoint(s.center))||(s.selectedId!=null&&!validText(s.selectedId,180))||(s.bottomInset!=null&&(!Number.isFinite(s.bottomInset)||s.bottomInset<0||s.bottomInset>1000)))return false;const ids=new Set();return s.markers.every(m=>{if(!m||!validText(m.id,180)||ids.has(m.id)||typeof m.label!=='string'||m.label.length>80||!validPoint(m)||typeof m.color!=='string'||!/^#[a-f\\d]{6}$/i.test(m.color)||(m.top25!==undefined&&typeof m.top25!=='boolean'))return false;ids.add(m.id);return true})};
const geojson=(selection=false)=>({type:'FeatureCollection',features:current.markers.filter(m=>!selection||m.id===current.selectedId).map(m=>({type:'Feature',geometry:{type:'Point',coordinates:[m.longitude,m.latitude]},properties:{id:m.id,label:m.label,color:m.color,top25:m.top25===true}}))});
const move=camera=>map.easeTo({...camera,duration:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:300});
const hitLayers=['discovery-selected-top25','discovery-selected-hit','discovery-selected-label','discovery-top25','discovery-clusters','discovery-hit','discovery-labels'];
const top25Filter=()=>['any',['all',['has','point_count'],['>',['coalesce',['get','top25Count'],0],0]],['all',['!',['has','point_count']],['==',['get','top25'],true],['!=',['get','id'],current.selectedId??'']]];
const ensureBadges=()=>{if(!current.markers.some(m=>m.top25))return;for(const full of [false,true]){const id=full?'top25-full':'top25-small';if(map.hasImage(id))continue;const canvas=document.createElement('canvas');canvas.width=full?148:44;canvas.height=36;const ctx=canvas.getContext('2d');if(!ctx)throw Error('TOP25_CANVAS');ctx.scale(2,2);ctx.fillStyle='${TOP25_GOLD}';ctx.fillRect(0,0,canvas.width/2,18);ctx.fillStyle='#342611';ctx.beginPath();for(const [i,p]of [[8,3],[10,7],[14,9],[10,11],[8,15],[6,11],[2,9],[6,7]].entries())i?ctx.lineTo(...p):ctx.moveTo(...p);ctx.closePath();ctx.fill();if(full){ctx.font='700 12px system-ui';ctx.textBaseline='middle';ctx.fillText('TOP 25',19,9)}map.addImage(id,ctx.getImageData(0,0,canvas.width,canvas.height),{pixelRatio:2})}};
const apply=()=>{if(!loaded)return;map.getSource('discovery').setData(geojson());map.getSource('discovery-selection').setData(geojson(true));
 ensureBadges();map.setFilter('discovery-top25',top25Filter());
 const bottom=Math.min(current.bottomInset||0,Math.max(0,map.getContainer().clientHeight-44)),paddingChanged=bottom!==previousPadding;
 if(paddingChanged){map.setPadding({top:0,right:0,left:0,bottom});previousPadding=bottom}
 map.setFilter('discovery-labels',['all',['!', ['has','point_count']],['!=',['get','id'],current.selectedId??'']]);
 const selected=current.markers.find(m=>m.id===current.selectedId),c=current.center;
 const changedCenter=c&&(!previousCenter||c.latitude!==previousCenter.latitude||c.longitude!==previousCenter.longitude||c.requestId!==previousCenter.requestId);
 if(c&&(changedCenter||paddingChanged))move({center:[c.longitude,c.latitude]});else if(selected&&(current.selectedId!==previousSelection||paddingChanged))move({center:[selected.longitude,selected.latitude]});
 previousSelection=current.selectedId;previousCenter=c&&{latitude:c.latitude,longitude:c.longitude,requestId:c.requestId};
};
window.glingDiscoveryUpdate=(sessionId,update)=>{if(sessionId!==config.sessionId||!validState(update))return;current=update;revision++;apply()};
window.addEventListener('message',e=>{if(e.source!==window.parent||e.origin!==config.parentOrigin||!e.data||e.data.type!=='discovery.update'||e.data.sessionId!==config.sessionId)return;window.glingDiscoveryUpdate(e.data.sessionId,e.data.state)});
document.addEventListener('click',e=>{const a=e.target.closest?.('#credits a');if(a){e.preventDefault();if(config.credits.includes(a.href)){send({type:'feedback'});send({type:'credits',url:a.href})}}else if(e.target.closest?.('.maplibregl-ctrl-group button'))send({type:'feedback'})});
try{
 map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/positron',center:config.center?[config.center.longitude,config.center.latitude]:config.cityCenter,zoom:11,attributionControl:false});
 window.glingMap=map;
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
 const timer=setTimeout(fail,15000);
 map.on('load',()=>{try{
  ensureBadges();
  map.addSource('discovery',{type:'geojson',data:geojson(),cluster:true,clusterMaxZoom:16,clusterRadius:44,clusterProperties:{top25Count:['+',['case',['get','top25'],1,0]]}});
  map.addSource('discovery-selection',{type:'geojson',data:geojson(true)});
  map.addLayer({id:'discovery-clusters',type:'circle',source:'discovery',filter:['has','point_count'],paint:{'circle-radius':22,'circle-color':'#f8f6fc','circle-stroke-color':'#9283ac','circle-stroke-width':2}});
  map.addLayer({id:'discovery-counts',type:'symbol',source:'discovery',filter:['has','point_count'],layout:{'text-field':'{point_count_abbreviated}','text-font':['Noto Sans Regular'],'text-size':14,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#302047'}});
  map.addLayer({id:'discovery-pins',type:'circle',source:'discovery',filter:['!', ['has','point_count']],paint:{'circle-radius':11,'circle-color':['get','color'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
  map.addLayer({id:'discovery-labels',type:'symbol',source:'discovery',filter:['!', ['has','point_count']],layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':12,'text-anchor':'left','text-offset':[2,0],'text-max-width':14,'text-padding':4},paint:{'text-color':'#302047','text-halo-color':'#ffffff','text-halo-width':2}});
  map.addLayer({id:'discovery-hit',type:'circle',source:'discovery',filter:['!', ['has','point_count']],paint:{'circle-radius':22,'circle-opacity':0}});
  map.addLayer({id:'discovery-top25',type:'symbol',source:'discovery',filter:top25Filter(),layout:{'icon-image':'top25-small','icon-offset':['case',['has','point_count'],['literal',[18,-18]],['literal',[12,-12]]],'icon-allow-overlap':true,'icon-ignore-placement':true}});
  map.addLayer({id:'discovery-selected',type:'circle',source:'discovery-selection',paint:{'circle-radius':17,'circle-color':'#ffffff','circle-stroke-color':'${accent}','circle-stroke-width':4}});
  map.addLayer({id:'discovery-selected-pin',type:'circle',source:'discovery-selection',paint:{'circle-radius':11,'circle-color':['get','color'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
  map.addLayer({id:'discovery-selected-label',type:'symbol',source:'discovery-selection',layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':12,'text-anchor':'left','text-offset':[2,0],'text-max-width':14,'text-allow-overlap':true},paint:{'text-color':'#302047','text-halo-color':'#ffffff','text-halo-width':2}});
  map.addLayer({id:'discovery-selected-hit',type:'circle',source:'discovery-selection',paint:{'circle-radius':22,'circle-opacity':0}});
  map.addLayer({id:'discovery-selected-top25',type:'symbol',source:'discovery-selection',filter:['==',['get','top25'],true],layout:{'icon-image':'top25-full','icon-anchor':'left','icon-offset':[21,-19],'icon-allow-overlap':true,'icon-ignore-placement':true}});
  clearTimeout(timer);loaded=true;failed=false;
  apply();send({type:'ready'});
 }catch{fail()}});
 map.on('error',()=>{if(!loaded)fail()});
 map.on('click',async e=>{if(!loaded)return;const hit=map.queryRenderedFeatures(e.point,{layers:hitLayers})[0];if(!hit)return;
  if(hit.properties?.point_count){send({type:'feedback'});const version=revision;try{const zoom=await map.getSource('discovery').getClusterExpansionZoom(hit.properties.cluster_id);if(version===revision&&Number.isFinite(zoom))move({center:hit.geometry.coordinates,zoom:Math.min(zoom,18)})}catch{fail()}}
  else if(current.markers.some(m=>m.id===hit.properties?.id)){send({type:'feedback'});send({type:'select',id:hit.properties.id})}
 });
 map.on('mousemove',e=>{if(loaded)map.getCanvas().style.cursor=map.queryRenderedFeatures(e.point,{layers:hitLayers}).length?'pointer':''});
}catch{fail()}
</script></body></html>`;
}
