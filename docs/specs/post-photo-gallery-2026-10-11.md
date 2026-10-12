# 전체 카테고리의 사진 갤러리 (2026-10-11)

사용자가 승인한 방향: 첨부 사진을 모두 펼치면 복잡하므로, Craigslist처럼 큰 사진 한 장과 아래의 작은 썸네일 한 줄로 정리한다. 모든 카테고리의 글 상세에 적용한다. Apple Design과 Mobbin MCP를 사용한다.

## 적용 범위와 디자인

- 기존 `PostPhotoGallery`와 `PostDetail` 연결을 재사용한다. 게시판·거래·구인·부동산·모임·페스티벌 등 카테고리별 예외를 만들지 않는다. 피드에는 기존 표지 한 장을 유지한다.
- Mobbin MCP에서 실제 확인한 [Pool 사진 뷰어](https://mobbin.com/screens/14eea2fa-02f0-48b4-9a20-95e572413805)의 큰 사진 아래 썸네일 구조를 적용한다. Shopify/Tripadvisor 검색 결과는 사진 선택 화면이므로 갤러리 근거로 사용하지 않는다.
- Apple Design의 즉시 반응·직접 조작·모션 감소·최소 44px 터치 영역을 따른다. BrandKit product의 나이트 배경 `#0B0B12`, 라일락 `#CBB9FF`, 모듈 반경 16px를 기존 테마에서 재사용한다.
- 큰 사진은 원본을 자르지 않는다. 작은 사진은 64×60px, 간격 8px, 선택 테두리 2px로 표시한다. 장수는 큰 사진 안에 둔다. 20장도 한 줄 안에서 가로 스크롤한다.
- 넓은 화면의 글 상세는 기존 피드와 같은 `MaxContentWidth`를 사용해 사진·글·댓글을 함께 가운데 정렬한다. 모바일 폭은 그대로다.
- 실제 썸네일이 없는 기존 사진은 화면에 보이는 썸네일 범위와 앞뒤 한 장에만 원본을 폴백한다. 화면 밖 20장 원본을 작은 사진에서 모두 요청하지 않는다.
- 썸네일을 누르면 즉시 선택하고 피드백을 재생한다. 큰 사진 스와이프와 선택 표시를 동기화한다. 화면 폭 변경 후에도 선택한 사진을 유지한다.
- 사진을 누르면 기존 전체 화면·확대·이전/다음 기능을 사용한다. 계정·글·사진 변경 시 이전 선택과 전체 화면을 노출하지 않는다.

## 최소 구현과 검증

1. 기존 갤러리 테스트에 썸네일 선택·20장·경계·화면 폭·계정 변경·원본과 썸네일의 대응 검사를 추가하고 실패를 확인한다.
2. 공통 컴포넌트에 썸네일 줄과 스크롤 참조만 추가한다. 기존 `getPostImageSource(..., 'feed', position)`과 뷰어별 캐시 키를 유지한다. 큰 원본은 현재 사진과 앞뒤 사진만 요청한다.
   실제 서명 응답에서 일부 사진이 누락되면 기존 두 배열의 독립적인 압축으로 순서가 어긋났다. `feed-data`의 배열 위치를 유지하고 빈 썸네일은 같은 위치의 원본을 사용한다. 사진 수정은 모든 원본의 실제 로드 여부를 계속 검사한다.
3. 승인된 기존 매물 사진을 재사용한 HTML 시안을 저장하고 320/390/768/1440px, 큰 글씨, 키보드와 확대 동작을 확인한다. 공용 GUI guard로 글링 프로젝트의 Orca 탭에서 열고 실제 표시를 확인한다.

명령: `node --experimental-strip-types --test scripts/post-photo-gallery.test.mjs scripts/post-card-image.test.mjs`, `npx tsc --noEmit`, `npx eslint src/components/post-photo-gallery.tsx`, `npm test`. 실제 React 웹 화면도 모의 인증·이미지로 검사한다.

소스는 `src/components/post-photo-gallery.tsx`, 회귀 검사는 기존 `scripts/post-photo-gallery.test.mjs`와 `scripts/post-card-image.test.mjs`, 시안은 `output/design/gling-photo-gallery-2026-10-11.html`, 증거는 `output/qa/photo-gallery-2026-10-11/`에 둔다. 집계·로그인·모임 승인·20장 업로드 계약과 DB는 변경하지 않는다. 새 의존성과 이미지 생성은 필요 없다(이미지 모델 계약: 해당 없음). 저장된 사진을 삭제하거나 비공개 원본을 미리보기로 공개하지 않는다.

## 확대 사진 이동 (추가 사용자 요청)

확대 버튼을 누른 뒤 사진을 한 손가락으로 상하좌우 끌어 전체를 확인한다. 사진 밖으로 밀리지 않게 실제 뷰포트와 원본 비율로 이동 범위를 제한하고, 경계에서 방향을 바꾸면 즉시 따라온다. 축소·다른 사진·닫기 때 1배와 중앙 위치를 복원하고, 화면 크기가 바뀌면 이동 위치를 중앙으로 맞춘다.

기존 iOS의 두 손가락 1~4배 확대를 보존하며 같은 동작을 Android와 웹에 적용한다. 포인터가 가리키는 부분을 중심으로 확대한다. 중첩 ScrollView는 두 축과 Android 확대를 함께 처리할 수 없어, 설치된 Gesture Handler 2.32와 Reanimated 4.5의 UI 스레드 제스처를 사용한다. Android Modal의 뷰포트에는 별도 GestureHandlerRootView를 둔다. React Compiler와 호환되는 공유 값 get/set API를 사용하며 드래그 프레임마다 React 상태를 업데이트하지 않는다. 새 의존성은 추가하지 않는다.

네 방향 보기 action을 스크린리더에 제공하고, 웹에는 키보드로 누를 수 있는 44px 이상 이동 버튼을 제공한다. 변경한 모든 버튼은 기존 선택 피드백을 재생한다. 애니메이션을 추가하지 않아 모션 감소 설정에서도 직접 조작이 유지된다.

실제 확인한 Mobbin Apple Photos 사진 뷰어 https://mobbin.com/screens/6a012417-7088-411c-a285-08337b11e49f 와 Weverse https://mobbin.com/screens/d8f4f967-1c71-4dae-af9e-f3dc801c008c 의 어두운 사진 중심 화면·고정 닫기·한 줄 썸네일 구성을 유지한다. 정적인 Mobbin 이미지는 제스처 동작 검증이 아니며, 이동·확대는 공식 계약과 실제 런타임으로 검증한다.

공식 계약: Expo 57 Image/gesture-handler 문서, Gesture Handler 2.x pinch/installation 문서, Reanimated 4.x useSharedValue 문서. 회귀 검사는 기존 갤러리·사진 카드·이미지 서명 테스트에 추가한다. 인증 경계·이미지 캐시·전체 카테고리의 20장 업로드·비즈니스 리뷰·DB는 보존한다.

웹의 포인터 좌표는 뷰포트가 배치된 뒤 Native View.measureInWindow로 측정한 원점을 빼 실제 사진 영역의 좌표로 바꾼다. 웹 이동 버튼 행44px는 기본 배율부터 공간을 유지해 두 손가락 확대가 끝나도 사진이 재중앙정렬되지 않는다. 전체 화면에서는 한 장의 선택 원본만 downscale 없이 보여 확대 디테일을 유지한다(업로드의 기존1280px 상한·썸네일·주변 원본 지연 로드는 유지).
