# 업체 후기

## 2026-10-09 확정: 근무 증빙을 확인한 근무 리뷰만 공개

사용자가 실제 근무 증빙을 요구해 앞선 근무 인증 미정 사항을 확정했다. 이용(`usage`)과 근무(`employment`) 리뷰는 동일 회사에서도 별개의 평가다. 회사·작성자·종류별로 한 건만 저장하고 수정한다. 점수는 각각 1~10점의 0.5점 단위이며, 공개 평균은 해당 종류의 인증·공개 후기 전체 원점수를 합산해 구한다. 표시 시 한 번만 소수 첫째 자리로 반올림한다(10·9.5·7 → 8.8). 공개 근무 평균에 미인증 후기를 섞지 않는다.

근무 증빙은 재직증명서·근로계약서·급여명세서의 사진 1장을 기존 사진 선택·WebP 압축·비공개 증빙 저장으로 제출한다. 회사명·작성자와 근무 기간을 확인할 수 있는 자료를 안내하고 주민등록번호·계좌번호·주소·급여액 등 불필요한 정보는 가리도록 한다. 선택은 로컬, 업로드는 저장 시만 수행한다. 업로드 자체는 인증이 아니다. MFA AAL2 권한 관리자가 실제 자료를 열고 확인 근거를 5~1000자 메모로 남겨야 인증한다. 작성자는 인증 상태를 지정할 수 없고, 승인 RPC는 정확한 증빙 경로·updated_at을 검사한다. 교체·제거하면 인증이 해제되어 다시 공개되지 않는다. 원본은 작성자와 권한 있는 관리자만 읽고, 회사·일반 이용자에게는 노출하지 않는다. 인증 전 근무 후기 본문도 작성자와 관리자에게만 보인다. 미인증 이용 의견의 기존 업체 공개 범위는 유지한다.

`0137_merchant_employment_reviews.sql`은 기존 행을 usage로 유지하며 review_kind·복합 UNIQUE를 추가한다. get_merchant_reviews의 3개 인자와 write_merchant_review의 5개 인자 overload는 종류를 반드시 검증한다. 기존 2/4개 인자의 API는 usage로 고정해 유지한다. 기존 안전 검사·신고·MFA 감사 로그·이미지 불변성·경합 삭제 방지·계정 삭제를 두 종류에 동일하게 적용한다. 회사 소유자의 자기 업체 평가는 서버에서 거부한다. 업체 inbox 및 신고 문맥 조회로 미인증 근무 원문을 우회 조회하지 못하게 한다. 새 bucket·의존성·AI 증빙 판독·크론을 만들지 않는다.

프로필은 기존 배너·로고·회사 정보 옆에 16px 반짝/서류가방 아이콘과 소수점 한 자리 평균만 표시한다. 각 점수를 누르면 해당 종류의 후기가 열린다. 상세 이용 평점은 굿반짝 10개, 상세 근무 평점은 간격 없이 이어진 얇은 바로 표시한다(2026-10-09 사용자 확정). 움직임은 한 번만 짧게 실행하고 reduce-motion과 언마운트 중단을 지킨다. 공개 독자 웹은 읽기 전용이며 종류별 페이지와 늦은 응답을 분리한다. 실제 원격 고객 증빙이나 테스트 후기를 만들지 않고 SQL·컴포넌트 fixture로 공개/비공개·재인증·중복 방지·평균 분리·권한·실패 보존을 검증한다.

2026-10-09 프로필 분류 확정: 실제 Mobbin LinkedIn의 게시글/채용 탭과 Glassdoor의 소개/리뷰/채용 탭을 확인했다. 사용자가 `output/design/gling-merchant-profile-tabs-2026-10-09.html`을 보고 “너무 좋음 이대로 반영해”로 앱과 웹 반영을 승인했다. 게시글·채용·리뷰·소개 네 탭, 실제 건수, 채용 중 표시, 0건 상태를 적용하며 작은 평점 헤더·배너·로고·두 리뷰와 공개/비공개 정책은 유지한다.

### 승인된 프로필 분류 구현

- 기본 탭은 게시글. 게시글은 해당 canonical 업체에 연결된 공개 글 중 `jobs` 외의 글, 채용은 `jobs` 태그의 현재 공개 모집 글이다. 기존 `private.listing_alive`를 재사용해 마감·만료 listing은 제외한다. 숨김/삭제·비활성 작성자·차단/신고·동의 철회/중단 업체는 건수와 목록에서도 제외한다. 작성자 전체 글이나 업체 비공개 초안은 업체 게시글로 추정하지 않는다.
- `get_merchant_profile_posts(p_merchant_id uuid,p_kind text='posts',p_offset integer=0)`는 공개 가능한 업체에 `{merchant_id,kind,post_count,job_count,posts,has_more}`를 반환하고, 부적격 업체에는 null. `kind`는 posts/jobs만 허용, offset 0~10000, 최신 작성시각/ID 내림차순으로 20건. `posts`는 기존 `get_public_post`의 공개 feed 행만 투영한다. 공유 `loadMerchantProfilePosts(client,merchantId,kind='posts',offset=0,viewerScope?)`는 회사/종류/건수/페이지를 검증하고 기존 feed 매핑·서명 사진을 재사용해 `posts: Post[]`와 `nextOffset`을 제공한다.
- 앱 `/company/[id]`와 공개 웹 `/company?id=...`는 실제 건수와 목록을 표시하고 글 선택 시 기존 글 상세를 연다. 별도 가짜 상세/로그인/운영시간/외부 링크를 만들지 않는다. 이용/근무 점수 선택은 리뷰 탭과 해당 종류로 이동한다. 채용 중은 채용 탭으로 이동한다. 소개는 실제 등록된 업종·지역·서비스·주소만 표시한다. 리뷰 건수는 두 종류의 인증 공개 합계다.
- 새 탭·목록·더 보기·재시도는 기존 interaction feedback, 44px 터치 영역, 선택 상태/키보드, 줄바꿈과 작은 화면을 지킨다. 로딩/오류를 0건으로 표시하지 않고, 계정/회사/탭 전환 후 늦은 응답과 중복 더 보기를 차단한다. 실패 재시도는 같은 범위의 기존 목록을 보존한다.
- 순서: RPC 권한/분류/정확한 전체 건수/페이지 SQL RED→GREEN → 공유 로더와 앱/웹 동작 RED→GREEN → 타입·관련 lint·전체 Node 검사·public export 읽기 경계·실제 화면 확인 → 해당 migration만 원격 적용 및 익명 재조회 → 기존 Journal 한 대의 글링 새로고침. 기존 미적용 migration, cron, 실제 업체 글/후기, 역할·안전 모니터링, 다른 작업 파일은 변경하지 않는다. 새 의존성/서버/worker/일정, App Store 업로드는 범위 밖이다.

## 목적과 범위
등록된 업체의 소개글에서 이용자가 점수와 선택 후기글을 남긴다. 영수증 인증 후기에만 공개 표시·전체 후기 열기를 제공하고, 미인증 후기는 작성자와 해당 업체에만 보여준다(승인된 관리자는 기존 안전 정책에 따라 검토). 동일 업체의 다른 소개글에서도 같은 후기 목록을 보여준다. 일반 게시글 댓글, 개인 중고거래 후기, 업체 계정 권한은 바꾸지 않는다. 2026-10-08 사용자가 선택 후기글·영수증 기반 공개 범위를 확정했다.

## 사용 흐름
업체 안내 아래 인증 후기만의 평균 점수·후기 수·최근 후기를 보여준다. 인증 표시가 있는 후기를 누르면 전체 내용을 연다. 로그인한 활성 계정은 1~10점, 0.5점 단위로 점수를 선택하고 300자 이내의 선택 후기글과 선택 영수증 사진 1장을 저장한다. 영수증 인증 전에는 업체에만 전달되는 상태를 명시한다. 본인 후기는 같은 항목을 수정한다. 로그인 전에는 로그인 안내를 제공한다. 공개 후기에는 기존 신고 흐름을 연결한다. 업체 웹 관리의 후기 메뉴에서 본인 업체의 비공개 의견까지 확인한다.

## 저장·API 계약
- `private.merchant_reviews`: canonical `merchant_id` + `author_id` UNIQUE, UUID 식별자, 정확한 numeric 점수 CHECK, nullable body, published/removed 상태, receipt_path, receipt_status(none/pending/verified/rejected), 인증자/인증 시각 및 created/updated 시각. 클라이언트 직접 쓰기 금지.
- `get_merchant_reviews(p_post_id uuid, p_offset integer = 0)`: 실제 공개 업체-소개글 관계를 확인. `{merchant_id, merchant_name, rating_average, review_count, my_review, can_review, reviews, has_more}` 또는 null. 공개 합계·평균·목록은 verified + published만 포함하며 최신 20건씩. 공개 리뷰 필드: `{id, author_id, nickname, score, body, created_at, updated_at, receipt_status}`. my_review는 status·receipt_path도 제공. 공개 필드에 비공개 연락처·미인증 원문·영수증 경로를 포함하지 않는다.
- `write_merchant_review(p_post_id uuid, p_score numeric, p_body text = null, p_receipt_path text = null)`: JWT 활성 작성자를 서버에서 결정하고 업체 기준 UPSERT. 기존 ID·작성 시각 유지. 중복 동시 요청도 추가 행을 만들지 못한다. removed 후기는 사용자가 복구하지 못한다. 응답 UUID. 범위 밖·0.5 이외 점수는 반올림 없이 거부한다. receipt_path null/생략은 기존 유지, ''는 제거, 신규 본인 저장 경로는 검증 후 pending으로 전환한다.
- `get_my_merchant_reviews(p_merchant_id uuid,p_offset integer = 0)`: 현재 활성·업체 YES·실제 승인된 업체 소유자만 해당 업체의 published 후기(미인증 포함)를 조회한다. `{reviews,has_more}`. 업체에 영수증 사진·경로를 공개하지 않는다.
- 비공개 Storage bucket `merchant-review-receipts`, 기존 이미지 선택/압축 사용, 계정 UUID/새 파일 UUID 경로에 INSERT, 기존 이미지 overwrite 금지. 작성자와 MFA 관리자만 본인/검토 사진을 읽는다. 비연결 업로드 정리와 계정 삭제의 개인정보 삭제 경로를 확인한다.
- 수동 인증: 관리자 AAL2·활성/현재 elevated session·감사 로그가 필수인 검증 RPC. 영수증 경로와 expected updated_at을 비교하여 바뀐 영수증을 잘못 인증하지 않는다. 승인·반려 뒤 서버 상태를 다시 조회한다. 사용자는 인증을 직접 설정하지 못한다. 자동 판독·유료 AI 호출은 포함하지 않는다.
- 서비스 안전 검사: `get_merchant_review_safety_content(p_target_id uuid)`, service_role 전용. 관리자: `get_admin_merchant_review_content(p_target_id uuid)`, 활성 MFA 관리자 + 감사 로그. `{authorId, text}`와 필요한 후기 문맥을 반환한다.

## 안전성과 디자인
미인증·점수만인 후기를 포함해 기존 서버 AI 안전 큐·키워드 경고·관리자 내용 조회·증거·신고·숨김을 연결하고 기존 콘텐츠 검사 범위를 보존한다. 미인증/숨김 후기와 비활성 작성자는 공개 목록·평균에서 제외한다. 중복 방지는 화면 버튼만이 아니라 DB 제약으로 보장한다. 영수증 사진에는 개인정보가 있을 수 있으므로 공개 URL을 만들지 않고 인증 표시만 공개한다. 기존 테마·Pressable·useInteractionFeedback를 재사용하며 터치 영역 44px 이상, 명확한 점수·오류·저장 상태·접근성 이름을 제공한다. Mobbin Mindtrip/Tripadvisor의 점수 요약과 후기 목록을 참고하되 10점 척도를 명시한다.

## 구현과 제외
앱과 업체 웹의 공유 상세 화면에 후기 UI를 넣는다. 외부 원본 URL 없는 업체 글도 지원하므로 외부 source 링크와 독립적으로 실제 업체-글 관계를 조회한다. 보상·추천 알고리즘·새 의존성·자동 게시·새 크론은 제외한다. 공개 독자 웹은 기존 읽기 전용 경계를 유지한다. 계정 또는 게시글 전환 후 늦은 응답이 다른 화면에 적용되지 않게 한다. 저장 실패 시 입력을 보존하고 재시도도 같은 후기를 수정한다. 영수증 업로드 뒤 저장 결과가 불확실하면 연결될 수 있는 사진을 지우지 않는다.

## 2026-10-08 추가: 업체 채널 프로필과 두 가지 리뷰 시안
사용자가 기존 10개 시안 완성 후 업체 프로필·리뷰 구현을 이어가도록 요청했고, 이어 근무 리뷰와 상품·서비스 이용 리뷰의 애니메이션을 각각 10개로 분리했다. `output/design/gling-work-review-motion-10-2026-10-08.html`과 `gling-use-review-motion-10-2026-10-08.html`을 먼저 완성하고 실제 움직임·19점수·반 칸·키보드·44px·320~1440px·reduced-motion을 검증했다. 시안 선택은 실제 앱 아이콘 확정이 아니다. 근무 인증·공개 정책은 사용자 답변 대기이며 기존 영수증 이용 리뷰와 합산하거나 근무 인증이 확정된 것처럼 표시하지 않는다.

채널 프로필은 기존 canonical 업체 하나를 사용한다. 앱 `/company/[id]`, 공개 읽기 웹 `/company?id=<uuid>`에서 가로 배너(약3.2:1), 원형 로고, 업체명·도시, 기존 등록된 업종·서비스 소개·주소, 인증 이용 리뷰를 보여준다. 소개글의 업체 제목에서 프로필을 열며 상세 모달을 닫은 뒤 이동한다. 개인 회원 프로필·회사명/소유권·동의/운영 상태를 변경하지 않는다. 기존 `services`를 소개로 재사용하므로 별도 소개 컬럼이나 새로운 텍스트 편집 기능을 만들지 않는다.

- `private.merchants.avatar_path`, `banner_path`: nullable, private `merchant-profile-images` bucket, 2MiB WebP, `<uploader_uuid>/<merchant_uuid>_<asset_uuid>.webp`. 기존 계정 삭제의 평면 파일 정리를 재사용한다. 저장 전 사진은 공개하지 않는다. 업로드는 실제 활성·업체 YES·소유 확인된 해당 업체 소유자만 가능. 객체 overwrite 금지.
- `get_merchant_profile(p_merchant_id uuid)`: 허락된 trial/paid 업체에 현재 공개·활성·차단/신고되지 않은 실제 연결 글이 있을 때만 `{id,name,city_id,city_name,industry,services,address,avatar_path,banner_path,review_post_id}` 반환. 연락처·소유자·동의 메모·비공개 리뷰를 포함하지 않는다. 사용 가능한 연결 글 ID로 기존 후기 API를 재사용한다. 저장된 공개 프로필 이미지에 한해서 익명 서명 읽기를 허용한다.
- `get_my_merchant_profile(p_merchant_id uuid)`: 기존 workspace 권한을 확인하고 위 프로필+`updated_at`+`can_edit` 반환. 변경 권한은 실제 활성·업체 YES·승인된 소유자에게만 부여한다. 권한 변경/계정 변경 뒤 늦은 응답으로 이전 데이터를 노출하지 않는다.
- `save_my_merchant_profile(p_merchant_id uuid,p_avatar_path text,p_banner_path text,p_expected_updated_at timestamptz)`: 실제 소유권 재확인, 회사 행 잠금, 서버 revision 비교, 본인 저장된 이미지 검증, 명시 null로 제거, 그대로인 경로는 유지. 성공 시 서버 저장본 재조회·비교를 통해서만 완료 표시. 실패/불확실 응답은 사진·입력 유지, 같은 경로 재시도. 새 파일과 기존 파일 삭제에는 동일 경로 잠금·미참조 조건을 적용하여 저장 경합 중 연결 사진을 지우지 않는다.
- 업체 관리에 `프로필` 탭과 배너/로고 선택·교체·제거·저장·공개 프로필 보기. 기존 사진 선택/압축과 피드백/테마 재사용. 본문·명칭·주소는 등록된 정보로만 표시한다. 개인 정보 삭제에 이 bucket과 프로필 참조를 연결한다.
- 공개 웹은 anonymous read-only client에 두 public getter와 공개 프로필 이미지 서명만 추가한다. 작성/업체 비공개 inbox/영수증/관리자 RPC가 public bundle에 들어가지 않도록 실제 export 검사를 확장한다.

검증: 실제 client RPC/sign/upload/revision/실패 보존의 작은 Node check, SQL 공개 범위·부적격/타업체/퇴출 owner·사진 위조/참조 삭제/경합·stale revision/계정 삭제, 실제 컴포넌트 HTML와 작은 화면 QA. 근무 인증 정책을 임의로 배포하지 않는다.

## 검증과 완료 조건
SQL pgTAP에서 경계·모든 half-step·직접 invalid insert·권한·동일 업체 다른 글·수정 ID 보존·다른 업체 독립·인증 후기만 평균/조회·미인증 원문 비노출·다른 업체 권한·receipt path 위조·인증 교체 경합·Storage RLS·관리 숨김·신고·안전 큐를 확인한다. RED 테스트를 먼저 실행한다. 클라이언트의 실제 validation/RPC·사진 저장 실패 경로를 Node 테스트로 확인한다. `npm test`, `npm run typecheck`, 관련 파일 ESLint, 관련 웹 export/boundary checks를 실행한다. 실제 컴포넌트로 HTML mock을 만들고 UI 동작·범위·후기 전체 열기·실패 입력 보존을 확인한다. 관련 migration만 적용하고 마지막에 기존 글링 시뮬레이터를 새로고침한다. 실제 고객 후기·영수증을 검증을 위해 만들지 않는다.

참고: https://mobbin.com/screens/cacc6642-66f5-481a-9936-ebba37066ef5 · https://mobbin.com/screens/e5a20195-0aa3-4a0b-abbc-9eaf6e838d86

## 2026-10-08 구현·검증 기록
근무 10개·이용 10개 애니메이션 HTML과 실제 공유 앱/공개 DOM 프로필·리뷰 HTML을 완성했다. 업체 관리의 프로필 사진 편집과 이용 후기 inbox, 공개 회사 프로필과 인증 이용 리뷰, MFA 관리자 영수증 검토를 연결했다. 영수증과 프로필 사진은 선택 시 로컬에서 준비하고 저장할 때 업로드하며, 실패 시 같은 사진을 재사용한다. 비연결 임시 파일 정리는 Storage의 저장 경합 잠금과 참조 삭제 거부 정책을 따른다.

관련 Node 전체 검사 445 통과·1 기존 skip, 관련 SQL 178+102 통과, 별도 세션 저장/사진 삭제 잠금, 타입·관련 lint, 최신 공개/업체 웹 export·읽기 경계, 실제 컴포넌트의 작은 화면·키보드·실패 보존 검사를 확인했다. 실제 고객 영수증이나 테스트 후기를 원격에 생성하지 않았다. 기존 공개 업체의 실제 익명 API에서 정확한 공개 필드와 회사-후기 연결을 확인했고 익명 작성·프로필 저장·관리자 조회·비연결 사진 서명을 거부하는 것도 확인했다.

연결 프로젝트의 별도 stage에서 기존 적용된 0134와 이전 원격 이력을 보존하고 0133/0135만 적용했다. 미적용 0125는 적용하지 않았다. 실제 배포본과의 diff를 먼저 확인해 safety-monitor의 후기 로딩 분기와 delete-account의 두 사진 bucket 정리만 배포했다. 실제 배포 후 비공개 bucket·권한·RLS·기존 안전 cron의 일정/명령 해시 보존을 재조회했다. 메인 iPhone 17 Pro의 글링을 다시 실행하고 정상 홈 화면을 확인했다. 다른 작업의 Journal 시뮬레이터 스트림은 유지했다.

웹 코드는 export·경계 검증까지이며 공개 호스팅 반영과 App Store 앱 업데이트는 이 기록의 완료에 포함하지 않는다. 근무 리뷰 인증/공개 정책과 실제 근무 리뷰 저장 기능은 미정이다. 실고객 계정에서 신규 영수증·배너 업로드를 테스트 목적으로 실행하지 않았다. 안전 ADR 관련 구형 SQL fixture의 이미 존재하던 MFA/queue-count 실패는 이번 변경으로 완화하거나 원격 테스트로 우회하지 않았다.

검증/복구 기록: `/Users/ash/Library/Application Support/gling/operations/merchant-reviews-20261009T034717Z`. 원격 Edge 원본은 `edge-before`에 보존했다. 문제가 생기면 새 기능 RPC의 실행 권한을 제한하고 검토한 이전 Edge 원본을 재배포한다. 새 후기/사진이나 기존 데이터는 삭제하지 않으며 기존 안전 cron은 유지한다.

## 2026-10-09 근무 증빙 구현·검증 기록

근무 리뷰의 앱/공개 웹/업체 inbox/관리자 검토와 증빙 제출을 연결했다. 이용·근무 공개 평균을 분리하고 10개 굿반짝·직장 창문 표시, 해당 목록 열기와 종류별 페이지를 적용했다. 근무 증빙 교체·제거는 인증을 해제하며 미인증 원문은 작성자·관리자 외에는 보이지 않는다. 같은 회사 소유자의 자기 평가는 서버에서 거부한다. 사용자가 실제 증빙 확인을 요청해 이전의 근무 인증 미정 기록을 이 정책으로 대체했다.

Node 전체 470 통과·1 기존 skip, SQL 근무159·이용178·프로필102 모두 통과, 타입·관련 lint·공개/업체 export·읽기 경계·실제 컴포넌트 HTML 3종을 확인했다. 다른 작업에서 추가한 관리자 팔레트에 맞게 검사 fixture의 Colors.admin을 보완했고 보안 assertion은 유지했다. 연결 원격 이력에 이미 적용된 0136을 보존하고 0137 하나만 dry-run/배포했다. 실제 원격 공개 getter·익명 작성 차단·종류 검증과 비공개 bucket·현재 MFA/Storage 함수·14개 cron 보존을 재조회했다. 원격 테스트 후기/증빙은 만들지 않았으며 기존 행 수를 유지했다. 메인 iPhone17Pro(4BB09B7D-BE13-406F-BEBD-51BB4767C3FE)의 글링을 재실행했고 Journal stream listener를 보존했다.

검증 기록: `/Users/ash/Library/Application Support/gling/operations/employment-reviews-20261009T081011Z`. 공개 웹 호스팅과 App Store 업데이트는 수행하지 않았다. 실제 근무자·자료의 진위는 권한 있는 관리자의 확인 대상이며 AI가 자동 인증하지 않는다.

## 2026-10-09 승인된 업체 프로필 분류 반영·검증

게시글·채용·리뷰·소개 네 탭을 실제 앱과 공개 웹에 연결했다. 게시글이 기본이며 canonical 업체에 연결된 실제 공개 글·진행 중 채용의 건수를 사용한다. 채용 표시와 평점은 해당 탭/리뷰 종류로 이동한다. 헤더는 작은 반짝·서류가방과 점수, 근무 상세는 얇은 4px 바를 유지한다. 조회 실패를 0건으로 표시하지 않으며 글이 없어도 네 탭과 실제 소개를 유지한다. 더 보기 실패 재시도는 기존 페이지를 보존하고, 신고/차단한 글은 기존 숨김 훅으로 즉시 제거해 재조회와 이전 응답에서도 복구되지 않도록 했다.

전체 Node 검사 498 통과·1 기존 skip, 타입 검사와 관련 ESLint 통과. 새 SQL pgTAP 89·기존 프로필102·근무159·이용178(총528) 통과. 실제 앱/공개 DOM 소스로 만든 클릭 가능한 예시에서 네 탭·건수·채용/평점 이동·소개·빈 목록·오류/재시도·키보드 탭 이동·320/390/768/1440px·44px 터치 영역을 확인했고 외부 요청/스크립트 오류가 없었다. 공개 웹 및 업체 웹을 분리 export하고 공개 파일의 관리자·작성 API 유입 차단 검사를 통과했다. 기존 단위 검사의 merchant export skip은 그대로이며 실제 최신 두 export는 검사했다.

연결 프로젝트 wjvahbdwmctzpkndqaxa의 기존 0138 이력을 보존하고 별도 stage에서 0139 하나만 dry-run/적용했다. 실제 원격 함수 본문이 테스트한 소스와 일치하고 security definer·빈 search_path·anon/authenticated 실행 권한을 확인했다. 익명 실제 API로 공개 업체8곳의 게시글8개·채용0개를 확인했고 잘못된 업체는 null, 잘못된 분류/offset은 거부됐다. 기존 posts422·merchant_posts8·reviews0과 14개 cron의 일정/명령 해시는 그대로다. 원격에 테스트 업체·글·후기·증빙을 만들지 않았다.

반영된 실제 컴포넌트 예시: `output/design/gling-merchant-profile-tabs-applied-2026-10-09.html`, `output/design/gling-merchant-profile-public-2026-10-09.html`. 원래 승인된 `gling-merchant-profile-tabs-2026-10-09.html`은 보존했다. 검증 기록은 `/Users/ash/Library/Application Support/gling/operations/merchant-profile-tabs-20261009T180500Z`다. 공개 호스팅 배포와 App Store 업데이트는 이 반영에 포함하지 않는다.

실제 GLING Journal(51A6BA64-7907-47E7-82AC-6386BA21F8D6)의 기존 Metro 연결을 새로 불러오고 기존 업체 프로필을 열었다. 끊어진 Orca 시뮬레이터 뷰를 동일 기기에 다시 연결했으며 새 기기를 부팅하지 않았다. 실제 native AX/탭 클릭으로 게시글1·채용0·리뷰0, 채용 빈 상태, 소개, 다시 게시글 목록을 확인해 사용자에게 프로필 화면을 띄워 두었다. 유일한 부팅 기기는 Journal이며 iPhone17Pro는 Shutdown을 유지한다.
