# 게시글 링크·사진 수정·사진 보기

2026-10-08 사용자 요청. 기존 Expo 57 / React Native 0.86, 게시글 저장·공유·사진 준비·관리자 연결을 재사용한다. 새 의존성·DB 스키마·서버 크롤러가 필요하지 않다.

- 완료 DM은 저장된 같은 글 ID의 실제 공개 HTTPS 링크를 포함한다. 공개 응답의 글 ID·업체·본문과 어드민 연결을 확인하고, 기존 발송/시도와 대조해 한 번만 보낸다.
- 본문에 입력한 전체 HTTPS 주소를 앱 상세·공개 웹·공유 페이지에서 누를 수 있다. 주소를 숨기는 임의 Markdown 이름이나 HTML을 실행하지 않는다. 정확한 Instagram 호스트만 Instagram으로 취급한다. 로그인정보·제어문자·내부주소·IP·유사 도메인·단축주소는 활성화하지 않는다. 업체 사이트의 소유권은 업체 제공/공식 프로필 근거로 별도 확인하며, HTTPS 검증을 업체 인증으로 표시하지 않는다.
- 사진 수정은 기존 사진 유지·개별 제거·추가·전체 교체·순서 변경을 지원한다. 첫 사진은 목록 표지다. 원본은 취소/실패 때 삭제하지 않는다. 최대 10장(2026-10-08 사진 수 변경) 및 업로드 검증·RLS·안전 분석을 유지한다. 성공한 수정은 상세와 오늘/검색 목록에도 반영한다.
- 상세는 한 장/여러 장 모두 원본 비율과 원본 URL을 사용한다. 사진 탭은 전체 화면을 열고 확대/축소·이전/다음·닫기를 제공한다. iOS는 네이티브 핀치 확대를 함께 제공한다.
- 수정·삭제는 상단 더 보기 메뉴. 삭제 경고색·최종 확인·44px 터치 영역·누름 피드백·감소된 모션을 유지한다.

범위: `src/lib/community-data.ts`, `src/components/post-detail.tsx`, `post-photo-gallery.tsx`, `feed-screen.tsx`, 본문 공용 렌더러, `public-web/reader.tsx`, `supabase/functions/public-post`, 기존 Threads workflow/config. 이미 수정된 작업 디렉터리를 보존하고 이번 변경 전 파일을 비공개 운영 폴더에 백업했다. 스토어/외부 배포는 별도 실제 영수증으로 구분한다.

검증: `node --experimental-strip-types --test scripts/post-links.test.mjs scripts/post-card-image.test.mjs scripts/community-data.test.mjs`, `npx tsc --noEmit`, `npm test`, `npx eslint` 변경 파일, `GLING_PUBLIC_WEB=1 npx expo export --platform web --output-dir /tmp/gling-post-links-web`. Node 테스트는 URL 공격·사진 수량/유지/실패·실제 React 컴포넌트 동작을 검사한다. 시안은 `output/design/` HTML로 제공한다. 실제 업체 글을 테스트 목적으로 생성/삭제하지 않는다.

참고: Apple Design의 직접 조작·명확한 상태·사용자 제어 원칙. Mobbin 실제 이미지: [Strava 관리 메뉴](https://mobbin.com/screens/ff727666-a3b2-4080-9ebd-2ee55d756003), [Retro 사진 상세](https://mobbin.com/screens/3943521c-c58c-4c96-941b-08572428a38c), [Finimize 본문 링크](https://mobbin.com/screens/6aef933a-e3de-4ae3-bd63-c06cdb6e99af). BrandKit의 night/iris 값이 현재 앱 테마와 일치함을 확인했다. Kroma는 설정 키 부재로 결과가 없었다.

공식 문서: https://docs.expo.dev/versions/v57.0.0/ (HTTP 200 확인), https://reactnative.dev/docs/text , https://reactnative.dev/docs/scrollview , https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a .

2026-10-08 검증 기록: 전체 테스트 334개, 변경 핵심 테스트 30개, 기존 GUI 조정 테스트 11개 통과. TypeScript·변경 앱/공용 파일 ESLint·공개 웹 export 및 공개 번들 경계 검사 통과. 실제 iPhone 17 Pro / iOS 26.5 시뮬레이터에 새 Debug 빌드를 설치하고 기존 업체 글의 원본 비율·사진 탭·전체 화면·확대 버튼·다음 사진·닫기를 확인한 뒤 홈 화면으로 돌아왔다. 실제 업체 글 수정/삭제와 네이티브 핀치 제스처는 수행하지 않았으며 사진 수정 저장은 테스트 저장소와 동작 시안에서 검증했다.

완료 DM의 공개 글 주소는 `https://gling.ej-entertainment.com/post?id=<저장된 UUID>`이다. 기존 정적 호스팅의 `/post/<UUID>`는 404, Supabase Edge HTML 응답은 게이트웨이에서 `text/plain`으로 바뀌므로 HTTP 200만으로 사용 가능한 글 페이지라고 판단하지 않는다. 실제 공개 글·사진을 확인한 정상 주소로 공유 함수를 수정했다. 기존 자동화 68회차의 OFY,OFT·The Green 발송 후 대화 재조회 기록에 같은 글 링크가 저장되어 있음을 확인했다. 이번 UI 작업에서 새 DM이나 수동 자동화 실행은 하지 않았다.

배포 구분: 기존 `public-post` Edge 함수는 v16 ACTIVE, JWT 설정 유지. 앱은 시뮬레이터 Debug 빌드, 공개 웹 UI는 로컬 export까지 완료했으며 스토어 제출·Git push·공개 웹 프런트 배포는 하지 않았다. Xcode 26.6 자산 컴파일의 런타임 로딩 문제 때문에 Debug 앱은 변경 없는 기존 아이콘 자산으로 복원·서명 검증했다. 시스템 서명/보안 정책과 SDK 런타임 매핑은 변경하지 않은 최종 상태다. 기존 의존성 감사 결과 critical 1 / high 25 / moderate 11은 별도 배포 전 해결 항목이다.

비공개 검증 기록: `/Users/ash/Library/Application Support/gling/operations/owner-post-links-photos-20261008T235714Z`.
