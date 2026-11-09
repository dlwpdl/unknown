import { getCommunityActionError, isContentRejected } from './community-data.ts';

// 글쓰기 창을 먼저 닫고 올리기를 이어 가는 곳 (owner 2026-11-04 ③ "고른 사진이 위 카드로 들어가기").
// 한 번에 하나만 올린다. 실패하면 글과 사진(보낼 값 그대로)을 들고 있다가 다시 보낸다.
// 앱을 끄면 사라진다: 사진은 메모리의 base64(최대 20장)라 기기에 쓰지 않고, 글쓰기 초안도 원래 기기에 남기지 않는다.

export type UploadRect = { x: number; y: number; width: number; height: number };
// from: 글쓰기 창에서 이 사진이 있던 자리(화면 좌표). 있으면 위 카드로 날아간다.
export type UploadPhoto = { uri: string; from?: UploadRect };
export type PostUploadJob = {
  owner: string;
  title: string;
  photoCount: number;
  photos: UploadPhoto[];
  // retry=true: 이전 시도가 서버에 닿았는지 모르는 채로 다시 보낸다. 글은 올라갔는데 덧붙인 일이 안 됐으면 그 한 줄(notice)을, 내 첫 글이면 first를 돌려준다.
  send: (retry: boolean) => Promise<{ notice?: string; first?: boolean } | void>;
};
export type PostUpload = Omit<PostUploadJob, 'send'> & {
  key: number;
  status: 'uploading' | 'done' | 'failed';
  startedAt: number;
  error?: unknown;
  // 다 올라간 카드에서 제목 대신 보여 줄 한 줄(예: SNS 소개 동의를 저장하지 못함).
  notice?: string;
  // 내 첫 글: 다 올라가면 전면 3D 축하를 띄운다(사장님 2026-11-08). 두 번째부터는 카드만.
  first?: boolean;
};

// 시안(upload-motion-2026-11-04)의 값. 지금 앱은 사진과 글을 한 번에 보내서 진행률을 모른다.
export const UploadMotion = {
  fastTo: 0.7, fastMs: 700,
  slowTo: 0.9, slowMs: 1000,
  finishMs: 240,
  // 사진 세 장이 다 내려앉기 전(560ms + 60ms씩 + 40ms)에는 체크를 띄우지 않는다.
  landMs: 800,
  holdMs: 1500,
  flyMs: 560, flyStaggerMs: 60,
} as const;

export type BarStep = { to: number; ms: number; curve: 'out' | 'linear' };

/** 막대가 다음에 갈 곳. 서버 답이 오기 전에는 끝까지 차지 않는다. */
export function uploadBarSteps(status: PostUpload['status']): BarStep[] {
  if (status === 'uploading') return [
    { to: UploadMotion.fastTo, ms: UploadMotion.fastMs, curve: 'out' },
    { to: UploadMotion.slowTo, ms: UploadMotion.slowMs, curve: 'linear' },
  ];
  if (status === 'done') return [{ to: 1, ms: UploadMotion.finishMs, curve: 'out' }];
  return []; // 실패: 멈춘 자리에 둔다
}

/** 서버 답이 일찍 와도 사진이 카드에 내려앉은 뒤에 끝 모습을 보여 준다. */
export function finishDelay(elapsedMs: number) {
  return Math.max(0, UploadMotion.landMs - Math.max(0, elapsedMs));
}

/** 다시 보내도 결과가 같은 실패(금지어, 한도, 같은 글)는 다시 올리기 대신 고치기만 둔다. */
export function canRetryUpload(error: unknown) {
  return !isContentRejected(error) && !getCommunityActionError(error);
}

/**
 * 다시 보낸 글을 서버가 같은 글이라고 막으면, 앞 시도가 이미 저장된 것이다.
 * 서버는 같은 사람의 같은 제목·본문 이야기를 10분 안에 다시 받지 않는다(DUPLICATE_POST, 0103).
 * 매물의 DUPLICATE_LISTING은 30일 안의 다른 글일 수 있어 여기 넣지 않는다.
 */
export function savedByEarlierTry(error: unknown, retry: boolean) {
  return retry && getCommunityActionError(error) === 'DUPLICATE_POST';
}

let current: PostUpload | null = null;
let job: PostUploadJob | null = null;
let nextKey = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function subscribePostUpload(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getPostUpload = () => current;

function run(retry: boolean) {
  const key = current!.key, task = job!;
  task.send(retry).then(
    result => settle(key, 'done', undefined, result || undefined),
    error => settle(key, 'failed', error),
  );
}

function settle(key: number, status: 'done' | 'failed', error?: unknown, result?: { notice?: string; first?: boolean }) {
  if (current?.key !== key) return;
  current = { ...current, status, error, notice: result?.notice, first: result?.first };
  if (status === 'done') job = null;
  emit();
}

/** 올리는 중인 글이 있으면 false. 실패해서 남아 있던 글은 새 글로 바뀐다(그 초안은 글쓰기에 그대로 있다). */
export function startPostUpload(next: PostUploadJob, now = Date.now()) {
  if (current?.status === 'uploading') return false;
  const { send: _send, ...shown } = next;
  job = next;
  current = { ...shown, key: ++nextKey, status: 'uploading', startedAt: now };
  emit();
  run(false);
  return true;
}

/** 실패한 글만, 한 번만 다시 보낸다. 두 번 눌러도 두 번 보내지 않는다. */
export function retryPostUpload(now = Date.now()) {
  if (!job || current?.status !== 'failed' || !canRetryUpload(current.error)) return false;
  // 다시 보낼 때는 사진이 이미 카드에 있으니 또 날리지 않는다.
  current = { ...current, status: 'uploading', startedAt: now, error: undefined, photos: current.photos.map(({ uri }) => ({ uri })) };
  emit();
  run(true);
  return true;
}

/** 다 올라갔거나 실패한 카드를 치운다. 올리는 중에는 치우지 않는다(보내는 일은 멈출 수 없다). */
export function clearPostUpload(key?: number) {
  if (!current || current.status === 'uploading' || (key !== undefined && current.key !== key)) return;
  current = null;
  job = null;
  emit();
}
