# Google Play 자료

- `icon-512.png`: 기존 `assets/brand/gling-app-icon.png`를 macOS `sips -z 512 512`로 내보낸 512×512 PNG.
- `feature-graphic.png`: 기존 글링 로고·아이콘을 참조해 생성한 홍보 이미지. 1024×500 PNG로 `sips` 내보내기 후 한국어 문구와 로고를 확인했다.
- `phone/`: 2026-09-09에 Gling 전용 Android 16(API 36), Pixel 9 에뮬레이터에서 촬영한 실제 Release 1.0.0 (6) 화면. 1080×1920, 420dpi이며 `adb exec-out screencap -p`로 촬영했다. 사진 합성·화면 보정은 하지 않았다.

화면 구성: 밴쿠버 피드, 토론토 피드, 도시 선택, 맛집 피드의 왼쪽 반응·조회수. 도시에는 ‘준비 중’만 표시한다. 시드 작성자의 표시용 예시 표기는 제거했고, 시드 집계는 실제 이용자 활동 지표로 취급하지 않는다.

새 화면 4장을 업로드해 미리보기를 확인한 뒤 이전 화면 4장을 제거하고 저장했다. 재접속 후 새 이미지 4장이 모두 로드되고 저장할 변경이 없음을 확인했다. 콘솔 표시 순서는 토론토 → 맛집 → 도시 선택 → 밴쿠버다. 저장된 변경사항은 게시 개요에 대기하며 공개 검토 전송은 하지 않았다.

**2026-09-09 현재:** 서명된 빌드 6을 기존 내부 테스트 트랙에 출시해 ‘내부 테스터에게 제공됨’을 확인했다. 기기 지원 범위 감소는 0이며, 난독화 가독화 파일 미첨부 경고 1개만 남았다. 심사 계정 안내는 상단 검색 오른쪽 사람 아이콘으로 갱신했다. 공개 심사·프로덕션 출시는 진행하지 않았다. [최신 작업 기록](../../tasks/release-followup-2026-09-09.md)을 따른다.

## 홍보 이미지 생성 기록

BrandKit에서 Gling 검색, Mobbin의 Circle 화면 구성 및 Pinterest의 커뮤니티 앱 자료를 확인했다. Kroma는 연결에 필요한 키가 없어 결과를 얻지 못했다. 실제 디자인 기준은 저장소의 기존 글링 브랜드 파일이다. 이미지 생성 도구에 `assets/brand/gling-lockup.png`, `assets/brand/gling-app-icon.png`를 참조 이미지로 전달했다.

프롬프트:

```text
Use case: ads-marketing. Create ONE finished Google Play feature graphic for Gling, a Korean community app in Canada. Required final canvas exactly 1024 x 500 px, landscape. Input image 1 is the exact existing Gling logotype and mark; preserve its lettering and logo geometry faithfully. Input image 2 gives the existing warm vermilion #BE3B2A and cream palette; it is a brand reference, not a second icon to put in the graphic. Use a warm ivory #FAF9F6 background, ample negative space, crisp minimal graphic design, large dark navy typography. Place the Gling lockup clearly in the upper left. Main Korean headline, exactly: '캐나다의 오늘을' on one line and '한국어로.' on the next, medium large, clean bold Korean sans. Small supporting line exactly '밴쿠버 · 토론토'. On the right, a simple oversized vermilion Gling ring-and-dot brand mark with a restrained paper-like texture, enough whitespace around it. Keep content comfortably inside 60-pixel margins. No device mockups, no fabricated app screens, no people, no Google Play or Apple badges, no awards, no ratings, no download counts, no calls to action. This is the same existing brand, not a logo redesign. Flat, calm, professionally typeset, highly legible.
```

최초 등록·서명 설정은 [Android 출시 기록](../../tasks/google-play-release-2026-09-06.md), 현재 스토어 반영 상태는 [빌드 6 기록](../../tasks/release-followup-2026-09-09.md)을 따른다.
