import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { launchFrame, LAUNCH_DURATION } from '../src/lib/launch-motion.ts';

test('launch keeps the same g visible until it joins the wordmark, then clears the screen', () => {
  for (const [width, height] of [[320, 568], [440, 956], [1024, 1366]]) {
    const target = { x: 16, y: 76, scale: 64 / 720 };
    const start = launchFrame(0, width, height, target);
    assert.ok(Math.abs(start.x + (512 + 86 + start.gx) * start.scale - width / 2) < .001);
    assert.ok(Math.abs(start.y + (164 + start.gy) * start.scale - height * .47) < .001);
    assert.equal(start.prefix, 0);
    assert.equal(start.clipWidth, 164);
    for (let time = 0; time <= 850; time += 10) {
      const frame = launchFrame(time, width, height, target);
      assert.equal(frame.logoOpacity, 1, 'the ring/g must not disappear during the morph');
      assert.ok(Object.values(frame).every(Number.isFinite));
    }
    const joined = launchFrame(540, width, height, target);
    assert.equal(joined.prefix, 1);
    assert.ok(joined.gx === 0 && joined.gy === 0);
    assert.equal(joined.gScale, 1);
    assert.ok(joined.rotation === 0);
    const end = launchFrame(LAUNCH_DURATION, width, height, target);
    assert.equal(end.x, target.x);
    assert.equal(end.y, target.y);
    assert.equal(end.scale, target.scale);
    assert.equal(end.logoOpacity + end.curtainOpacity + end.headerMaskOpacity, 0);
  }
  const linked = launchFrame(LAUNCH_DURATION, 440, 956, null);
  assert.equal(linked.x, 440 * .22, 'deep links fade in place instead of flying to a nonexistent header');
  assert.equal(linked.y, 956 * .43);
  assert.equal(linked.headerMaskOpacity, 0);
});

test('generated iOS launch screen uses the brand background without an image', () => {
  const config = JSON.parse(execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], { encoding: 'utf8' }));
  const doc = config._internal.modResults.ios.splashScreenStoryboard.document;
  const view = doc.scenes[0].scene[0].objects[0].viewController[0].view[0];
  assert.equal(view.color[0].$.name, 'SplashScreenBackground');
  assert.equal(view.subviews[0].imageView?.length ?? 0, 0);
  assert.equal(view.constraints[0].constraint?.length ?? 0, 0);
});
