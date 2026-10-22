"""After the QA entry's Expo web bundle: python3 mobile/scripts/check-post-link-editor.py."""
import functools
import http.server
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

qa = Path(__file__).resolve().parents[1] / 'output/qa/post-link-attachments-2026-10-09'
assert (qa / 'app.js').is_file(), 'Build the QA entry with expo export:embed first.'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(qa)))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
origin = f'http://127.0.0.1:{server.server_port}'
results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width in (320, 390, 768):
            context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
            intercepted = []

            def route(request):
                if request.request.url.startswith(origin + '/'):
                    request.continue_()
                else:
                    intercepted.append(request.request.url)
                    request.abort()

            context.route('**/*', route)
            page = context.new_page()
            page.set_default_timeout(8000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin)
            body = page.get_by_role('textbox', name='글 본문', exact=True)
            body.wait_for()
            original = page.evaluate('window.__linkEditorQA.saved')
            body.fill('새 소식과 자세한 내용을 전해요.')
            assert 'https://www.instagram.com/gling.app/' in page.evaluate('window.__linkEditorQA.body')
            body.fill('새 소식과 자세한 내용을 전해요.\n\n첨부 링크\nhttps://instagram.com/pasted.profile/')
            assert 'https://www.instagram.com/pasted.profile/' in page.evaluate('window.__linkEditorQA.body'), 'Pasted attachments were lost'
            assert body.input_value() == '새 소식과 자세한 내용을 전해요.'
            body.fill('')
            page.get_by_role('button', name='저장 미리보기', exact=True).click()
            assert page.get_by_role('link', name='@pasted.profile · www.instagram.com 외부 페이지 열기', exact=True).is_visible()
            assert page.evaluate('window.__linkEditorQA.saved').startswith('첨부 링크\n')
            page.get_by_role('button', name='다시 수정', exact=True).click()
            assert body.input_value() == ''
            body.fill('새 소식과 자세한 내용을 전해요.')
            initial = page.get_by_role('link', name='@gling.app · www.instagram.com 외부 페이지 열기', exact=True)
            size = initial.bounding_box()
            assert 44 <= size['height'] <= 48 and 44 <= size['width'] < 180, size
            page.screenshot(path=str(qa / f'editor-{width}.png'), full_page=True)

            def instagram_sheet():
                page.get_by_role('button', name='링크 첨부', exact=True).click()
                page.get_by_role('button', name='SNS', exact=True).click()
                page.get_by_role('button', name='Instagram', exact=True).click()
                return page.get_by_role('textbox', name='Instagram 프로필 URL', exact=True)

            field = instagram_sheet()
            field.fill('https://instagram.com.evil.ca/gling.app')
            assert page.get_by_role('button', name='첨부하기', exact=True).is_disabled()
            field.fill('https://www.instagram.com/gling.app/?igsh=duplicate')
            assert page.get_by_text('이미 첨부한 링크예요.', exact=True).is_visible()
            assert page.get_by_role('button', name='첨부하기', exact=True).is_disabled()
            field.fill('https://instagram.com/' + 'x' * 30)
            assert page.get_by_role('button', name='첨부하기', exact=True).is_enabled()
            page.get_by_role('button', name='첨부하기', exact=True).click()
            assert 'x' * 30 in page.evaluate('window.__linkEditorQA.body')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
            field = instagram_sheet()
            field.fill('https://instagram.com/unsaved.profile/')
            page.get_by_role('button', name='첨부 창 닫기', exact=True).click()
            assert 'unsaved.profile' not in page.evaluate('window.__linkEditorQA.body')
            page.get_by_role('button', name='링크 첨부', exact=True).click()
            for _ in range(8):
                page.keyboard.press('Tab')
                assert page.evaluate("!document.hasFocus() || !!document.activeElement?.closest('[role=dialog]')"), 'Focus escaped the attachment dialog'
            page.keyboard.press('Escape')
            assert not page.get_by_role('button', name='SNS', exact=True).is_visible()

            page.get_by_role('button', name='링크 첨부', exact=True).click()
            page.get_by_role('button', name='URL 링크', exact=True).click()
            page.get_by_role('textbox', name='첨부할 URL', exact=True).fill('http://example.com')
            assert page.get_by_role('button', name='첨부하기', exact=True).is_disabled()
            page.get_by_role('textbox', name='첨부할 URL', exact=True).fill('https://example.com/news?a=1&b=2')
            assert page.get_by_text('악성 여부 미확인', exact=True).is_visible()
            page.get_by_role('button', name='첨부하기', exact=True).click()
            body.fill('새 소식 https://example.com/menu · https://instagram.com.evil.ca/gling')
            assert page.get_by_text('활성화할 수 없는 본문 링크 1개가 있어요. 주소를 확인해 주세요.', exact=True).is_visible()
            assert page.get_by_text('본문 외부 링크의 악성 여부는 아직 확인하지 못했어요.', exact=True).is_visible()
            for control in page.get_by_role('button').all():
                if control.is_visible():
                    rect = control.bounding_box()
                    assert rect['width'] >= 44 and rect['height'] >= 44, rect
            saved = page.evaluate('window.__linkEditorQA.body')
            page.get_by_role('button', name='저장 미리보기', exact=True).click()
            assert page.evaluate('window.__linkEditorQA.saved') == saved
            assert page.get_by_role('link', name='@gling.app · www.instagram.com 외부 페이지 열기', exact=True).is_visible()
            assert page.locator('a[href="https://instagram.com.evil.ca/gling"]').count() == 0
            page.screenshot(path=str(qa / f'published-{width}.png'), full_page=True)
            external = page.get_by_role('link', name='https://example.com/news?a=1&b=2 · example.com 외부 페이지 열기', exact=True)
            page.once('dialog', lambda dialog: dialog.dismiss())
            external.click()
            assert page.url == origin + '/'
            page.once('dialog', lambda dialog: dialog.accept())
            with page.expect_popup() as popup_info:
                external.click()
            popup = popup_info.value
            popup.wait_for_load_state('domcontentloaded')
            assert 'https://example.com/news?a=1&b=2' in intercepted
            popup.close()

            page.get_by_role('button', name='다시 수정', exact=True).click()
            page.get_by_role('button', name='gling.app 첨부 삭제', exact=True).click()
            assert 'https://www.instagram.com/gling.app/' not in page.evaluate('window.__linkEditorQA.body')
            page.get_by_role('button', name='수정 취소', exact=True).click()
            assert page.evaluate('window.__linkEditorQA.body') == saved
            assert page.evaluate('window.__linkEditorQA.saved') == saved and saved != original
            assert not errors, errors
            page.goto(origin + '/public-share.html')
            confirmations = page.locator('details.post-link-confirm')
            assert confirmations.count() == 2
            for disclosure in confirmations.all():
                onward = disclosure.locator('a')
                assert not onward.is_visible()
                disclosure.locator('summary').click()
                assert onward.is_visible() and disclosure.get_by_text('악성 여부 미확인 · 외부 페이지로 이동해요.', exact=True).is_visible()
                destination = onward.get_attribute('href')
                with page.expect_popup() as popup_info:
                    onward.click()
                popup = popup_info.value
                popup.wait_for_load_state('domcontentloaded')
                assert destination in intercepted
                popup.close()
            assert page.locator('a[href="https://instagram.com.evil.ca/gling"]').count() == 0
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
            page.screenshot(path=str(qa / f'public-share-{width}.png'), full_page=True)
            assert not errors, errors
            results.append({'width': width, 'compact_link_size': size, 'add_duplicate_delete_cancel_save': 'pass', 'paste_and_trim_readback': 'pass', 'destination_confirmation': 'pass', 'static_share_confirmation': 'pass', 'javascript_errors': errors, 'horizontal_overflow': False, 'external_requests_sent': 0})
            context.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
report = {'status': 'pass', 'scope': 'real_production_components_local_browser_with_network_blocked', 'results': results}
(qa / 'checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
