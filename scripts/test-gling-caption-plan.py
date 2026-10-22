"""Regression checks for meaning-preserving subtitle units."""
import runpy
from pathlib import Path

m = runpy.run_path(str(Path(__file__).with_name('gling-caption-plan.py')))
validate, plan = m['validate_units'], m['plan_captions']
text = '음악과 가족 프로그램도 만나볼 수 있어요. 입장권은 이 달러예요.'
units = ['음악과 가족 프로그램도 만나볼 수 있어요.', '입장권은 이 달러예요.']
protected = ['만나볼 수 있어요', '이 달러']
validate(text, units, protected)
for bad in [['음악과 가족 프로그램도 만나볼 수', '있어요. 입장권은 이 달러예요.'],
            ['음악과 가족 프로그램도 만나볼 수 있어요. 입장권은 이', '달러예요.'],
            ['음악과 가족 프로그', '램도 만나볼 수 있어요. 입장권은 이 달러예요.'],
            ['음악과 가족 프로그램도 만나볼 수 있어요.']]:
    try:
        validate(text, bad, protected)
    except ValueError:
        pass
    else:
        raise AssertionError('Broken predicate, price, or omitted copy was accepted')
words = [{'word': w, 'start': i * .5, 'end': (i + 1) * .5}
         for i, w in enumerate(text.split())]
cues, coverage = plan(text, units, [{'words': words}], len(words) * .5, lambda line: len(line) * 25, protected)
assert coverage == 1 and len(cues) == 2
assert cues[0]['end'] == cues[1]['start']
assert cues[-1]['end'] >= 1.4 + len(words) * .5
assert all(c['line_count'] <= 3 for c in cues)
assert ' '.join(c['text'].replace('\n', ' ') for c in cues) == text
long_units = units * 8
long_text = ' '.join(long_units)
long_words = [{'word': w, 'start': i * .5, 'end': (i + 1) * .5}
              for i, w in enumerate(long_text.split())]
long_seconds = len(long_words) * .5
long_cues, _ = plan(long_text, long_units, [{'words': long_words}], long_seconds,
                    lambda line: len(line) * 25, protected)
assert long_cues[-1]['end'] > 30
assert long_cues[-1]['end'] >= 1.4 + long_seconds
assert ' '.join(c['text'].replace('\n', ' ') for c in long_cues) == long_text
print('PASS: predicates/prices/all words, complete units, timing and reading limits')

# Bilingual captions must fit one real line per language and retain the full voice text.
bilingual = m['plan_bilingual_captions']
pairs = [(units[0], 'Music and family activities.'), (units[1], 'Tickets cost two dollars.')]
paired, _ = bilingual(text, pairs, [{'words': words}], len(words) * .5,
                      lambda line: len(line) * 25, lambda line: len(line) * 18, protected)
assert all(c['line_count'] == 2 and c['text'] == c['ko'] + '\n' + c['en'] for c in paired)
assert ' '.join(c['ko'] for c in paired) == text
for invalid, measure in [([(units[0], 'A\nB'), pairs[1]], lambda line: 1),
                         ([(units[0], 'x' * 200), pairs[1]], lambda line: 1),
                         (pairs, lambda line: 841)]:
    try:
        bilingual(text, invalid, [{'words': words}], len(words) * .5,
                  lambda line: len(line) * 25, measure, protected)
    except ValueError:
        pass
    else:
        raise AssertionError('Multiline, unreadably fast or overflowing English was accepted')
print('PASS: bilingual two-line layout, complete Korean text and English reading limits')


# Picture cues consume saved final captions; partial-cue timing must never be guessed.
phrase_window = m['resolve_phrase_window']
final = [{'ko': '창가 좌석을 보세요.', 'start': 1.4, 'end': 3.0},
         {'ko': '나무 결도 보여요.', 'start': 3.0, 'end': 4.7},
         {'ko': '창가 좌석을 보세요.', 'start': 4.7, 'end': 6.1}]
assert phrase_window(final, '창가 좌석을 보세요.', occurrence=2) == (4.7, 6.1)
assert phrase_window(final, '창가 좌석을 보세요. 나무 결도 보여요.') == (1.4, 4.7)
for cues, phrase, occurrence in [(final, '없는 문장이에요.', None),
                                 (final, '창가 좌석을 보세요.', None),
                                 (final, '좌석을 보세요.', 1),
                                 (final, '창가 좌석을 보세요.', 3),
                                 ([dict(final[0], end=1.0)], final[0]['ko'], 1),
                                 ([dict(final[0], end=float('nan'))], final[0]['ko'], 1),
                                 ([dict(final[0], start=None)], final[0]['ko'], 1),
                                 ([final[0], dict(final[1], start=2.9)], final[0]['ko'], 1),
                                 ([final[0], dict(final[1], start=3.2)],
                                  '창가 좌석을 보세요. 나무 결도 보여요.', None)]:
    try:
        phrase_window(cues, phrase, occurrence=occurrence)
    except ValueError:
        pass
    else:
        raise AssertionError('Missing, ambiguous, partial or invalid final phrase accepted')
print('PASS: final-caption exact phrase/occurrence windows; no guessed word timing')
