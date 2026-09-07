# Google Play 자료

- `icon-512.png`: 기존 `assets/brand/gling-app-icon.png`를 macOS `sips -z 512 512`로 내보낸 512×512 PNG.
- `feature-graphic.png`: 기존 글링 로고·아이콘을 참조해 생성한 홍보 이미지. 1024×500 PNG로 `sips` 내보내기 후 한국어 문구와 로고를 확인했다.
- `phone/`: Android 16(API 36), Pixel 9 에뮬레이터의 실제 Release 1.0.0 (1) 화면. 화면 크기 1080×1920, 밀도 420dpi. `adb exec-out screencap -p`로 촬영했으며 화면 합성·보정은 하지 않았다. 예시 게시글 표기를 유지했다.

화면 순서: 밴쿠버 피드, 토론토 피드, 도시 선택, 맛집 카테고리. 로그인 없이 탐색하는 화면이며 실제 계정 인증 성공을 의미하지 않는다.

## 홍보 이미지 생성 기록

BrandKit에서 Gling 검색, Mobbin의 Circle 화면 구성 및 Pinterest의 커뮤니티 앱 자료를 확인했다. Kroma는 연결에 필요한 키가 없어 결과를 얻지 못했다. 실제 디자인 기준은 저장소의 기존 글링 브랜드 파일이다. 이미지 생성 도구에 `assets/brand/gling-lockup.png`, `assets/brand/gling-app-icon.png`를 참조 이미지로 전달했다.

프롬프트:

```text
Use case: ads-marketing. Create ONE finished Google Play feature graphic for Gling, a Korean community app in Canada. Required final canvas exactly 1024 x 500 px, landscape. Input image 1 is the exact existing Gling logotype and mark; preserve its lettering and logo geometry faithfully. Input image 2 gives the existing warm vermilion #BE3B2A and cream palette; it is a brand reference, not a second icon to put in the graphic. Use a warm ivory #FAF9F6 background, ample negative space, crisp minimal graphic design, large dark navy typography. Place the Gling lockup clearly in the upper left. Main Korean headline, exactly: '캐나다의 오늘을' on one line and '한국어로.' on the next, medium large, clean bold Korean sans. Small supporting line exactly '밴쿠버 · 토론토'. On the right, a simple oversized vermilion Gling ring-and-dot brand mark with a restrained paper-like texture, enough whitespace around it. Keep content comfortably inside 60-pixel margins. No device mockups, no fabricated app screens, no people, no Google Play or Apple badges, no awards, no ratings, no download counts, no calls to action. This is the same existing brand, not a logo redesign. Flat, calm, professionally typeset, highly legible.
```

빌드·서명·Play Console 상태는 [Android 출시 기록](../../tasks/google-play-release-2026-09-06.md)에 기록한다.
