export type ChatLocation = { latitude: number; longitude: number; label: string };
export type ChatMapEvent = ({ type: 'selection' } & ChatLocation) | { type: 'ready' | 'error' | 'empty' | 'interaction' };
export type ChatMapCommand = { type: 'search'; query: string } | ({ type: 'point' } & ChatLocation);

export function parseChatMapEvent(value: string): ChatMapEvent | null {
  try {
    const event = JSON.parse(value);
    if (!event || typeof event !== 'object') return null;
    if (['ready', 'error', 'empty', 'interaction'].includes(event.type)) return { type: event.type };
    if (event.type !== 'selection' || typeof event.latitude !== 'number' || typeof event.longitude !== 'number'
      || !Number.isFinite(event.latitude) || !Number.isFinite(event.longitude)
      || Math.abs(event.latitude) > 90 || Math.abs(event.longitude) > 180
      || typeof event.label !== 'string' || !event.label.trim() || event.label.length > 240) return null;
    return { type: 'selection', latitude: event.latitude, longitude: event.longitude, label: event.label.trim() };
  } catch { return null; }
}

export function chatMapHtml(key: string, center = { latitude: 49.2827, longitude: -123.1207 }) {
  const config = JSON.stringify({ key, center }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html,body,#map{height:100%;margin:0;font-family:system-ui}#results{position:absolute;top:8px;left:8px;right:8px;max-height:45%;overflow:auto;border-radius:12px;background:#171722}
    #results:empty{display:none}button{display:block;width:100%;min-height:48px;text-align:left;border:0;border-bottom:1px solid #343443;padding:12px;color:#F6F3F0;background:#171722;font:inherit}button:active{background:#343443}
  </style><div id="map" aria-label="공유할 장소 선택 지도"></div><div id="results"></div><script>
    const config=${config}; let map, marker, searchVersion=0;
    const emit=value=>{const data=JSON.stringify(value);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(data);else window.parent.postMessage(data,'*');};
    const choose=(point,label)=>{
      if(!map)return;searchVersion++;
      if(!marker)marker=new google.maps.Circle({map,radius:30,fillColor:'#8169B1',fillOpacity:1,strokeColor:'#FFFFFF',strokeWeight:3});
      marker.setCenter(point);map.panTo(point);document.getElementById('results').replaceChildren();
      emit({type:'selection',latitude:point.lat,longitude:point.lng,label:label.slice(0,240)});
    };
    window.glingMapCommand=async command=>{
      if(!map)return;
      if(command.type==='point'){choose({lat:command.latitude,lng:command.longitude},command.label);map.setZoom(16);return;}
      if(command.type!=='search'||!command.query.trim())return;
      const version=++searchVersion;
      try{
        const {Place}=await google.maps.importLibrary('places');
        const {places}=await Place.searchByText({textQuery:command.query,fields:['displayName','formattedAddress','location'],maxResultCount:5,language:'ko'});
        if(version!==searchVersion)return;
        const results=document.getElementById('results');results.replaceChildren();
        for(const place of places){
          if(!place.location)continue;
          const label=[place.displayName,place.formattedAddress].filter(Boolean).join(' · ');
          const button=document.createElement('button');button.textContent=label;
          button.onclick=()=>choose(place.location.toJSON(),label);results.appendChild(button);
        }
        if(!results.children.length)emit({type:'empty'});
      }catch{if(version===searchVersion)emit({type:'error'});}
    };
    window.initGlingMap=async()=>{
      try{
        const {Map}=await google.maps.importLibrary('maps');
        map=new Map(document.getElementById('map'),{center:{lat:config.center.latitude,lng:config.center.longitude},zoom:12,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:'greedy'});
        map.addListener('click',event=>{if(event.latLng)choose(event.latLng.toJSON(),'선택한 위치');});emit({type:'ready'});
      }catch{emit({type:'error'});}
    };
    window.gm_authFailure=()=>emit({type:'error'});
    const script=document.createElement('script');script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(config.key)+'&loading=async&libraries=places&callback=initGlingMap&language=ko';
    script.onerror=()=>emit({type:'error'});document.head.appendChild(script);
  </script></html>`;
}
