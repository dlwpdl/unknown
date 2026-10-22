# 장소 사진 채우기 — 2026-10-22 진행 기록

## 목표

카탈로그 장소 중 사진이 없는 곳을 오픈소스·업체 사진으로 채운다. 방문(gling Visited) 장소가 최우선, 그다음 밴쿠버부터 도시별 진행.

## 완료

- `city-places.photos.json` 스키마에 `discoveredVia: "Business site"` 추가.
  라이선스는 정확히 `Business-provided photo`, `licenseUrl == sourceUrl`일 때만 통과한다.
  위키미디어/Flickr/Openverse 검증은 그대로다 (`city-places.ts`, `refresh-city-places.py`, `city-places.test.mjs`).
- 방문 1호 HANDSON(Handson Steak and Frites, 밴쿠버 847 Denman St) 사진 등록 — 업체 사이트 3220×2576.
  `gling-visited.json`의 `photo` 필드에 있고, 카탈로그 사진이 없을 때 대체재로 쓰인다.
- 밴쿠버 사진 68 → **111 / 200**. 업체 사이트에서 자동 수집(https만, 중복·placeholder 필터).
- 테스트: `city-places` 47/47, `gling-visited` 6/6 통과.

## 남은 일 (89곳)

| 구분 | 수 | 상태 |
| --- | --- | --- |
| 웹사이트는 있으나 추출 실패 (403·JS 렌더링) | 49 | 미해결 |
| 웹사이트 없음 | 40 | 미해결 |

## 다음 세션 절차

1. Resy 수집. OpenTable은 로그인 세션에서도 403이라 쓰지 않는다.
   - 캡처 ID `cmvjanq50` (24시간 보관): `api-anything capture "https://resy.com/cities/vancouver-bc/search?query=<장소>"`
   - 핵심 응답 `api.resy.com/3/location/config` (200, 약 2.1MB JSON)
2. 그 JSON에서 장소별 이미지 URL을 뽑아 카탈로그 장소와 매칭한다. 매칭 실패는 비워 둔다(다른 장소 사진을 붙이지 않는다).
3. 수집분을 `Business site` 행으로 추가하고 `node --experimental-strip-types --test scripts/city-places.test.mjs`를 돌린다.
4. 밴쿠버가 끝나면 토론토 → 몬트리올 → 나머지 도시 순으로 같은 절차.

## 재사용 자산

- 수집 스크립트: `/tmp/fetch_site_photos.py` (업체 사이트용, `python3 -I fetch_site_photos.py vancouver <limit>`)
- OpenTable 로그인 프로필: `~/.api-anything/profile` (재사용 가능하나 403은 로그인과 무관)
- Wanderlog: 장소 페이지(`/place/details/<id>`)는 열리지만 검색 API가 없어 자동 매칭은 막혀 있다.

## 주의

- 자동 수집 사진은 **검수 전**이다. 브랜드 공통 이미지나 다른 지점 사진이 섞일 수 있으니 노출 전에 확인한다.
- 사진 데이터는 DB가 아니라 앱 번들 JSON이며 이미지는 외부 CDN URL만 저장한다. 호스팅이 바뀌면 카드가 깨질 수 있다.
