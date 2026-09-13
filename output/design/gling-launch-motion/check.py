"""Check the open Orca preview: python3 check.py <browser-page-id>."""
import json
import subprocess
import sys

expression = r"""(async () => {
 const assert = (ok, message) => { if (!ok) throw new Error(message); };
 assert(location.origin === 'http://127.0.0.1:8177', 'Wrong preview page');
 assert([...document.images].every(i => i.complete && i.naturalWidth), 'Missing asset');
 const speed = document.querySelector('#speed');
 const original = [speed.value, reduced.checked];
 const finish = async () => {
  cards.forEach(c => running.get(c).animations.forEach(a => a.finish()));
  await Promise.resolve(); await Promise.resolve();
  cards.forEach(c => {
   assert(c.dataset.state === 'complete', 'Completion callback missing');
   assert(getComputedStyle(c.querySelector('.curtain')).opacity === '0', 'Home covered');
   assert(getComputedStyle(c.querySelector('.brand')).opacity === '0', 'Duplicate logo');
   assert(getComputedStyle(c.querySelector('.home-logo-mask')).opacity === '0', 'Home logo covered');
  });
 };
 try {
  speed.value = '1'; reduced.checked = false; playAll();
  const durations = cards.map(c => Math.round(Math.max(...running.get(c).animations.map(a => a.effect.getComputedTiming().endTime))));
  assert(durations.every(ms => ms === 950), 'Unexpected normal duration');
  const morph = cards.find(c => c.dataset.kind === 'link');
  const glyph = morph.querySelector('.last-g'), orbitDot = morph.querySelector('.orb');
  for (const time of [0, 180, 360, 540, 800]) {
   running.get(morph).animations.forEach(a => { a.pause(); a.currentTime = time; });
   assert(getComputedStyle(morph.querySelector('.brand')).opacity === '1', 'Morph disappears before wordmark handoff');
   assert(morph.querySelector('.last-g') === glyph && morph.querySelector('.orb') === orbitDot, 'Morph replaced the glyph or dot');
  }
  assert(getComputedStyle(morph.querySelector('.prefix')).opacity === '1', 'Wordmark prefix not revealed');
  const previous = running.get(cards[0]); play(cards[0]);
  assert(previous.animations.every(a => a.playState === 'idle'), 'Replay did not cancel');
  await finish();
  speed.value = '3'; playAll();
  assert(Math.round(Math.max(...running.get(cards[1]).animations.map(a => a.effect.getComputedTiming().endTime))) === 2850, 'Slow replay duration');
  await finish();
  speed.value = '1'; reduced.checked = true; playAll();
  cards.forEach(c => {
   const animations = running.get(c).animations;
   assert(animations.length === 1 && animations[0].effect.getComputedTiming().endTime === 120, 'Reduced motion must only fade');
  });
  await finish();
  return {assets:true, durationMs:durations, continuousGlyphAndDot:true, replayCancellation:true, slowReplay:true, reducedMotion:true, uncoveredHome:true};
 } finally { [speed.value, reduced.checked] = original; playAll(); }
})()"""
result = json.loads(subprocess.run([
    'orca', 'eval', '--page', sys.argv[1], '--expression', expression, '--json'
], text=True, capture_output=True, check=False).stdout)
assert result.get('ok'), result
print(json.dumps(result['result'], ensure_ascii=False, indent=2))
