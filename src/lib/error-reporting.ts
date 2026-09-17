import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// 사용자 폰에서 난 오류를 서버로 보낸다. 네이티브 충돌은 Apple·Google 이 이미 모아주므로
// 여기서 채우는 것은 그쪽에 잡히지 않는 자바스크립트 오류다.
//
// 보고 자체가 사용자를 방해해서는 안 된다. 실패하면 조용히 넘어간다.

const buildLabel = () => {
  const version = Constants.expoConfig?.version ?? 'unknown';
  const build = Platform.select({
    ios: Constants.expoConfig?.ios?.buildNumber,
    android: Constants.expoConfig?.android?.versionCode?.toString(),
  });
  return build ? `${version}(${build})` : version;
};

// 같은 오류가 반복해서 터질 때(렌더 루프) 네트워크를 때리지 않도록 이 실행 동안 한 번만 보낸다.
const reported = new Set<string>();
const REPORT_CAP = 20;

// instanceof Error 로 보지 않는다. 다른 실행 영역에서 넘어온 오류는 그 검사에 걸리지 않아
// 메시지가 "Error: ..." 문자열로 뭉개진다. 속성으로 판별한다.
function describe(error: unknown): { message: string; stack: string | null } {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; stack?: unknown };
    if (typeof candidate.message === 'string') {
      return { message: candidate.message, stack: typeof candidate.stack === 'string' ? candidate.stack : null };
    }
  }
  return { message: String(error), stack: null };
}

export function reportError(error: unknown, screen?: string) {
  try {
    const { message, stack } = describe(error);
    if (!message) return;
    const key = `${message}|${stack?.split('\n')[1] ?? ''}`;
    if (reported.has(key) || reported.size >= REPORT_CAP) return;
    reported.add(key);

    void supabase.rpc('report_client_error', {
      p_message: message,
      p_stack: stack,
      p_screen: screen ?? null,
      p_platform: Platform.OS,
      p_app_version: buildLabel(),
      p_os_version: `${Platform.OS} ${String(Platform.Version)}`,
    }).then(() => {}, () => {});
  } catch {
    // 보고가 실패해도 앱은 계속 간다.
  }
}

// 처리되지 않은 예외를 잡는다. React 트리 밖(타이머, 이벤트 핸들러)에서 난 것들이 여기로 온다.
type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

export function installErrorReporting() {
  if (installed) return;
  installed = true;
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const previous = utils?.getGlobalHandler?.();
  utils?.setGlobalHandler?.((error, isFatal) => {
    reportError(error);
    // 원래 처리기를 반드시 다시 부른다. 그래야 개발 중 빨간 화면이 그대로 뜬다.
    previous?.(error, isFatal);
  });
}
