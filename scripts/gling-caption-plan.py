"""Shared semantic subtitle layout/timing; no provider calls or voice changes."""
import difflib
import itertools
import math
import re
from bisect import bisect_left

def clean(text):
    return ''.join(c for c in text if c.isalnum())

def normalize(text):
    return ' '.join(text.split())

def validate_units(text, units, protected=()):
    if not units or normalize(' '.join(units)) != normalize(text):
        raise ValueError('Subtitle units must preserve every narration word and punctuation')
    boundaries, cursor = [], 0
    for unit in units[:-1]:
        cursor += len(clean(unit))
        boundaries.append(cursor)
        if re.search(r'(?:할|볼|즐길|갈|만날|될)\s+수(?:도|는)?[,.]?$', unit.strip()):
            raise ValueError('An auxiliary phrase cannot end at a subtitle boundary')
    for phrase in protected:
        fragment = clean(phrase)
        for match in re.finditer(re.escape(fragment), clean(text)):
            if any(match.start() < b < match.end() for b in boundaries):
                raise ValueError('Split protected subtitle phrase: ' + phrase)
    for unit in units:
        if re.match(r'^(?:있어요|거예요|돼요)[.!?](?:\s|$)', unit.strip()):
            raise ValueError('A predicate ending cannot become a standalone subtitle')

def wrap_unit(unit, measure, protected=()):
    words = unit.split()
    cuts, offset = [], 0
    for word in words[:-1]:
        offset += len(clean(word))
        cuts.append(offset)
    spans = [m.span() for p in protected for m in re.finditer(re.escape(clean(p)), clean(unit))]
    valid = [i for i, cut in enumerate(cuts, 1) if not any(a < cut < b for a, b in spans)]
    for line_count in (1, 2, 3):
        candidates = []
        for breaks in itertools.combinations(valid, line_count - 1):
            edges = (0, *breaks, len(words))
            lines = [' '.join(words[a:b]) for a, b in zip(edges, edges[1:])]
            widths = [measure(line) for line in lines]
            if max(widths) <= 840:
                candidates.append((max(widths) - min(widths), max(widths), lines))
        if candidates:
            return '\n'.join(min(candidates)[2])
    raise ValueError('Complete semantic unit needs author regrouping, not character slicing: ' + unit)

def plan_captions(text, units, measured, seconds, measure, protected=(), line_protected=(), *, minimum_seconds=1.0):
    validate_units(text, units, protected)
    actual, char_times = '', []
    for cue in measured:
        for word in cue['words']:
            chars = clean(word['word'])
            actual += chars
            char_times.extend(float(word['start']) + (float(word['end']) - float(word['start'])) * i / len(chars)
                              for i in range(len(chars)))
    expected = clean(text)
    anchors = [(block.a + i, char_times[block.b + i])
               for block in difflib.SequenceMatcher(None, expected, actual, autojunk=False).get_matching_blocks()
               for i in range(block.size)]
    if not expected or len(anchors) / len(expected) <= .65:
        raise ValueError('Insufficient independent ASR timing anchors; retain listening/phoneme hold')
    xs, ys = [a[0] for a in anchors], [a[1] for a in anchors]
    def timing(index):
        j = bisect_left(xs, index)
        if j == 0:
            return ys[0]
        if j == len(xs):
            return ys[-1]
        return ys[j-1] + (ys[j] - ys[j-1]) * (index - xs[j-1]) / (xs[j] - xs[j-1])
    starts, cursor = [], 0
    for unit in units:
        starts.append(math.floor((1.4 + timing(cursor)) * 30 + 1e-6) / 30)
        cursor += len(clean(unit))
    ends = starts[1:] + [math.ceil((1.4 + seconds) * 30 - 1e-6) / 30]
    result = []
    for unit, start, end in zip(units, starts, ends):
        if not (1.4 <= start < end <= ends[-1]) or end - start < minimum_seconds or end - start > 6.5:
            raise ValueError('Semantic unit needs reading-time review; do not cut or speed voice: ' + unit)
        if len(clean(unit)) / (end - start) > 16:
            raise ValueError('Subtitle reading rate exceeds 16 characters/second: ' + unit)
        wrapped = wrap_unit(unit, measure, line_protected)
        result.append({'text': wrapped,
                       'start': start, 'end': end,
                       'semantic_unit': unit, 'line_count': 1 + wrapped.count('\n')})
    validate_units(text, [c['text'] for c in result], protected)
    return result, len(anchors) / len(expected)


def plan_bilingual_captions(text, pairs, measured, seconds, measure_ko, measure_en, protected=()):
    """Author-reviewed KO/EN pairs: one line each, with unchanged whole narration."""
    units = [ko for ko, en in pairs]
    cues, coverage = plan_captions(text, units, measured, seconds, measure_ko, protected,
                                  minimum_seconds=.85)
    for cue, (ko, en) in zip(cues, pairs):
        if cue['line_count'] != 1 or not en.strip() or '\n' in en or '\r' in en or measure_en(en) > 840:
            raise ValueError('Bilingual captions need one authored line per language')
        if len(en) / (cue['end'] - cue['start']) > 24:
            raise ValueError('English subtitle needs shortening or more reading time')
        cue.update(ko=ko, en=en, text=ko + '\n' + en, line_count=2)
    return cues, coverage


def resolve_phrase_window(cues, phrase, *, occurrence=None):
    """Resolve complete final-caption phrases; no sub-cue timing interpolation."""
    phrase = normalize(phrase)
    if not phrase or (occurrence is not None and (type(occurrence) is not int or occurrence < 1)):
        raise ValueError('A nonempty exact phrase and positive occurrence are required')
    timings = []
    for cue in cues:
        try:
            start, end = float(cue['start']), float(cue['end'])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError('Final captions need explicit measured timing') from error
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
            raise ValueError('Invalid final-caption timing')
        if timings and start < timings[-1][1] - 1e-6:
            raise ValueError('Final-caption timing overlaps or runs backwards')
        timings.append((start, end))
    matches = []
    for i, cue in enumerate(cues):
        text = ''
        for j in range(i, len(cues)):
            current = cues[j]
            start, end = timings[j]
            if j > i and not math.isclose(start, timings[j-1][1], abs_tol=1e-6):
                break
            text = normalize(text + ' ' + current.get('ko', current.get('semantic_unit', '')))
            if text == phrase:
                matches.append((float(cue['start']), end))
            if not phrase.startswith(text) or len(text) >= len(phrase):
                break
    if not matches or (occurrence is None and len(matches) != 1):
        raise ValueError('Missing or ambiguous complete final-caption phrase: ' + phrase)
    if occurrence is not None and occurrence > len(matches):
        raise ValueError('Final-caption phrase occurrence is missing')
    return matches[0 if occurrence is None else occurrence - 1]
