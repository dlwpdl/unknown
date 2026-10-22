"""Regression for valid codec zero, padding, and an unwanted opening syllable."""
import unittest
from types import SimpleNamespace

try:
    import mlx.core as mx
    from mlx_audio.tts.models.qwen3_tts.speech_tokenizer import Qwen3TTSSpeechTokenizer
except ModuleNotFoundError as error:
    if error.name.split('.')[0] not in ('mlx', 'mlx_audio'):
        raise
    mx = None
from qwen_voice_boundary import (install_codec_length_fix, check_narration_opening,
                                 normalize_reference_text, insert_sentence_breaths)


class VoiceBoundaryTests(unittest.TestCase):
    def test_sentence_breath_keeps_every_sample_and_the_final_word(self):
        import numpy as np
        original = np.r_[np.full(100, 12000, dtype=np.int16),
                         np.zeros(20, dtype=np.int16),
                         np.full(100, -12000, dtype=np.int16)]
        words = [{'word': '끝나요.', 'start': 0, 'end': 1},
                 {'word': '다음이에요.', 'start': 1.2, 'end': 2.2}]
        audio, gaps, unresolved = insert_sentence_breaths(original, 100, words)
        self.assertEqual(len(gaps), 1)
        self.assertFalse(unresolved)
        self.assertEqual(len(audio), len(original) + 16)
        self.assertTrue(np.array_equal(audio[audio != 0], original[original != 0]))
        self.assertEqual(audio[-1], original[-1])

    def test_an_active_syllable_is_not_split_to_manufacture_a_breath(self):
        import numpy as np
        original = np.full(220, 12000, dtype=np.int16)
        words = [{'word': '끝나요.', 'start': 0, 'end': 1},
                 {'word': '다음이에요.', 'start': 1, 'end': 2.2}]
        audio, gaps, unresolved = insert_sentence_breaths(original, 100, words)
        self.assertTrue(np.array_equal(audio, original))
        self.assertFalse(gaps)
        self.assertEqual(len(unresolved), 1)

    def tokenizer(self):
        seen = []
        def decode(codes):
            seen.append(codes)
            return mx.arange(codes.shape[-1] * 2)[None, None, :]
        tokenizer = SimpleNamespace(decode_upsample_rate=2,
                                    decoder=SimpleNamespace(chunked_decode=decode))
        tokenizer.decode = lambda codes: Qwen3TTSSpeechTokenizer.decode(tokenizer, codes)
        model = SimpleNamespace(speech_tokenizer=tokenizer)
        install_codec_length_fix(model)
        return tokenizer, seen

    @unittest.skipIf(mx is None, 'Run the two codec checks with the existing RP/.venv')
    def test_zero_is_a_real_frame_and_keeps_the_whole_tail(self):
        tokenizer, _ = self.tokenizer()
        audio, lengths = tokenizer.decode(mx.array([[[3], [0], [4]]]))
        self.assertEqual(int(lengths[0]), 6)
        self.assertEqual(audio.shape, (1, 6))
        self.assertEqual(int(audio[0, -1]), 5)

    @unittest.skipIf(mx is None, 'Run the two codec checks with the existing RP/.venv')
    def test_only_negative_padding_is_excluded_and_not_sent_to_vocoder(self):
        tokenizer, seen = self.tokenizer()
        _, lengths = tokenizer.decode(mx.array([[[0], [4], [-1]]]))
        self.assertEqual(int(lengths[0]), 4)
        self.assertGreaterEqual(int(mx.min(seen[0])), 0)

    def test_opening_keeps_word_spacing_flexible(self):
        check_narration_opening('리볼버에서 커피 한 잔을 마신 뒤', '리 볼버에서 커피 한 잔을 마신 뒤')

    def test_extra_yo_and_a_missing_first_syllable_are_blocked(self):
        for actual in ('요 리볼버에서 커피 한 잔을 마신 뒤', '볼버에서 커피 한 잔을 마신 뒤'):
            with self.subTest(actual=actual), self.assertRaises(ValueError):
                check_narration_opening('리볼버에서 커피 한 잔을 마신 뒤', actual)

    def test_an_empty_transcript_cannot_pass(self):
        with self.assertRaises(ValueError):
            check_narration_opening('리볼버에서 커피', '')

    def test_reference_has_a_sentence_boundary_before_the_new_script(self):
        self.assertEqual(normalize_reference_text(' 보이더라고요\n'), '보이더라고요.')
        self.assertEqual(normalize_reference_text('보이더라고요.'), '보이더라고요.')

    def test_empty_reference_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_reference_text(' \n')


if __name__ == '__main__':
    unittest.main()
