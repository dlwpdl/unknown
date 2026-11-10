import assets from '../../assets/maps/maplibre.bundle.js';
import { mapCityCenter } from './post-map-html.ts';
import { TOP25_GOLD } from './discovery.ts';
import { MAP_PIN_ART } from './map-pin-art.ts';
import { MAP_ZOOM_ART } from './map-zoom-art.ts';

// `icon` names the category's 3D art (MAP_PIN_ART): up close the pin is that picture in a white circle, further out a category-coloured dot.
// `saved` marks a place the viewer saved (M5, owner 2026-11-05): a small bookmark at the pin's top right.
// `statusColor` is the place's state (M1, owner 2026-11-05): a small dot at the pin's bottom right, with the word on its second line.
export type DiscoveryMarker = { id: string; latitude: number; longitude: number; color: string; label: string; sublabel?: string; featured?: boolean; icon?: string; top25?: boolean; discount?: number; saved?: boolean; statusColor?: string };
/** A city pill for the far zoom stage. Only open cities can be tapped. */
export type DiscoveryCity = { id: string; name: string; englishName: string; open: boolean };
type Center = { latitude: number; longitude: number; requestId?: number };
// `heading` is the phone's facing direction in degrees from north (M7); null keeps the plain location dot.
type MapState = { markers: DiscoveryMarker[]; cities?: DiscoveryCity[]; selectedId?: string | null; center?: Center | null; userLocation?: { latitude: number; longitude: number } | null; heading?: number | null; bottomInset?: number; topInset?: number };
type MapUpdate = Omit<MapState, 'markers' | 'cities'> & { markers?: DiscoveryMarker[] };
export type DiscoveryBounds = { west: number; south: number; east: number; north: number };
type DiscoveryMessage = { type: 'ready' | 'error' | 'feedback' } | { type: 'select'; id: string } | { type: 'credits'; url: string } | { type: 'moved'; bounds: DiscoveryBounds; zoom?: number } | { type: 'city'; id: string };
const credits = ['https://openfreemap.org/', 'https://www.openmaptiles.org/', 'https://www.openstreetmap.org/copyright'];
const text = (value: unknown, length: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= length && !/[\u0000-\u001f\u007f]/.test(value);
const coordinate = (value: Center) => value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
  && (value.requestId === undefined || Number.isSafeInteger(value.requestId) && value.requestId >= 0);
// Zoom stages: near shows every name with its second line, mid shows dots with only featured names, far shows city pills.
// GROUP: the last zoom where crowded ordinary places fold into a count (owner 2026-11-08 지도 렉 "가까이 묶기: 줌 14까지 묶기"); TOP 50 folds only among itself (discovery-top); visited, saved, discount and chosen places stay single.
const NEAR = 13, FAR = 8, GROUP = 14;
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function discoveryMarkers(markers: DiscoveryMarker[]): DiscoveryMarker[] {
  if (!Array.isArray(markers) || markers.length > 500) throw new Error('INVALID_DISCOVERY_MARKERS');
  const ids = new Set<string>();
  return markers.map(marker => {
    if (!marker || !text(marker.id, 180) || ids.has(marker.id) || typeof marker.label !== 'string' || marker.label.length > 80
      || !coordinate(marker) || typeof marker.color !== 'string' || !/^#[a-f\d]{6}$/i.test(marker.color)
      || (marker.sublabel !== undefined && (typeof marker.sublabel !== 'string' || marker.sublabel.length > 40)) || (marker.featured !== undefined && typeof marker.featured !== 'boolean')
      || (marker.icon !== undefined && (typeof marker.icon !== 'string' || !/^[a-z][a-z0-9_-]{0,23}$/.test(marker.icon)))
      || (marker.top25 !== undefined && typeof marker.top25 !== 'boolean') || (marker.saved !== undefined && typeof marker.saved !== 'boolean') || (marker.statusColor !== undefined && (typeof marker.statusColor !== 'string' || !/^#[a-f\d]{6}$/i.test(marker.statusColor))) || (marker.discount !== undefined && (!Number.isFinite(marker.discount) || marker.discount <= 0 || marker.discount > 100))) throw new Error('INVALID_DISCOVERY_MARKER');
    ids.add(marker.id);
    const sublabel = marker.sublabel?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return { id: marker.id, latitude: marker.latitude, longitude: marker.longitude, color: marker.color, label: marker.label.replace(/[\u0000-\u001f\u007f]/g, ' '), ...(sublabel ? { sublabel } : {}), ...(marker.featured ? { featured: true } : {}), ...(marker.icon ? { icon: marker.icon } : {}), ...(marker.top25 ? { top25: true } : {}), ...(marker.discount ? { discount: marker.discount } : {}), ...(marker.saved ? { saved: true } : {}), ...(marker.statusColor ? { statusColor: marker.statusColor } : {}) };
  });
}

function cityPills(cities: DiscoveryCity[], cityName: string) {
  if (!Array.isArray(cities) || cities.length > 20) throw new Error('INVALID_DISCOVERY_CITIES');
  return cities.map(city => {
    if (!city || typeof city.id !== 'string' || !/^[a-z][a-z-]{0,23}$/.test(city.id) || !text(city.name, 40) || !text(city.englishName, 40) || typeof city.open !== 'boolean') throw new Error('INVALID_DISCOVERY_CITY');
    return { id: city.id, name: city.name, open: city.open, current: city.englishName === cityName, center: mapCityCenter(city.englishName) };
  });
}

const facing = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360;
function state({ markers, selectedId = null, center = null, userLocation = null, heading = null, bottomInset = 0, topInset = 0 }: MapUpdate) {
  if (selectedId !== null && !text(selectedId, 180)) throw new Error('INVALID_DISCOVERY_SELECTION');
  if (center !== null && !coordinate(center)) throw new Error('INVALID_DISCOVERY_CENTER');
  if (userLocation !== null && !coordinate(userLocation)) throw new Error('INVALID_DISCOVERY_LOCATION');
  if (!facing(heading)) throw new Error('INVALID_DISCOVERY_HEADING');
  if (!Number.isFinite(topInset) || topInset < 0 || topInset > 1000) throw new Error('INVALID_DISCOVERY_INSET');
  if (!Number.isFinite(bottomInset) || bottomInset < 0 || bottomInset > 1000) throw new Error('INVALID_DISCOVERY_INSET');
  return { ...(markers !== undefined ? { markers: discoveryMarkers(markers) } : {}), selectedId, center: center && { latitude: center.latitude, longitude: center.longitude, ...(center.requestId !== undefined ? { requestId: center.requestId } : {}) }, userLocation: userLocation && { latitude: userLocation.latitude, longitude: userLocation.longitude }, heading, bottomInset, topInset };
}

export function discoveryMapMessage(raw: string, sessionId: string, markers: DiscoveryMarker[], cityIds: readonly string[] = []): DiscoveryMessage | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const message = JSON.parse(raw);
    if (!message || message.sessionId !== sessionId) return null;
    if (['ready', 'error', 'feedback'].includes(message.type)) return { type: message.type };
    if (message.type === 'select' && text(message.id, 180) && markers.some(marker => marker.id === message.id)) return { type: 'select', id: message.id };
    if (message.type === 'credits' && credits.includes(message.url)) return { type: 'credits', url: message.url };
    if (message.type === 'moved' && Array.isArray(message.bounds) && message.bounds.length === 4 && message.bounds.every(Number.isFinite)) {
      const [west, south, east, north] = message.bounds as number[];
      if (Math.abs(south) <= 90 && Math.abs(north) <= 90 && south <= north && Math.abs(west) <= 360 && Math.abs(east) <= 360)
        return { type: 'moved', bounds: { west, south, east, north }, ...(Number.isFinite(message.zoom) && message.zoom >= 0 && message.zoom <= 24 ? { zoom: message.zoom } : {}) };
    }
    if (message.type === 'city' && typeof message.id === 'string' && cityIds.includes(message.id)) return { type: 'city', id: message.id };
  } catch { /* The embedded map is an untrusted message boundary. */ }
  return null;
}

export function discoveryMapScript(update: MapUpdate, sessionId: string) {
  if (!text(sessionId, 180)) throw new Error('INVALID_DISCOVERY_SESSION');
  return `window.glingDiscoveryUpdate?.(${json(sessionId)},${json(state(update))});true;`;
}

export function discoveryMapHtml({ markers, cities = [], cityName, sessionId, selectedId = null, center = null, userLocation = null, bottomInset = 0, topInset = 0, accent = '#CBB9FF', parentOrigin = 'null', language = 'ko', zoom = 11, clay = true }: MapState & {
  cityName: string; sessionId: string; accent?: string; parentOrigin?: string; language?: 'ko' | 'en';
  /** Off draws MapLibre's own flat zoom buttons (the member's 2D choice and the web). The picture pins stay: they predate the 3D design. */
  clay?: boolean;
  /** Starting zoom; a small preview opens close enough (NEAR) to show the 3D art. */
  zoom?: number;
}) {
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 18) throw new Error('INVALID_DISCOVERY_ZOOM');
  if (!text(sessionId, 180) || !['ko', 'en'].includes(language) || !/^#[a-f\d]{6}$/i.test(accent)) throw new Error('INVALID_DISCOVERY_CONFIG');
  if (markers === undefined) throw new Error('INVALID_DISCOVERY_MARKERS');
  if (parentOrigin !== 'null' && (!/^https?:\/\//.test(parentOrigin) || new URL(parentOrigin).origin !== parentOrigin)) throw new Error('INVALID_DISCOVERY_ORIGIN');
  const config = json({ ...state({ markers, selectedId, center, userLocation, bottomInset, topInset }), cities: cityPills(cities, cityName), cityCenter: mapCityCenter(cityName), sessionId, parentOrigin, credits, art: MAP_PIN_ART, zoom });
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-gling-map' blob:; style-src 'unsafe-inline'; worker-src blob:; connect-src https://tiles.openfreemap.org; img-src data: blob: https://tiles.openfreemap.org; base-uri 'none'; form-action 'none'; object-src 'none'"><style>${assets.css}
html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#efeee9}${clay ? `.maplibregl-ctrl button.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon{background:url(${MAP_ZOOM_ART.in}) center/22px no-repeat}.maplibregl-ctrl button.maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon{background:url(${MAP_ZOOM_ART.out}) center/22px no-repeat}` : ''}.maplibregl-ctrl-top-left{top:calc(var(--map-top-inset,0px) + 12px);left:12px}.maplibregl-ctrl-group{border-radius:14px;overflow:hidden;box-shadow:0 2px 12px #3020471a}.maplibregl-ctrl-group button{width:44px;height:44px}.maplibregl-ctrl-group button:active{background:#ebe5f6}.maplibregl-ctrl-group button:focus-visible,#credits a:focus-visible{outline:3px solid ${accent};outline-offset:-3px}#credits{position:absolute;left:10px;bottom:calc(var(--map-bottom-inset,0px) + 6px);display:flex;flex-direction:column-reverse;align-items:flex-start;gap:4px;font:11px/1.3 system-ui;color:#333;z-index:4}#credits-toggle{width:44px;height:44px;padding:0;border:0;background:none;display:grid;place-items:center;cursor:pointer}#credits-toggle span{width:24px;height:24px;border-radius:12px;background:#fffffff2;box-shadow:0 1px 6px #3020472e;color:#5f566e;font:italic 700 13px/24px Georgia,serif;text-align:center}#credits-toggle:focus-visible{outline:3px solid ${accent};outline-offset:-3px;border-radius:22px}#credits-links{display:flex;flex-wrap:wrap;max-width:calc(100vw - 20px);background:#fffffff5;border-radius:14px;box-shadow:0 2px 10px #30204726;padding:0 4px}#credits-links[hidden]{display:none}#credits a{color:#333;min-height:44px;display:inline-flex;align-items:center;padding:0 6px;box-sizing:border-box}#credits a:active{background:#ebe5f6}
.city-pill{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid #d9d3e6;background:#fff;color:#302047;font:700 14px/1.2 system-ui;box-shadow:0 2px 10px #30204726;cursor:pointer}.city-pill:active{background:#ebe5f6}.city-pill:disabled{color:#7a7287;background:#f6f4f9;box-shadow:none;cursor:default}.city-pill:focus-visible{outline:3px solid ${accent};outline-offset:2px}.city-pill[hidden]{display:none}
.user-location-marker{width:16px;height:16px;background:#007aff;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 7px #007aff29,0 1px 5px #0004;pointer-events:none}
/* The facing cone points north and turns with the marker's rotation; it starts outside the dot so the white ring stays clean. */
.user-location-marker[data-facing="1"]::before{content:'';position:absolute;left:50%;top:50%;width:72px;height:72px;margin:-36px 0 0 -36px;background:radial-gradient(circle,#007aff00 11px,#007aff70 12px,#007aff00 36px);-webkit-clip-path:polygon(50% 50%,20% 0,80% 0);clip-path:polygon(50% 50%,20% 0,80% 0)}
</style></head><body><div id="map" aria-label="${language === 'en' ? 'City discovery map. Places are also available in the list. Mint dots mark webshop savings; percentages show the maximum verified representative-menu saving. A purple bookmark marks a place you saved. An orange dot marks a trending place and a pink dot a popular one. When zoomed out, nearby places are grouped into a circle showing how many places it holds; tap it to zoom in. TOP 50 places close together fold into their own gold-ringed circle.' : '도시 탐색 지도. 장소 목록에서도 선택할 수 있어요. 민트색 점은 웹샵 할인, 숫자는 확인한 대표 메뉴 최대 할인율이에요. 보라색 책갈피는 내가 저장한 곳이에요. 주황색 점은 요즘 뜨는 곳, 분홍색 점은 인기 있는 곳이에요. 지도를 줄이면 가까운 장소끼리 개수가 적힌 동그라미로 묶이고, 누르면 펼쳐져요. 붙어 있는 TOP 50끼리는 금색 테두리 동그라미로 따로 묶여요.'}"></div><div id="credits"><button id="credits-toggle" type="button" aria-expanded="false" aria-controls="credits-links" aria-label="${language === 'en' ? 'Map data credits' : '지도 자료 출처'}"><span aria-hidden="true">i</span></button><span id="credits-links" hidden><a href="https://openfreemap.org/">OpenFreeMap</a><a href="https://www.openmaptiles.org/">© OpenMapTiles</a><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a></span></div><script nonce="gling-map">${assets.javascript}</script><script nonce="gling-map">
const config=${config},NEAR=${NEAR},FAR=${FAR},pills=[];let map,userMarker,userHeading=null,loaded=false,failed=false,current=config,previousSelection=null,previousCenter=null,previousPadding=null,revision=0;
const send=payload=>{const message=JSON.stringify({...payload,sessionId:config.sessionId});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(message);else window.parent.postMessage(message,config.parentOrigin==='null'?'*':config.parentOrigin)};
const fail=()=>{if(!failed){failed=true;send({type:'error'})}};
const validPoint=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&(p.requestId===undefined||Number.isSafeInteger(p.requestId)&&p.requestId>=0);
const validText=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\\u0000-\\u001f\\u007f]/.test(s);
const validState=s=>{if(!s||typeof s!=='object'||Array.isArray(s)||(s.markers!==undefined&&(!Array.isArray(s.markers)||s.markers.length>500))||(s.center!=null&&!validPoint(s.center))||(s.userLocation!=null&&!validPoint(s.userLocation))||(s.heading!=null&&!(Number.isFinite(s.heading)&&s.heading>=0&&s.heading<360))||(s.selectedId!=null&&!validText(s.selectedId,180))||(s.topInset!=null&&(!Number.isFinite(s.topInset)||s.topInset<0||s.topInset>1000))||(s.bottomInset!=null&&(!Number.isFinite(s.bottomInset)||s.bottomInset<0||s.bottomInset>1000)))return false;const ids=new Set();return s.markers===undefined||s.markers.every(m=>{if(!m||!validText(m.id,180)||ids.has(m.id)||typeof m.label!=='string'||m.label.length>80||!validPoint(m)||typeof m.color!=='string'||!/^#[a-f\\d]{6}$/i.test(m.color)||(m.sublabel!==undefined&&(typeof m.sublabel!=='string'||m.sublabel.length>40))||(m.featured!==undefined&&typeof m.featured!=='boolean')||(m.icon!==undefined&&(typeof m.icon!=='string'||!/^[a-z][a-z0-9_-]{0,23}$/.test(m.icon)))||(m.top25!==undefined&&typeof m.top25!=='boolean')||(m.saved!==undefined&&typeof m.saved!=='boolean')||(m.statusColor!==undefined&&(typeof m.statusColor!=='string'||!/^#[a-f\\d]{6}$/i.test(m.statusColor)))||(m.discount!==undefined&&(!Number.isFinite(m.discount)||m.discount<=0||m.discount>100)))return false;ids.add(m.id);return true})};
const sameMarkers=(a,b)=>a.length===b.length&&a.every((m,i)=>{const p=b[i];return m.id===p.id&&m.latitude===p.latitude&&m.longitude===p.longitude&&m.color===p.color&&m.label===p.label&&(m.sublabel||'')===(p.sublabel||'')&&(m.featured===true)===(p.featured===true)&&(m.icon||'')===(p.icon||'')&&(m.top25===true)===(p.top25===true)&&(m.saved===true)===(p.saved===true)&&(m.statusColor||'')===(p.statusColor||'')&&(m.discount||0)===(p.discount||0)});
// A TOP 50 place folds with nearby TOP 50 places into a gold count unless it also has to stay single as saved or discounted (owner 2026-11-10 "동그라미 숫자에 그 골드띠만"). A visited TOP 50 place looks like any other TOP 50 pin (featured), so it folds with them.
const folds=m=>m.top25===true&&m.saved!==true&&!(m.discount>0);
const geojson=(selection=false,grouped=false,top=false)=>({type:'FeatureCollection',features:current.markers.filter(m=>selection?m.id===current.selectedId:top?folds(m)&&m.id!==current.selectedId:!grouped||m.featured!==true&&m.top25!==true&&m.saved!==true&&!(m.discount>0)&&!/^(bubble|meetup):/.test(m.id)&&m.id!==current.selectedId).map(m=>({type:'Feature',geometry:{type:'Point',coordinates:[m.longitude,m.latitude]},properties:{id:m.id,label:m.label,sublabel:m.sublabel||'',featured:m.featured===true,icon:m.icon||'',art:pinArt[m.icon]===true,color:m.color,top25:m.top25===true,fold:folds(m),saved:m.saved===true,statusColor:m.statusColor||'',discount:m.discount||0}}))});
const pinArt={};
// Each 3D picture becomes a white round pin image; until it loads, or if it cannot, the place keeps its coloured dot.
const loadPins=()=>{if(typeof Image==='undefined')return;Promise.all(Object.entries(config.art||{}).map(([id,src])=>new Promise(done=>{const img=new Image();img.onload=()=>{try{const s=3,pin=(d,top)=>{const c=document.createElement('canvas');c.width=c.height=d*s;const ctx=c.getContext('2d');ctx.scale(s,s);ctx.shadowColor='rgba(23,17,35,.22)';ctx.shadowBlur=4;ctx.shadowOffsetY=1;ctx.beginPath();ctx.arc(d/2,d/2,16,0,Math.PI*2);ctx.fillStyle='#ffffff';ctx.fill();ctx.shadowColor='transparent';ctx.drawImage(img,d/2-12,d/2-12,24,24);if(top){ctx.beginPath();ctx.arc(d/2,d/2,21,0,Math.PI*2);ctx.strokeStyle='#9C7637';ctx.lineWidth=2;ctx.stroke()}return ctx.getImageData(0,0,c.width,c.height)};map.addImage('pin-'+id,pin(36),{pixelRatio:s});map.addImage('pin-'+id+'-top',pin(46,true),{pixelRatio:s});pinArt[id]=true}catch{}done()};img.onerror=()=>done();img.src=src}))).then(()=>{if(loaded&&Object.keys(pinArt).length)apply(true,true)})};
const move=camera=>map.easeTo({...camera,duration:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:300});
const hitLayers=['discovery-selected-discount','discovery-selected-discount-dot','discovery-discount','discovery-discount-dot','discovery-discount-grouped','discovery-discount-dot-grouped','discovery-selected-top25','discovery-selected-hit','discovery-selected-label','discovery-top25','discovery-top25-top','discovery-top25-top-near','discovery-hit','discovery-hit-top','discovery-hit-top-near','discovery-hit-grouped','discovery-labels','discovery-labels-top-near','discovery-labels-grouped','discovery-featured-labels','discovery-featured-labels-top','discovery-art-featured-labels','discovery-art-featured-labels-top'];
const notSelected=()=>['!=',['get','id'],current.selectedId??''];
const top25Filter=()=>['all',['==',['get','top25'],true],['!=',['get','fold'],true],notSelected()];
// Gling-visited (featured), my saved places, discount places (owner 2026-11-08 "저장한 곳·할인 가게도 따로 보이기"), live bubbles, meetups and the chosen place are single: 'discovery' draws only them, at every zoom (apply sets that filter). Other TOP 50 places fold only among themselves into a gold count (owner 2026-11-10): 'discovery-top' below NEAR, 'discovery-top-near' from NEAR, each folding pins only as far apart as they touch at that stage. Every other place lives only in 'discovery-grouped', which folds crowded places into a count up to GROUP and gives single points above it (owner 2026-11-08 "멀리서묶어보기", then "줌 14까지 묶기"). Places left single at 13–14 already draw as close-up pins.
// No stage is switched by zoom in a filter, so a tile kept on screen while zooming still holds every place (supervisor review, PR #125). The one source switch is TOP 50's gold count at NEAR, by layer range, between two sources that both hold every folding TOP 50 place and both stay loaded.
const everyPlace=[];
const stage=()=>{const far=map.getZoom()<FAR;for(const pill of pills)pill.hidden=!far};
const ensureBadges=()=>{
 for(const value of new Set(current.markers.map(m=>m.discount).filter(v=>v>0))){
  const key='discount-'+value;if(map.hasImage(key))continue;
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('DISCOUNT_CANVAS');ctx.font='700 11px system-ui';
  const label=value+'%',width=Math.ceil(ctx.measureText(label).width)+12;canvas.width=width*2;canvas.height=40;ctx.scale(2,2);
  ctx.beginPath();ctx.moveTo(10,0);ctx.arcTo(width,0,width,20,10);ctx.arcTo(width,20,0,20,10);ctx.arcTo(0,20,0,0,10);ctx.arcTo(0,0,width,0,10);ctx.closePath();ctx.fillStyle='#8FD9C4';ctx.fill();
  ctx.fillStyle='#173F34';ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,width/2,10);
  map.addImage(key,ctx.getImageData(0,0,canvas.width,canvas.height),{pixelRatio:2});
 }

 if(!current.markers.some(m=>m.top25)||map.hasImage('top25-full'))return;
 const canvas=document.createElement('canvas');canvas.width=136;canvas.height=48;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('TOP25_CANVAS');ctx.scale(2,2);
 ctx.beginPath();ctx.moveTo(12,1);ctx.arcTo(67,1,67,23,11);ctx.arcTo(67,23,1,23,11);ctx.arcTo(1,23,1,1,11);ctx.arcTo(1,1,67,1,11);ctx.closePath();
 ctx.fillStyle='#FFF8E9';ctx.fill();ctx.strokeStyle='${TOP25_GOLD}';ctx.lineWidth=1;ctx.stroke();
 ctx.fillStyle='#6F5129';ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('TOP 50',34,12);
 map.addImage('top25-full',ctx.getImageData(0,0,canvas.width,canvas.height),{pixelRatio:2});
};
const apply=(markersChanged=false,selectionChanged=false)=>{if(!loaded)return;if(markersChanged)map.getSource('discovery').setData(geojson());if(selectionChanged){map.getSource('discovery-selection').setData(geojson(true));revision++;map.getSource('discovery-grouped').setData(geojson(false,true));const top=geojson(false,false,true);map.getSource('discovery-top').setData(top);map.getSource('discovery-top-near').setData(top)}
 const p=current.userLocation;
 if(p){if(!userMarker){const el=document.createElement('div');el.className='user-location-marker';el.setAttribute('role','img');el.setAttribute('aria-label','${language === 'en' ? 'Your location' : '내 위치'}');userMarker=new maplibregl.Marker({element:el,rotationAlignment:'map',pitchAlignment:'viewport'}).setLngLat([p.longitude,p.latitude]).addTo(map);userHeading=null}else userMarker.setLngLat([p.longitude,p.latitude]);
  // The whole marker turns with the map (a round dot looks the same), so only the cone shows the direction even when the map is rotated.
  const h=current.heading??null;if(h!==userHeading){userHeading=h;userMarker.getElement().setAttribute('data-facing',h===null?'0':'1');userMarker.setRotation(h??0)}}else if(userMarker){userMarker.remove();userMarker=null}
 if(markersChanged)ensureBadges();map.setFilter('discovery-top25',top25Filter());
 const chosen=['==',['get','id'],current.selectedId??''],single=['any',['all',['==',['get','featured'],true],['!=',['get','fold'],true]],['==',['get','saved'],true],['>',['get','discount'],0],['==',['slice',['get','id'],0,7],'bubble:'],['==',['slice',['get','id'],0,7],'meetup:'],chosen];
 for(const [id,f,chosenElsewhere] of everyPlace)map.setFilter(id,['all',single,f,chosenElsewhere?['!',chosen]:true]);
 const height=map.getContainer().clientHeight,top=Math.min(current.topInset||0,Math.max(0,height-44)),bottom=Math.min(current.bottomInset||0,Math.max(0,height-top-44)),padding=top+':'+bottom,paddingChanged=padding!==previousPadding;
 map.getContainer().style.setProperty('--map-top-inset',top+'px');document.documentElement.style.setProperty('--map-bottom-inset',bottom+'px');
 if(paddingChanged){map.setPadding({top,right:0,left:0,bottom});previousPadding=padding}
 map.setFilter('discovery-featured-labels',['all',['==',['get','featured'],true],['!=',['get','art'],true],['!=',['get','fold'],true],notSelected()]);for(const id of ['discovery-art-featured','discovery-art-featured-labels'])map.setFilter(id,['all',['==',['get','art'],true],['==',['get','featured'],true],['!=',['get','fold'],true],notSelected()]);
 const selected=current.markers.find(m=>m.id===current.selectedId),c=current.center;
 const changedCenter=c&&(!previousCenter||c.latitude!==previousCenter.latitude||c.longitude!==previousCenter.longitude||c.requestId!==previousCenter.requestId);
 if(c&&(changedCenter||paddingChanged))move({center:[c.longitude,c.latitude]});else if(selected&&(current.selectedId!==previousSelection||paddingChanged))move({center:[selected.longitude,selected.latitude]});
 previousSelection=current.selectedId;previousCenter=c&&{latitude:c.latitude,longitude:c.longitude,requestId:c.requestId};
};
window.glingDiscoveryUpdate=(sessionId,update)=>{if(sessionId!==config.sessionId||!validState(update))return;const markersChanged=update.markers!==undefined&&!sameMarkers(update.markers,current.markers),selectionChanged=markersChanged||(update.selectedId??null)!==(current.selectedId??null);current={...update,markers:markersChanged?update.markers:current.markers};apply(markersChanged,selectionChanged)};
window.addEventListener('message',e=>{if(e.source!==window.parent||e.origin!==config.parentOrigin||!e.data||e.data.type!=='discovery.update'||e.data.sessionId!==config.sessionId)return;window.glingDiscoveryUpdate(e.data.sessionId,e.data.state)});
const foldCredits=open=>{const links=document.getElementById('credits-links'),toggle=document.getElementById('credits-toggle');if(links&&toggle){links.hidden=!open;toggle.setAttribute('aria-expanded',String(open))}};
document.addEventListener('click',e=>{const a=e.target.closest?.('#credits a'),pill=e.target.closest?.('.city-pill');if(e.target.closest?.('#credits-toggle')){send({type:'feedback'});foldCredits(document.getElementById('credits-links')?.hidden)}else if(pill){const c=config.cities.find(c=>c.id===pill.getAttribute('data-city'));if(c&&c.open){send({type:'feedback'});if(c.current)move({center:c.center,zoom:11});else send({type:'city',id:c.id})}}else if(a){e.preventDefault();if(config.credits.includes(a.href)){send({type:'feedback'});send({type:'credits',url:a.href})}}else if(e.target.closest?.('.maplibregl-ctrl-group button'))send({type:'feedback'})});
try{
 map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/positron',center:config.center?[config.center.longitude,config.center.latitude]:config.cityCenter,zoom:config.zoom,attributionControl:false});
 window.glingMap=map;map.on('movestart',()=>foldCredits(false));
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
 const timer=setTimeout(fail,15000);
 map.on('load',()=>{try{
  ensureBadges();
  // Every place name sits on its own white tag so it never runs into the map's street and shop names (owner 2026-11-04 "글이 백그라운드가없으니 지도에 뜨는 글과 겹쳐서").
  const tag=document.createElement('canvas');tag.width=tag.height=40;const tx=tag.getContext('2d');if(!tx)throw Error('NAME_CANVAS');
  tx.beginPath();tx.moveTo(14,1);tx.arcTo(39,1,39,39,13);tx.arcTo(39,39,1,39,13);tx.arcTo(1,39,1,1,13);tx.arcTo(1,1,39,1,13);tx.closePath();
  tx.fillStyle='rgba(255,255,255,0.95)';tx.fill();tx.strokeStyle='rgba(48,32,71,0.16)';tx.lineWidth=2;tx.stroke();
  map.addImage('name-tag',tx.getImageData(0,0,40,40),{pixelRatio:2,stretchX:[[16,24]],stretchY:[[16,24]]});
  // My saved place: a lilac disc with a dark bookmark, white edge so it reads on the light map (corner m37 'saved' flag).
  const mark=document.createElement('canvas');mark.width=mark.height=36;const mx=mark.getContext('2d');if(!mx)throw Error('SAVED_CANVAS');mx.scale(2,2);
  mx.beginPath();mx.arc(9,9,8,0,Math.PI*2);mx.fillStyle='${accent}';mx.fill();mx.strokeStyle='#ffffff';mx.lineWidth=1.5;mx.stroke();
  mx.beginPath();mx.moveTo(6,5);mx.lineTo(12,5);mx.lineTo(12,13);mx.lineTo(9,10.5);mx.lineTo(6,13);mx.closePath();mx.fillStyle='#171123';mx.fill();
  map.addImage('saved-mark',mx.getImageData(0,0,36,36),{pixelRatio:2});
  map.addSource('discovery',{type:'geojson',data:geojson()});
  map.addSource('discovery-selection',{type:'geojson',data:geojson(true)});
  map.addSource('discovery-grouped',{type:'geojson',data:geojson(false,true),cluster:true,clusterMaxZoom:${GROUP},clusterRadius:44});
  // TOP 50 places fold only among themselves and only where they touch: below NEAR the widest mark is the 27px mid picture pin (pin-* at 0.75), from NEAR the 46px ringed pin (two 41–47px apart still touched at 40).
  // Up to 16: the two closest (Vancouver Art Gallery, Robson Square) still touch at 16 and part at 17. Both sources stay loaded at every zoom (their gold circles fade by zoom instead of a layer range).
  map.addSource('discovery-top',{type:'geojson',data:geojson(false,false,true),cluster:true,clusterMaxZoom:16,clusterRadius:28});
  map.addSource('discovery-top-near',{type:'geojson',data:geojson(false,false,true),cluster:true,clusterMaxZoom:16,clusterRadius:48});
  // Every place layer starts at the mid stage; below it only the city pills show.
  const add=layer=>map.addLayer({minzoom:FAR,...layer}),step=(mid,near)=>['step',['zoom'],mid,NEAR,near];
  const nameFont={'text-font':['Noto Sans Regular'],'text-anchor':'left','text-max-width':14,'icon-image':'name-tag','icon-text-fit':'both','icon-text-fit-padding':[2,6,2,6]},namePaint={'text-color':'#302047'};
  // Places whose picture is loaded swap the near dot for the picture pin; names sit a little further out from the bigger pin.
  // Further out every place is a dot and a named (featured) place gets a smaller picture pin on top where it does not collide (corner-map-today 2026-11-04 zoom stages).
  const art=['==',['get','art'],true],midArt=['all',art,['==',['get','featured'],true]],dot=['case',art,0,1],nameOffset=['case',art,['literal',[2.4,0]],['literal',[2,0]]],artPin={'icon-image':['concat','pin-',['get','icon']],'icon-allow-overlap':true,'icon-ignore-placement':true},topPin={...artPin,'icon-image':['concat','pin-',['get','icon'],['case',['==',['get','top25'],true],'-top','']]};
  // A layer for every place draws the single ones (apply adds that filter) above its '-grouped' copy, which draws the places that did not fold into a count. chosenElsewhere: the chosen place has its own layer.
  const copy=(layer,source,suffix)=>add({...layer,id:layer.id+suffix,source,filter:['all',['!',['has','point_count']],layer.filter??true]}),top=layer=>{if(!(layer.minzoom>=NEAR))copy({...layer,maxzoom:NEAR},'discovery-top','-top');if(!(layer.maxzoom<=NEAR))copy({...layer,minzoom:NEAR},'discovery-top-near','-top-near')},withTop=layer=>{top(layer);add(layer)},both=(layer,chosenElsewhere=false,folds=true)=>{copy(layer,'discovery-grouped','-grouped');if(folds)top(layer);add(layer);everyPlace.push([layer.id,layer.filter??true,chosenElsewhere])};
  add({id:'discovery-clusters',type:'circle',source:'discovery-grouped',filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],12,10,15,50,18],'circle-color':'#f8f6fc','circle-stroke-color':'#9283ac','circle-stroke-width':1.5}});
  add({id:'discovery-counts',type:'symbol',source:'discovery-grouped',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Bold'],'text-size':12,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#302047'}});
  // Folded TOP 50: the same count circle in the TOP 50 ring's gold, no name tag; opening it shows which places they are (owner 2026-11-10).
  // A source is only loaded while a layer on it is in range, so each gold circle stays in range and fades out at the other stage; that keeps both sources' tiles ready when the zoom crosses NEAR.
  const gold=(source,mid)=>{const shown=mid?step(1,0):step(0,1);add({id:source+'-clusters',type:'circle',source,filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],12,10,15,50,18],'circle-color':'#FFF8E9','circle-stroke-color':'#9C7637','circle-stroke-width':mid?1.5:2,'circle-opacity':shown,'circle-stroke-opacity':shown}});add({id:source+'-counts',type:'symbol',source,...(mid?{maxzoom:NEAR}:{minzoom:NEAR}),filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Bold'],'text-size':12,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#6F5129'}})};
  gold('discovery-top',true);gold('discovery-top-near',false);
  both({id:'discovery-pins',type:'circle',source:'discovery',paint:{'circle-radius':step(4,11),'circle-color':['get','color'],'circle-stroke-color':'#ffffff','circle-stroke-width':step(1.5,2),'circle-opacity':step(1,dot),'circle-stroke-opacity':step(1,dot)}});
  both({id:'discovery-art',type:'symbol',source:'discovery',minzoom:NEAR,filter:art,layout:topPin});
  both({id:'discovery-labels',type:'symbol',source:'discovery',minzoom:NEAR,layout:{...nameFont,'text-field':['case',['!=',['get','sublabel'],''],['format',['get','label'],{},'\\n',{},['get','sublabel'],{'font-scale':0.85,'text-color':'#6b6280'}],['get','label']],'text-size':12,'text-offset':nameOffset,'text-padding':4},paint:namePaint},true);
  withTop({id:'discovery-featured-labels',type:'symbol',source:'discovery',maxzoom:NEAR,filter:['all',['==',['get','featured'],true],['!',art]],layout:{...nameFont,'text-field':['get','label'],'text-size':11,'text-offset':[1,0],'text-padding':6},paint:namePaint});
  // The grouped hit area also covers each count (44px target) and sits under the single places' hit so a TOP 50 pin beside a count still wins.
  add({id:'discovery-hit-grouped',type:'circle',source:'discovery-grouped',paint:{'circle-radius':22,'circle-opacity':0}});
  add({id:'discovery-hit-top',type:'circle',source:'discovery-top',maxzoom:NEAR,paint:{'circle-radius':22,'circle-opacity':0}});
  add({id:'discovery-hit-top-near',type:'circle',source:'discovery-top-near',minzoom:NEAR,paint:{'circle-radius':22,'circle-opacity':0}});
  add({id:'discovery-hit',type:'circle',source:'discovery',paint:{'circle-radius':22,'circle-opacity':0}});everyPlace.push(['discovery-hit',true,false]);
  // A picture pin carries its own TOP 50 ring (pin-<art>-top), so the ring never shows before or without the picture (owner 2026-11-08 "서클이 이게 아직 안보이는데도 서클만 먼저보여"); this ring is for dots only.
  // Below NEAR the dot stays under the picture, so the small ring is never alone; the plain pin keeps the mid-zoom collision box as before.
  withTop({id:'discovery-top25',type:'circle',source:'discovery',filter:['==',['get','top25'],true],paint:{'circle-radius':step(7,15),'circle-opacity':0,'circle-stroke-color':'#9C7637','circle-stroke-width':step(1.5,2),'circle-stroke-opacity':step(1,dot)}});
  // Pins are placed before their names: a pin that collides drops back to its dot, and its name (the tag layer after it) only shows where it fits. The pin also covers the small TOP 50 ring under it.
  withTop({id:'discovery-art-featured',type:'symbol',source:'discovery',maxzoom:NEAR,filter:midArt,layout:{...artPin,'icon-size':0.75,'icon-allow-overlap':false,'icon-ignore-placement':false}});
  withTop({id:'discovery-art-featured-labels',type:'symbol',source:'discovery',maxzoom:NEAR,filter:midArt,layout:{...nameFont,'text-field':['get','label'],'text-size':11,'text-offset':[1.8,0],'text-padding':6},paint:namePaint});
  add({id:'discovery-selected',type:'circle',source:'discovery-selection',paint:{'circle-radius':['case',art,21,17],'circle-color':'#ffffff','circle-stroke-color':'${accent}','circle-stroke-width':4}});
  add({id:'discovery-selected-pin',type:'circle',source:'discovery-selection',paint:{'circle-radius':11,'circle-color':['get','color'],'circle-stroke-color':'#ffffff','circle-stroke-width':2,'circle-opacity':dot,'circle-stroke-opacity':dot}});
  add({id:'discovery-selected-art',type:'symbol',source:'discovery-selection',filter:art,layout:artPin});
  add({id:'discovery-selected-label',type:'symbol',source:'discovery-selection',layout:{...nameFont,'text-field':['get','label'],'text-size':12,'text-offset':nameOffset,'text-allow-overlap':true,'icon-allow-overlap':true},paint:namePaint});
  add({id:'discovery-selected-hit',type:'circle',source:'discovery-selection',paint:{'circle-radius':22,'circle-opacity':0}});
  add({id:'discovery-selected-top25',type:'symbol',source:'discovery-selection',filter:['==',['get','top25'],true],layout:{'icon-image':'top25-full','icon-anchor':'left','icon-offset':[21,-24],'icon-allow-overlap':true,'icon-ignore-placement':true}});
  // Above the selected ring so a saved pin keeps its mark when chosen; smaller at the dot stage.
  both({id:'discovery-saved',type:'symbol',source:'discovery',filter:['==',['get','saved'],true],layout:{'icon-image':'saved-mark','icon-size':step(0.6,1),'icon-offset':[13,-13],'icon-allow-overlap':true,'icon-ignore-placement':true}},false,false);
  // The place's state, opposite the discount dot and above the selected ring so a chosen pin keeps it.
  both({id:'discovery-status',type:'circle',source:'discovery',filter:['!=',['get','statusColor'],''],paint:{'circle-radius':step(3,5),'circle-color':['get','statusColor'],'circle-stroke-color':'#ffffff','circle-stroke-width':1.5,'circle-translate':step(['literal',[5,4]],['literal',[12,10]]),'circle-translate-anchor':'viewport'}});
  for(const [id,source] of [['discovery-discount','discovery'],['discovery-selected-discount','discovery-selection']]){
   const selection=source==='discovery-selection';
   const dot={id:id+'-dot',type:'circle',source,filter:['>', ['get','discount'],0],paint:{'circle-radius':4,'circle-color':'#8FD9C4','circle-stroke-color':'#ffffff','circle-stroke-width':1.5,'circle-translate':selection?[-12,10]:step(['literal',[-5,4]],['literal',[-12,10]]),'circle-translate-anchor':'viewport'}};
   const number={id,type:'symbol',source,minzoom:14,filter:['>', ['get','discount'],0],layout:{'icon-image':['concat','discount-',['to-string',['get','discount']]],'icon-anchor':'right','icon-offset':[-20,10],'icon-allow-overlap':selection,'icon-ignore-placement':selection}};
   if(selection){add(dot);add(number)}else{both(dot,true,false);both(number,true,false)}
  }
  for(const c of config.cities){
   const el=document.createElement('button');el.className='city-pill';el.type='button';el.disabled=!c.open;el.textContent=c.open?c.name:c.name+' · ${language === 'en' ? 'Coming soon' : '준비 중'}';
   el.setAttribute('data-city',c.id);el.setAttribute('aria-label',c.open?${language === 'en' ? "'Open the '+c.name+' map'" : "c.name+' 지도로 가기'"}:c.name+', ${language === 'en' ? 'coming soon' : '준비 중'}');
   pills.push(el);new maplibregl.Marker({element:el}).setLngLat(c.center).addTo(map);
  }
  stage();map.on('zoom',stage);
  clearTimeout(timer);loaded=true;failed=false;
  apply();loadPins();send({type:'ready'});
 }catch{fail()}});
 // A tile or glyph error while the map is still loading often passes; show the failure only if it still has not loaded 5s after the first one (owner b09e6df1).
 let grace=0;map.on('error',()=>{if(!loaded&&!grace)grace=setTimeout(()=>{if(!loaded)fail()},5000)});
 map.on('click',e=>{if(!loaded)return;const hit=map.queryRenderedFeatures(e.point,{layers:hitLayers})[0];if(!hit)return;
  // A count opens to the zoom where it splits; a map update in between makes its cluster id stale, so that answer is dropped and the map stays as it is.
  if(hit.properties?.cluster){send({type:'feedback'});const version=revision;map.getSource(hit.source).getClusterExpansionZoom(hit.properties.cluster_id).then(zoom=>{if(version===revision&&Number.isFinite(zoom))move({center:hit.geometry.coordinates,zoom:Math.min(zoom,18)})},()=>{});return}
  if(current.markers.some(m=>m.id===hit.properties?.id)){send({type:'feedback'});send({type:'select',id:hit.properties.id})}
 });
 // Only a person's pan or zoom counts; the app's own camera moves have no originalEvent.
 map.on('moveend',e=>{if(!loaded||!e.originalEvent)return;const b=map.getBounds();send({type:'moved',bounds:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],zoom:map.getZoom()})});
 map.on('mousemove',e=>{if(loaded)map.getCanvas().style.cursor=map.queryRenderedFeatures(e.point,{layers:hitLayers}).length?'pointer':''});
}catch{fail()}
</script></body></html>`;
}
