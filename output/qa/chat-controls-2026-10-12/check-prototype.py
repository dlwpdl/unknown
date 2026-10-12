import json,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT=Path(__file__).parent;ROOT=Path('/Users/ash/Desktop/Git/unknown/mobile')
sys.path.insert(0,str(ROOT/'marketing'))
from browser_preflight import gui_bundle
results=[];errors=[]
with gui_bundle('gling-chat-preview-check','chat-prototype-offline',time.time()+55):
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(3000)
  page.goto((OUT.parents[1]/'design/gling-chat-controls-2026-10-12.html').as_uri())
  for group in [False,True]:
   if group:page.locator('#channel').click()
   page.locator('#draft').fill('입력 유지')
   page.get_by_role('button',name='지우 메시지 메뉴').first.focus();page.keyboard.press('Enter');assert not page.locator('#edit-action').is_visible();page.locator('#reply-action').click();assert page.locator('#draft').input_value()=='입력 유지';page.locator('#draft').press('Enter');assert page.locator('.mine .quote').last.inner_text()=='토요일에는 도서관 앞에서 만날까요?'
   results.append({'kind':'group' if group else 'direct','reply':True,'composerPreserved':True})
  page.get_by_role('button',name='내 메시지 메뉴').first.focus();page.keyboard.press('Enter');page.locator('#edit-action').click();page.locator('#edit-draft').fill('수정된 메시지');page.locator('#edit-save').click();page.get_by_role('button',name='내 메시지 메뉴').first.focus();page.keyboard.press('Enter');page.locator('#delete-action').click();page.locator('#delete-confirm').click();assert page.get_by_text('삭제된 메시지입니다.',exact=True).count()==1
  page.locator('#plus').click();page.locator('#location-open').click();assert page.locator('#location-send').is_disabled();page.locator('#query').fill('library');page.locator('#query').press('Enter');assert page.locator('#location-send').is_disabled();page.locator('#result').click();assert not page.locator('#location-send').is_disabled()
  for width in [320,390,768,1440]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');assert page.locator('#location').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
   page.screenshot(path=str(OUT/f'prototype-location-{width}.png'),full_page=True)
   targets=page.locator('button:visible').evaluate_all('(elements)=>elements.map(e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height}})');assert all(item['width']>=44 and item['height']>=44 for item in targets)
   results.append({'width':width,'overflow':False,'controls':'>=44px'})
  page.locator('#location-send').click();assert page.get_by_text('📍 Vancouver Public Library',exact=True).count()==1
  page.locator('#plus').click();page.locator('#location-open').click();page.locator('#current').click();page.locator('#location-send').click();assert page.get_by_text('📍 현재 위치 (예시)',exact=True).count()==1
  page.set_viewport_size({'width':320,'height':900});page.evaluate("document.documentElement.style.fontSize='32px'");assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');assert not errors,errors
  browser.close()
OUT.joinpath('prototype-verification.json').write_text(json.dumps({'results':results,'errors':errors,'map':'offline illustration','realMessagesSent':False},ensure_ascii=False,indent=2));print('Interactive HTML: reply/edit/delete, place/current location, four widths and 200% type passed')
