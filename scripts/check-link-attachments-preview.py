"""Check the offline URL/SNS design without sending external network requests."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / 'output/design/gling-link-attachments-2026-10-09.html'
OUT = HTML.with_suffix('')
OUT.mkdir(exist_ok=True)
results = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for width in (320, 390, 768):
        context = browser.new_context(viewport={'width': width, 'height': 844}, reduced_motion='reduce')
        intercepted, errors = [], []
        def prevent_network(route):
            if route.request.url.startswith(('http://', 'https://')):
                intercepted.append(route.request.url)
                route.abort()
            else:
                route.continue_()
        context.route('**/*', prevent_network)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(HTML.as_uri(), wait_until='networkidle')
        assert page.locator('#draft-links a').get_attribute('href') == 'https://www.instagram.com/gling.app/'
        compact_size = page.locator('#draft-links a').bounding_box()
        assert 44 <= compact_size['height'] <= 48
        assert 44 <= compact_size['width'] < 180
        page.screenshot(path=str(OUT / f'compose-{width}.png'), full_page=True)
        page.locator('#attachment-open').click()
        page.locator('#choose-sns').click()
        page.locator('#choose-instagram').click()
        for bad in ('https://instagram.com.evil.ca/gling.demo', 'https://instagram.com/reel/abc'):
            page.locator('#attachment-url').fill(bad)
            assert page.locator('#attach-confirm').is_disabled()
        page.locator('#attachment-url').fill('https://instagram.com/gling.app/?igsh=duplicate')
        assert page.locator('#attach-confirm').is_disabled()
        assert '이미 첨부한' in page.locator('#attachment-status').inner_text()
        page.locator('#attachment-url').fill('https://instagram.com/' + 'x' * 30)
        assert page.locator('#attach-confirm').is_enabled()
        assert page.locator('#attachment-result').evaluate('(el)=>el.scrollWidth <= el.clientWidth')
        page.locator('#attachment-url').fill('https://instagram.com/gling.demo/?igsh=tracking')
        assert '@gling.demo' in page.locator('#attachment-result').inner_text()
        assert page.locator('#attach-confirm').is_enabled()
        for _ in range(5):
            page.keyboard.press('Tab')
            assert page.evaluate('!document.hasFocus() || !!document.activeElement.closest("#attachment-dialog")')
        page.locator('#post-body').evaluate('(element)=>element.focus()')
        assert page.evaluate('!!document.activeElement.closest("#attachment-dialog")')
        page.screenshot(path=str(OUT / f'instagram-sheet-{width}.png'), full_page=True)
        page.locator('#attach-confirm').click()
        assert page.locator('#draft-links a').count() == 2
        assert page.locator('#draft-links a').nth(1).get_attribute('href') == 'https://www.instagram.com/gling.demo/'

        page.locator('#attachment-open').click()
        page.locator('#choose-url').click()
        page.locator('#attachment-url').fill('https://example.com/menu')
        assert '악성 여부 미확인' in page.locator('#attachment-status').inner_text()
        page.keyboard.press('Escape')
        assert page.locator('#draft-links a').count() == 2
        assert page.evaluate('document.activeElement.id') == 'attachment-open'
        page.locator('#attachment-open').click()
        page.locator('#choose-url').click()
        page.locator('#attachment-url').fill('https://example.com/menu')
        page.locator('#attach-confirm').click()
        assert page.locator('#draft-links a').count() == 3

        page.locator('#post-body').fill('소식 https://instagram.com.evil.ca/login')
        assert page.locator('#save-post').is_disabled()
        assert '열 수 없는 링크' in page.locator('#body-checks').inner_text()
        page.locator('#post-title').fill('가게 소식 <img src=x onerror=alert(1)>')
        page.locator('#post-body').fill('새 소식 https://example.com/news. <script>alert(1)</script>')
        assert page.locator('#save-post').is_enabled()
        page.locator('#save-post').click()
        assert page.locator('#read-title img').count() == 0
        assert page.locator('#read-body script').count() == 0
        page.screenshot(path=str(OUT / f'post-{width}.png'), full_page=True)
        page.locator('#read-links a').last.click()
        assert page.locator('#outbound-dialog').is_visible()
        assert page.locator('#outbound-destination').inner_text() == 'https://example.com/menu'
        assert not intercepted
        page.locator('#outbound-cancel').click()
        assert not intercepted
        page.locator('#read-body a').click()
        assert page.locator('#outbound-destination').inner_text() == 'https://example.com/news'
        with page.expect_popup() as pending:
            page.locator('#outbound-confirm').click()
        pending.value.close()
        assert page.evaluate('window.__qa.outbound[0]') == 'https://example.com/news'
        page.locator('#edit-post').click()
        page.get_by_role('button', name='@gling.demo 첨부 삭제').click()
        assert page.locator('#draft-links a').count() == 2
        page.locator('#post-title').fill('취소할 수정')
        page.locator('#cancel-edit').click()
        assert page.locator('#read-links a').count() == 3
        assert page.locator('#read-title').inner_text().startswith('가게 소식')
        page.locator('#edit-post').click()
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        small_controls = page.evaluate('[...document.querySelectorAll("button")].filter(e=>e.getClientRects().length).filter(e=>e.getBoundingClientRect().width<44||e.getBoundingClientRect().height<44).map(e=>e.id)')
        assert not small_controls, small_controls
        assert page.evaluate('window.__qa.feedback.length') > 10
        assert not errors, errors
        results.append({'width': width, 'status': 'pass', 'instagram_link_size': compact_size, 'javascript_errors': errors, 'horizontal_overflow': False, 'touch_targets_at_least_44px': True, 'external_requests_sent': 0, 'intercepted_destinations': intercepted})
        context.close()
    browser.close()

(OUT / 'checks.json').write_text(json.dumps({'scope': 'offline_interactive_preview', 'results': results}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'pass', 'viewport_checks': results, 'screenshots': str(OUT)}, ensure_ascii=False))
