"""Actual Expo React chat, offline Google Maps API substitute, no production account or API calls."""
import base64,json,sys,threading,time
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect
OUT=Path(__file__).parent
ROOT=Path('/Users/ash/Desktop/Git/unknown/mobile')
sys.path.insert(0,str(ROOT/'marketing'))
from browser_preflight import gui_bundle
USER='9f000000-0000-4000-8000-000000000001';OTHER='9f000000-0000-4000-8000-000000000002';ROOM='9f200000-0000-4000-8000-000000000001'
stamp='2026-10-01T18:00:00Z'
user={'id':USER,'aud':'authenticated','role':'authenticated','email':'chat-qa@example.invalid','created_at':stamp,'app_metadata':{},'user_metadata':{}}
claims={'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600,'iat':int(time.time())}
encode=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
session={'access_token':encode({'alg':'HS256','typ':'JWT'})+'.'+encode(claims)+'.qa','refresh_token':'offline-chat-qa-refresh','expires_at':claims['exp'],'expires_in':3600,'token_type':'bearer','user':user}
rows=[];calls=[];errors=[];results=[];next_id=10;refuse_edit=False
MAP_MOCK="""window.google={maps:{importLibrary:async name=>name==='maps'?{Map:class{constructor(element){this.element=element;element.style.background='#DEDCCC';element.style.display='grid';element.style.placeItems='center';element.textContent='밴쿠버 · 오프라인 지도';}addListener(name,fn){if(name==='click')this.element.onclick=()=>fn({latLng:{toJSON:()=>({lat:49.2827,lng:-123.1207})}});}panTo(){}setZoom(){}}}:{Place:{searchByText:async()=>({places:[{displayName:'Vancouver Public Library',formattedAddress:'350 W Georgia St',location:{toJSON:()=>({lat:49.2797,lng:-123.1156})}}]})}},Circle:class{setCenter(){}setMap(){}}}};window.initGlingMap();"""
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  path=urlsplit(self.path).path
  if Path(self.directory,path.lstrip('/')+'.html').is_file():self.path=path+'.html'
  super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(OUT/'app-runtime')))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
def reset():
 global rows
 rows=[{'id':'9f300000-0000-4000-8000-000000000001','conversation_id':ROOM,'sender_id':OTHER,'sender':{'nickname':'지우'},'body':'도서관 앞에서 만날까요?','created_at':stamp,'kind':'text','edited_at':None,'deleted_at':None},
 {'id':'9f300000-0000-4000-8000-000000000002','conversation_id':ROOM,'sender_id':USER,'sender':{'nickname':'검사 사용자'},'body':'좋아요. 오후 두 시에 봐요.','created_at':'2026-10-01T18:01:00Z','kind':'text','edited_at':None,'deleted_at':None}]
def intercept(route):
 global next_id
 req=route.request;parsed=urlsplit(req.url);path=parsed.path
 if req.url.startswith(origin) or parsed.scheme=='file':return route.continue_()
 if parsed.netloc=='maps.googleapis.com':
  assert path=='/maps/api/js';calls.append({'mapScript':'mocked'});return route.fulfill(content_type='application/javascript',body=MAP_MOCK)
 headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS,PATCH'}
 if req.method=='OPTIONS':return route.fulfill(status=204,headers=headers)
 calls.append({'path':path,'method':req.method})
 payload=req.post_data_json if req.method=='POST' else None
 if path.endswith('/auth/v1/user'):data=user
 elif path.endswith('/auth/v1/token'):data=session
 elif path.endswith('/rest/v1/profiles'):data=[{'id':USER,'nickname':'검사 사용자','city_id':'vancouver','verification_level':2,'account_status':'active','ai_safety_consent_at':stamp}]
 elif path.endswith('/rest/v1/messages'):
  ids=parse_qs(parsed.query).get('id',[''])[0]
  data=[row.copy() for row in rows if not ids or row['id'] in ids]
  if not ids:data=data[::-1]
 elif path.endswith('/rpc/get_chat_read_position'):data=None
 elif path.endswith('/rpc/get_message_reactions'):data=[]
 elif path.endswith('/rpc/edit_chat_message') or path.endswith('/rpc/delete_chat_message'):
  row=next(item for item in rows if item['id']==payload['p_message_id'])
  if path.endswith('/rpc/edit_chat_message') and refuse_edit:
   return route.fulfill(status=400,content_type='application/json',body=json.dumps({'message':'MESSAGE_CHANGED','code':'P0001'}),headers=headers)
  if path.endswith('/rpc/edit_chat_message'):row.update(body=payload['p_body'],edited_at='2026-10-12T20:00:00.000001Z')
  else:row.update(body='삭제된 메시지입니다.',kind='text',image_path=None,latitude=None,longitude=None,deleted_at='2026-10-12T20:01:00Z')
  data=row.copy()
 elif path.endswith('/rpc/send_message_v2') or path.endswith('/rpc/send_message'):
  next_id+=1;identifier=f'9f300000-0000-4000-8000-{next_id:012}'
  kind=payload.get('p_kind','text');label=payload.get('p_location_label')
  body=payload.get('p_body',payload.get('message_body','')) if kind=='text' else '📍 '+label
  row={'id':identifier,'conversation_id':ROOM,'sender_id':USER,'sender':{'nickname':'검사 사용자'},'body':body,'kind':kind,'created_at':'2026-10-12T20:02:00Z','reply_to_id':payload.get('p_reply_to_id'),'location_label':label,'latitude':payload.get('p_latitude'),'longitude':payload.get('p_longitude')};rows.append(row);data=identifier
 elif path.endswith('/rpc/get_my_interaction_preferences'):data={'sound':False,'haptics':False}
 elif path.endswith('/rpc/get_listing_review_state'):data=None
 elif path.endswith('/functions/v1/membership'):data={'membership':{'tier':'free','postLimit':4,'meetupLimit':3,'conversationLimit':None,'meetupsUsed':0,'postsUsed':0,'conversationsUsed':0}}
 elif '/rest/v1/' in path:data=[]
 else:return route.abort()
 route.fulfill(content_type='application/json',body=json.dumps(data),headers=headers)
def hold(page,locator):
 locator.scroll_into_view_if_needed();box=locator.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.wait_for_timeout(460);page.mouse.up()
def overflow(page):return page.evaluate('document.documentElement.scrollWidth > innerWidth')
try:
 with gui_bundle('gling-chat-runtime','chat-react-offline',time.time()+55):
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,args=['--mute-audio']);context=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',permissions=['geolocation'],geolocation={'latitude':49.2827,'longitude':-123.1207})
   context.route('**/*',intercept);context.add_init_script("localStorage.setItem('sb-gling-chat-qa-auth-token',"+json.dumps(json.dumps(session))+');')
   page=context.new_page();page.on('pageerror',lambda err:errors.append(str(err)));page.set_default_timeout(4500)
   try:
    reset();page.goto(origin+'/chat-controls-qa');page.get_by_text(rows[0]['body'],exact=True).first.wait_for()
    for group in [False,True]:
     if group:page.get_by_role('button',name='대화 종류 변경').click();page.get_by_text(rows[0]['body'],exact=True).first.wait_for()
     draft=page.get_by_placeholder('메시지를 입력해 주세요.')
     if not draft.count():draft=page.locator('input').first
     draft.fill('아직 보내지 않은 글')
     hold(page,page.get_by_text(rows[0]['body'],exact=True).first);page.get_by_role('button',name='답장',exact=True).click()
     assert draft.input_value()=='아직 보내지 않은 글';draft.press('Enter');page.get_by_text('아직 보내지 않은 글',exact=True).last.wait_for()
     assert rows[-1]['reply_to_id']==rows[0]['id'];results.append({'kind':'group' if group else 'direct','reply':True,'composerPreserved':True})
    draft.fill('보관할 입력')
    hold(page,page.get_by_text(rows[1]['body'],exact=True));page.get_by_role('button',name='메시지 수정',exact=True).click()
    page.get_by_role('textbox',name='수정할 메시지').fill('수정한 메시지')
    refuse_edit=True;page.get_by_role('button',name='수정 저장',exact=True).click();page.get_by_role('alert').last.wait_for()
    assert page.get_by_role('textbox',name='수정할 메시지').input_value()=='수정한 메시지';refuse_edit=False
    page.get_by_role('button',name='수정 저장',exact=True).click();page.get_by_text('수정한 메시지',exact=True).wait_for();assert draft.input_value()=='보관할 입력'
    hold(page,page.get_by_text('수정한 메시지',exact=True));page.get_by_role('button',name='메시지 삭제',exact=True).click();page.get_by_role('button',name='삭제하기',exact=True).click();page.get_by_text('삭제된 메시지입니다.',exact=True).wait_for();results.append({'edit':True,'failedEditDraftPreserved':True,'deleteTombstone':True})
    page.get_by_role('button',name='첨부 메뉴 열기',exact=True).click();page.get_by_role('button',name='위치 공유하기',exact=True).click()
    page.frame_locator('iframe').locator('#map').wait_for();search=page.get_by_role('textbox',name='장소 이름 또는 주소');search.fill('library');page.get_by_role('button',name='검색',exact=True).click()
    page.frame_locator('iframe').get_by_role('button',name='Vancouver Public Library · 350 W Georgia St',exact=True).click()
    expect(page.get_by_role('button',name='이 위치 공유하기',exact=True)).to_be_enabled()
    for width in [320,390,768,1440]:
     page.set_viewport_size({'width':width,'height':900});page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert not overflow(page)
     page.screenshot(path=str(OUT/f'react-location-{width}.png'),full_page=True);results.append({'mapWidth':width,'overflow':False})
    page.get_by_role('button',name='이 위치 공유하기',exact=True).click();page.get_by_text('Vancouver Public Library · 350 W Georgia St',exact=True).wait_for();assert rows[-1]['latitude']==49.2797
    page.get_by_role('button',name='첨부 메뉴 열기',exact=True).click();page.get_by_role('button',name='위치 공유하기',exact=True).click();page.get_by_role('button',name='현재 위치 선택',exact=True).click();page.get_by_text('49.28270, -123.12070',exact=True).wait_for();page.get_by_role('button',name='이 위치 공유하기',exact=True).click();page.get_by_text('현재 위치',exact=True).wait_for();results.append({'placeSearchAndSend':True,'explicitCurrentLocation':True,'realGoogleCalls':False})
    for width in [320,390,768,1440]:
     page.set_viewport_size({'width':width,'height':900});page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert not overflow(page);page.screenshot(path=str(OUT/f'react-chat-{width}.png'),full_page=True)
    assert not errors,errors
   except Exception:
    page.screenshot(path=str(OUT/'react-failure.png'),full_page=True);OUT.joinpath('react-failure-dom.html').write_text(page.content());raise
   finally:browser.close()
finally:
 server.shutdown();OUT.joinpath('runtime-verification.json').write_text(json.dumps({'results':results,'errors':errors,'mockCalls':calls,'realMessagesSent':False,'realGoogleCalls':False,'nativeTouch':False},ensure_ascii=False,indent=2))
print('Actual React: direct/group replies, edit/delete, place/current-location sharing, four widths passed')
