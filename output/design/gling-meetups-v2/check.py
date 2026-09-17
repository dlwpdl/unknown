"""Run: python3 check.py --page <Orca page ID> [--screenshots]
Uses the installed Orca CLI against this local prototype; no external writes.
"""
import argparse, base64, json, subprocess, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--page', required=True)
parser.add_argument('--screenshots', action='store_true')
parser.add_argument('--layout-only', action='store_true')
args = parser.parse_args()
base = Path(__file__).resolve().parent

def call(command, **kwargs):
    cmd = ['orca', *command.split(), '--page', args.page, '--json']
    for key, value in kwargs.items():
        cmd += ['--' + key.replace('_', '-'), str(value)]
    r = json.loads(subprocess.check_output(cmd, text=True))
    assert r.get('ok'), r.get('error')
    return r['result']

def js(expression):
    r = call('eval', expression=expression)
    value = r.get('value', r.get('result', r)) if isinstance(r, dict) else r
    if isinstance(value, str):
        try: return json.loads(value)
        except ValueError: pass
    return value

def element(name, role='button'):
    refs = call('snapshot')['refs']
    found = [ref for ref, data in refs.items() if data['name'] == name and data['role'] == role]
    assert len(found) == 1, (name, found)
    return found[0]

def click(name):
    call('scrollintoview', element=element(name))
    time.sleep(.15)
    call('click', element=element(name))
    time.sleep(.4)

def fill(name, value):
    call('fill', element=element(name, 'textbox' if name=='메시지' else 'searchbox'), value=value)
    time.sleep(.4)
    check('document.activeElement.value===' + json.dumps(value))

def check(expression):
    assert js(expression) is True, (expression, js(expression))

def screenshot(name):
    if args.screenshots:
        call('scroll', direction='up', amount=10000)
        (base/name).write_bytes(base64.b64decode(call('screenshot', format='png')['data']))

call('goto', url=(base/'index.html').as_uri())
call('viewport', width=1440, height=1100, scale=1)
check("document.title==='글링 · 모임 시안 02' && [...document.images].every(i=>i.complete&&i.naturalWidth>0)")
if not args.layout_only:
    screenshot('01-my-meetups.png')
    click('퇴근길 30분 산책 대화 열기')
    check("document.querySelector('.back').textContent==='모임' && data.rooms['walk-room'].unread===0")
    fill('메시지', '저도 함께할게요! <안녕>')
    click('메시지 보내기')
    check("data.rooms['walk-room'].messages.at(-1).text==='저도 함께할게요! <안녕>' && !document.querySelector('.bubble 안녕')")
    fill('메시지', '작성 중인 이야기')
    call('keypress', key='Escape')
    check("document.activeElement.id==='open-walk' && !current() && state.tab==='meetups'")
    click('03 채팅')
    click('대화 필터: 모임')
    click('퇴근길 30분 산책 대화 열기')
    check("document.querySelector('.back').textContent==='채팅' && document.querySelector('#message-input').value==='작성 중인 이야기' && document.querySelector('.room-body').textContent.includes('저도 함께할게요! <안녕>')")
    call('keypress', key='Escape')
    check("state.tab==='chats' && !current() && document.activeElement.id==='chat-walk-room'")
    click('처음 상태로 되돌리기')
    check("data.rooms['walk-room'].unread===3 && state.filters.chats==='all'")
    click('02 둘러보기')
    screenshot('02-discover.png')
    click('식사')
    check("document.querySelectorAll('.discover-card').length===1")
    click('주말 한 끼 같이 소개 열기')
    click('참여 신청하기')
    check("groupById('meal').membership==='pending' && !document.querySelector('[data-action=room]') && !data.rooms['meal-room']")
    click('신청 취소')
    check("groupById('meal').membership==='none'")
    call('keypress', key='Escape')
    check("state.filters.meetups==='explore' && state.category==='식사' && document.activeElement.id==='intro-meal'")
    fill('공개 모임 검색', '찾을 수 없는 모임')
    check("!document.querySelector('.discover-card') && document.querySelector('.empty')!==null")
    click('전체 모임 보기')
    check("document.querySelectorAll('.discover-card').length===3")
    click('퇴근길 30분 산책 소개 열기')
    screenshot('04-detail.png')
    call('click', element=next(ref for ref, data in call('snapshot')['refs'].items() if data['role']=='button' and data['name'].startswith('모임 대화하기')))
    time.sleep(.4)
    check("document.querySelector('.back').textContent==='모임 소개'")
    call('keypress', key='Escape')
    check("current().type==='detail' && document.activeElement.id==='detail-chat'")
    click('03 채팅')
    screenshot('03-chats.png')
    click('첫 방문 상태 보기')
    check("state.filters.meetups==='explore' && !data.groups.some(g=>g.membership==='joined')")
    click('내 모임 0')
    check("document.querySelector('.empty').textContent.includes('첫 번째 모임') && !document.querySelector('.my-row')")
    click('무료 한도 도달 상태')
    click('식사')
    click('주말 한 끼 같이 소개 열기')
    click('참여 신청하기')
    check("groupById('meal').membership==='none' && document.querySelector('.limit-message')!==null")
    click('내 모임 확인하기')
    check("document.querySelector('[role=meter]').getAttribute('aria-valuenow')==='3'")
    click('03 채팅')
    click('대화 필터: 문의')
    click('키칠라노 원룸 · 입주 문의 대화 열기')
    check("current().id==='inquiry-room' && data.friendlyStarted===3")
    call('keypress', key='Escape')
    click('처음 상태로 되돌리기')
    print('PASS: shared messages, escaped text, drafts, read state, both back paths, focus, filters, search, pending/cancel, newcomer, quota and inquiry access.', flush=True)
# Orca's media override did not update matchMedia on this runtime. Exercise the
# real transition function with reduced motion on/off, without changing OS settings.
source = (base/'index.html').read_text()
transition = source[source.index('function animateScreen('):source.index("document.querySelectorAll('[data-preview]').forEach(button")]
node_check = """const vm=require('node:vm'),assert=require('node:assert/strict');
const fn=JSON.parse(process.argv[1]);
for(const reduced of [true,false]){let animations=0,cancelled=0;
vm.runInNewContext(fn+';animateScreen(1)',{matchMedia:()=>({matches:reduced}),screen:{getAnimations:()=>[{cancel(){cancelled++}}],animate(){animations++}}});
assert.equal(animations,reduced?0:1);assert.equal(cancelled,reduced?0:1);}
"""
subprocess.run(['node','-e',node_check,json.dumps(transition)],check=True)
check("[...document.styleSheets[0].cssRules].some(r=>r.conditionText==='(prefers-reduced-motion: reduce)'&&[...r.cssRules].some(child=>child.style.animationName==='none'&&child.style.transitionProperty==='none'))")
for width in [320, 375, 768, 1024, 1440]:
    call('viewport', width=width, height=1100, scale=1)
    for label in ['01 내 모임', '02 둘러보기', '03 채팅']:
        click(label)
        check('document.documentElement.scrollWidth<=innerWidth')
        check("document.querySelector('#screen').scrollWidth<=document.querySelector('#screen').clientWidth")
        check("[...document.querySelectorAll('.phone button,.phone input')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44})")
    print(f'PASS: {width}px, all three surfaces, no overflow, 44px controls.', flush=True)
click('처음 상태로 되돌리기')
call('keypress', key='Tab')
check("document.activeElement.tagName==='BUTTON' || document.activeElement.tagName==='A'")
check("document.querySelectorAll('.phone button').length>0")
assert not call('console', limit=50)['messages'], 'Unexpected console output'
call('scroll', direction='up', amount=10000)
screenshot('01-my-meetups.png')
print('PASS: reduced-motion guard, keyboard, empty console; state reset.', flush=True)
