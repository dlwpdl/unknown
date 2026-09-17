"""Run against an isolated Chrome with --remote-debugging-port=9449.
Uses the already-installed websocket-client package; no app/server connection.
/opt/anaconda3/bin/python3 check_prototypes.py
"""
import json,base64,time,urllib.request
from pathlib import Path
import websocket
class CDP:
 def __init__(self):
  tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9449/json'))
  tab=next((t for t in tabs if t['type']=='page' and t['url'].startswith('file:')),next(t for t in tabs if t['type']=='page'))
  self.ws=websocket.create_connection(tab['webSocketDebuggerUrl'],timeout=20);self.id=0;self.errors=[]
  self.call('Page.enable');self.call('Runtime.enable')
 def call(self,method,params=None):
  self.id+=1;self.ws.send(json.dumps({'id':self.id,'method':method,'params':params or {}}))
  while True:
   r=json.loads(self.ws.recv())
   if r.get('method')=='Runtime.exceptionThrown':self.errors.append(r['params'])
   if r.get('id')==self.id:
    if 'error' in r:raise RuntimeError(r['error'])
    return r.get('result',{})
 def js(self,expression):
  r=self.call('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True})
  if 'exceptionDetails' in r:raise RuntimeError(r['exceptionDetails'])
  return r['result'].get('value')
 def size(self,w=392,h=844,scale=2):self.call('Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':scale,'mobile':False})
 def nav(self,path):
  self.call('Page.navigate',{'url':Path(path).as_uri()})
  for _ in range(60):
   if self.js("document.readyState==='complete' && [...document.images].every(i=>i.complete)"):break
   time.sleep(.1)
  self.js('document.fonts.ready.then(()=>true)');time.sleep(.3)
 def shot(self,path):
  r=self.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False,'fromSurface':True})
  Path(path).write_bytes(base64.b64decode(r['data']))

def click(c,selector):
 xy=c.js("(()=>{const r=document.querySelector("+json.dumps(selector)+").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
 for t in ['mousePressed','mouseReleased']:c.call('Input.dispatchMouseEvent',{'type':t,'x':xy[0],'y':xy[1],'button':'left','clickCount':1})

def until(c,expression):
 deadline=time.monotonic()+2
 while not c.js(expression):
  assert time.monotonic()<deadline, expression
  time.sleep(.05)

def main():
 c=CDP();base=Path(__file__).resolve().parent;c.size()
 for kind in ['a','b']:
  c.nav(base/f'concept-{kind}.html')
  assert c.js('[...document.images].every(i=>i.naturalWidth>0)'), 'Missing embedded image'
  click(c,'[data-filter="모임"]')
  assert c.js("getComputedStyle(document.querySelector('.meetup')).display!=='none'"), 'Meetup filter missing meetup'
  assert c.js("[...document.querySelectorAll('article')].every(e=>getComputedStyle(e).display==='none')"), 'Filter retained unrelated posts'
  click(c,'[data-filter="전체"]')
  click(c,'[data-action="city"]');time.sleep(.7)
  assert c.js('document.querySelector("dialog").open')
  click(c,'[data-city="토론토"]');time.sleep(.7)
  assert c.js("document.querySelector('.current-city').textContent==='토론토'")
  until(c,"!document.querySelector('dialog').open")
  assert c.js("!document.querySelector('dialog').open && document.activeElement.dataset.action==='city'"), 'City selection did not restore focus'
  click(c,'[data-action="compose"]');time.sleep(.7)
  click(c,'[data-action="draft"]')
  assert c.js("document.querySelector('dialog').open && document.activeElement.id==='title'"), 'Empty title was accepted'
  assert c.js("document.querySelector('dialog [role=status]').textContent.includes('제목')"), 'Validation notice is outside modal'
  c.js("document.querySelector('#title').value='동네 이야기'")
  click(c,'[data-action="draft"]');time.sleep(.7)
  until(c,"!document.querySelector('dialog').open")
  click(c,'[data-action="city"]');time.sleep(.7)
  c.call('Input.dispatchKeyEvent',{'type':'rawKeyDown','key':'Escape','code':'Escape','windowsVirtualKeyCode':27,'nativeVirtualKeyCode':53})
  c.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'Escape','code':'Escape','windowsVirtualKeyCode':27,'nativeVirtualKeyCode':53});time.sleep(.7)
  until(c,"!document.querySelector('dialog').open")
 c.nav(base/'concept-a.html')
 click(c,'article:last-child .text-link');time.sleep(.7)
 assert c.js("document.querySelector('.sheet-title').textContent==='겨울 타이어, 언제 바꾸세요?'"), 'Detail does not match selected post'
 click(c,'[data-action=close]');until(c,"!document.querySelector('dialog').open")
 for action in ['like','save']:
  click(c,f'[data-action="{action}"]')
  assert c.js(f"document.querySelector('[data-action={action}]').getAttribute('aria-pressed')==='true'")
  click(c,f'[data-action="{action}"]')
  assert c.js(f"document.querySelector('[data-action={action}]').getAttribute('aria-pressed')==='false'")
 c.call('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
 click(c,'[data-action="city"]')
 assert c.js("document.querySelector('dialog').open && new DOMMatrix(getComputedStyle(document.querySelector('dialog')).transform).m42===0"), 'Reduced motion still moves sheet'
 click(c,'[data-action="close"]')
 assert c.js("!document.querySelector('dialog').open")
 c.call('Emulation.setEmulatedMedia',{'features':[]})
 # Grab a still-opening sheet: movement must start from its current position.
 click(c,'[data-action="city"]');time.sleep(.08)
 before=c.js("(()=>{const r=document.querySelector('.drag-handle').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
 c.call('Input.dispatchMouseEvent',{'type':'mousePressed','x':before[0],'y':before[1],'button':'left','clickCount':1})
 y0=c.js("new DOMMatrix(getComputedStyle(document.querySelector('dialog')).transform).m42")
 c.call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':before[0],'y':before[1]+40,'button':'left','buttons':1})
 y1=c.js("new DOMMatrix(getComputedStyle(document.querySelector('dialog')).transform).m42")
 assert abs(y1-y0-40)<1, ('Drag jumped',y0,y1)
 c.call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':before[0],'y':before[1]+40,'button':'left','clickCount':1});time.sleep(.7)
 c.nav(base/'index.html')
 for width in [320,768,1024,1440]:
  c.size(width,1000,1);time.sleep(.2)
  assert c.js('document.documentElement.scrollWidth<=innerWidth'), f'Report overflow at {width}'
  assert c.js("[...document.querySelectorAll('iframe')].every(f=>f.contentDocument.documentElement.scrollWidth<=f.clientWidth)"), f'Phone overflow at {width}'
 click(c,'#dark');click(c,'#large');time.sleep(.2)
 assert c.js("[...document.querySelectorAll('iframe')].every(f=>f.contentDocument.documentElement.classList.contains('theme-dark')&&f.contentDocument.documentElement.classList.contains('large-type'))")
 assert not c.errors, c.errors
 print('PASS: A/B filters, city, compose validation, focus restoration, Escape, like/save, reduced motion, interrupted drag, 320–1440px layouts and theme/type controls.')
if __name__=='__main__':main()
