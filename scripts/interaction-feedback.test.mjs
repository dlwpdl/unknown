import assert from 'node:assert/strict';
import test from 'node:test';

import { parseInteractionPreferences } from '../src/lib/interaction-feedback-preferences.ts';

test('피드백 설정은 안전한 기본값을 쓰고 저장된 불리언만 복원한다', () => {
  assert.deepEqual(parseInteractionPreferences(null), { soundEnabled: true, hapticsEnabled: true });
  assert.deepEqual(parseInteractionPreferences('broken'), { soundEnabled: true, hapticsEnabled: true });
  assert.deepEqual(
    parseInteractionPreferences('{"soundEnabled":false,"hapticsEnabled":true}'),
    { soundEnabled: false, hapticsEnabled: true },
  );
});
