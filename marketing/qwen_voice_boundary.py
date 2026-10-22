"""Qwen codec 0 is real audio; only -1 denotes padded frames.

Official contract: QwenLM/Qwen3-TTS tokenizer_12hz, audio_lengths > -1.
Apply to the loaded model instance, preserving the installed shared package.
"""
import re
import math


def normalize_reference_text(text):
    text = text.strip()
    if not text:
        raise ValueError('A transcribed reference sentence is required')
    return text if text[-1] in '.!?。！？' else text + '.'


def install_codec_length_fix(model):
    import mlx.core as mx

    tokenizer = model.speech_tokenizer
    original_decode = tokenizer.decode

    def decode(codes):
        lengths = (codes[..., 0] >= 0).sum(axis=1) * tokenizer.decode_upsample_rate
        audio, _ = original_decode(mx.maximum(codes, 0))
        if int(mx.max(lengths)) > audio.shape[1]:
            raise ValueError('Qwen decoder returned less audio than its valid codec frames')
        return audio, lengths

    tokenizer.decode = decode


def check_narration_opening(expected, observed):
    normalize = lambda text: re.sub(r'[^가-힣0-9A-Za-z]', '', text).lower()
    prefix = normalize(expected)[:12]
    if not prefix or not normalize(observed).startswith(prefix):
        raise ValueError('Narration opening differs from the script; hold for pronunciation review')


def insert_sentence_breaths(samples, sample_rate, words):
    import numpy as np

    if samples.ndim != 1 or samples.dtype != np.int16 or not len(samples) or sample_rate <= 0:
        raise ValueError('Expected complete mono PCM16 narration and a positive sample rate')
    for word in words:
        start, end = float(word['start']), float(word['end'])
        if not math.isfinite(start + end) or not 0 <= start <= end <= len(samples) / sample_rate + .1:
            raise ValueError('Word timestamps must lie inside the complete source narration')
    gaps, unresolved, pieces, cursor = [], [], [], 0
    half = max(1, round(.01 * sample_rate))
    for before, after in zip(words, words[1:]):
        if not before['word'].strip().endswith(('.', '!', '?')):
            continue
        gap = float(after['start']) - float(before['end'])
        added = round(max(0, .36 - gap) * sample_rate)
        if added < .04 * sample_rate:
            continue
        lo = max(cursor + half, round((float(before['end']) - .04) * sample_rate))
        hi = min(len(samples) - half, round((float(after['start']) + .04) * sample_rate))
        probes = [(float(np.sqrt(np.mean((samples[j-half:j+half].astype(float) / 32768) ** 2))), j)
                  for j in range(lo, hi + 1, max(1, round(.002 * sample_rate)))]
        if not probes or min(probes)[0] > .005:
            unresolved.append({'ending': before['word'].strip(), 'source_end': before['end'],
                               'next_start': after['start'], 'reason': 'No verified quiet boundary; retain listening/regeneration hold'})
            continue
        rms, position = min(probes)
        pieces.extend([samples[cursor:position], np.zeros(added, dtype=np.int16)])
        gaps.append({'sample': position, 'samples_added': added, 'source_seconds': position / sample_rate,
                     'natural_gap_before': gap, 'natural_gap_after': gap + added / sample_rate,
                     'ending': before['word'].strip(), 'boundary_rms': rms})
        cursor = position
    pieces.append(samples[cursor:])
    assert np.array_equal(np.concatenate(pieces[::2]), samples)
    return np.concatenate(pieces), gaps, unresolved
