import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type GlowColors = { glowA: string; glowB: string; bodyGlowA: string; bodyGlowB: string };

const px = (value: number) => `${Math.round(value * 10) / 10}px`;

/**
 * 화면 배경 빛: 위쪽 빛 두 겹(승인된 오늘 피드 시안의 .screen 값)과 본문 전체의 옅은 보라 → 푸른 회색.
 * 모두 화면 크기 기준 px 원형 그라데이션이라, 화면 왼쪽 위에서 (x, y) 떨어진 뷰에도 같은 자리의 빛을 이어 그릴 수 있다.
 * (iOS는 화면 밖으로 나간 선형 그라데이션 정지점을 잘라 버려서, 이어 그리기가 맞는 원형만 쓴다.)
 */
export function screenGlowImage(colors: GlowColors, width: number, height: number, x = 0, y = 0) {
  const at = (left: number, top: number) => `at ${px(left - x)} ${px(top - y)}`;
  return [
    `radial-gradient(${px(width * 1.3)} ${px(height * 0.55)} ${at(0, 0)}, ${colors.glowA}, transparent 62%)`,
    `radial-gradient(${px(width)} ${px(height * 0.42)} ${at(width, height * 0.05)}, ${colors.glowB}, transparent 60%)`,
    `radial-gradient(${px(width * 1.2)} ${px(height * 1.1)} ${at(width / 2, 0)}, ${colors.bodyGlowA}, transparent)`,
    `radial-gradient(${px(width * 1.2)} ${px(height * 1.1)} ${at(width / 2, height)}, ${colors.bodyGlowB}, transparent)`,
  ].join(', ');
}

/**
 * 화면 전체 뷰(TabContent)에 onLayout을 달면 크기를 재고, image(x, y)로 그 자리에서 본 배경 빛을 준다.
 * 꾸밈이라 기존 뷰의 backgroundImage로만 쓴다(새 층이 없어 누르기·화면 읽기에 걸리지 않는다). 재기 전이나 끈 화면은 undefined.
 */
export function useScreenGlow(enabled = true) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const on = enabled && size.width > 0 && size.height > 0;
  return {
    onLayout: ({ nativeEvent: { layout } }: LayoutChangeEvent) => setSize({ width: layout.width, height: layout.height }),
    image: (x = 0, y = 0) => on ? screenGlowImage(theme, size.width, size.height, x, y) : undefined,
  };
}
