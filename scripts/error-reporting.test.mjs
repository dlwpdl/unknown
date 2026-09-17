import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// 모듈이 @/ 별칭과 expo/react-native 를 쓰므로 sandbox 에서 대체물을 끼워 넣는다.
function loadModule(calls, platform = 'ios') {
  const source = readFileSync(new URL('../src/lib/error-reporting.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const handlers = {};
  const box = { exports: {} };
  const sandbox = {
    exports: box.exports, module: box, globalThis: {
      ErrorUtils: {
        getGlobalHandler: () => handlers.previous,
        setGlobalHandler: (fn) => { handlers.installed = fn; },
      },
    },
    require: (name) => {
      if (name === 'expo-constants') return { __esModule: true, default: { expoConfig: { version: '1.0.1', ios: { buildNumber: '23' } } } };
      if (name === 'react-native') return { Platform: { OS: platform, Version: '26.5', select: (map) => map[platform] } };
      if (name === '@/lib/supabase') return { supabase: { rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ error: null }); } } };
      throw new Error(`unexpected import ${name}`);
    },
  };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  return { module: box.exports, handlers };
}

test('오류를 앱 버전과 화면과 함께 보낸다', () => {
  const calls = [];
  const { module } = loadModule(calls);
  module.reportError(new Error('boom'), 'feed');
  assert.equal(calls.length, 1);
  const [fn, args] = calls[0];
  assert.equal(fn, 'report_client_error');
  assert.equal(args.p_message, 'boom');
  assert.equal(args.p_screen, 'feed');
  assert.equal(args.p_platform, 'ios');
  assert.equal(args.p_app_version, '1.0.1(23)');
});

test('같은 오류가 반복돼도 한 번만 보낸다', () => {
  const calls = [];
  const { module } = loadModule(calls);
  const error = new Error('loop');
  for (let i = 0; i < 50; i += 1) module.reportError(error);
  assert.equal(calls.length, 1, '렌더 루프가 네트워크를 때리지 않아야 한다');
});

test('서로 다른 오류는 상한까지만 보낸다', () => {
  const calls = [];
  const { module } = loadModule(calls);
  for (let i = 0; i < 100; i += 1) module.reportError(new Error(`different ${i}`));
  assert.equal(calls.length, 20, '한 실행에서 20건을 넘기지 않는다');
});

test('빈 메시지와 보고 실패는 앱을 멈추지 않는다', () => {
  const calls = [];
  const { module } = loadModule(calls);
  module.reportError(new Error(''));
  module.reportError(undefined);
  assert.equal(calls.length, 1, '빈 메시지는 보내지 않고 undefined 는 문자열로 보낸다');
  assert.equal(calls[0][1].p_message, 'undefined');
});

test('전역 처리기를 감싸되 원래 처리기를 계속 부른다', () => {
  const calls = [];
  const { module, handlers } = loadModule(calls);
  let passedThrough = false;
  handlers.previous = () => { passedThrough = true; };
  module.installErrorReporting();
  handlers.installed(new Error('fatal'), true);
  assert.equal(calls.length, 1, '보고한다');
  assert.ok(passedThrough, '개발 중 빨간 화면이 그대로 떠야 한다');
});
