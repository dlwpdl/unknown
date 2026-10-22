# 장소 사진 채우기 — 2026-10-22 진행 기록

## 목표

카탈로그 장소 중 사진이 없는 곳을 오픈소스·업체 사진으로 채운다. 방문(gling Visited) 장소가 최우선, 그다음 밴쿠버부터 도시별 진행.

## 현재 커버리지

| 도시 | 사진 | 전체 | 비율 |
| --- | --- | --- | --- |
| vancouver | 147 | 200 | 73% |
| toronto | 45 | 154 | 29% |
| montreal | 24 | 101 | 23% |
| calgary | 21 | 128 | 16% |
| edmonton | 19 | 93 | 20% |
| winnipeg | 19 | 102 | 18% |
| saskatoon | 9 | 93 | 9% |
| ottawa | 10 | 127 | 7% |
| regina | 6 | 82 | 7% |
| saint-john | 6 | 67 | 8% |
| halifax | 9 | 93 | 9% |
| **합계** | **315** | **1240** | **25%** |

## 이번 세션에 한 일

- 스키마: `discoveredVia: "Business site"` 는 `license === 'Business-provided photo'` 와 `licenseUrl == sourceUrl` 일 때만 통과.
- 위키미디어 14장 추가. 오브젝트 좌표가 없어 이름이 정확히 일치하는 파일만 골랐다
  (Brockton Point, Empress of Japan, Nine O'Clock Gun, George Vancouver, Japanese Canadian War Memorial,
  Victory Square Cenotaph, City of Vancouver Archives, Vancouver City Hall, Lord Stanley, Robert Burns,
  Giardino, Lumiere, Nikkyu, Stanley Park 미니어처 기차).
- 업체 사이트 22장 추가. 49곳을 실제 브라우저로 렌더해서 가장 큰 사진을 뽑았다.
  JS로만 그려지는 사이트라 HTML 파싱으로는 og:image가 없던 곳들이다.
- 후보 43장을 콘택트시트로 눈으로 검수. 로고·placeholder·스톡사진·다른 지점 사진은 버렸다
  (Starbucks/McDonald's/Waves/JJ Bean 같은 체인은 지점이 다를 수 있어 보류).
- 테스트: `city-places` 47/47, `gling-visited` 6/6.

## 남은 일 — 밴쿠버 53곳

| 구분 | 대략 |
| --- | --- |
| 웹사이트 없음 (체인·소규모 카페) | 31 |
| 웹사이트는 있으나 Cloudflare 403·DNS 실패 | 15 |
| 사이트 사진이 전부 로고/일러스트/스톡 | 7 |

이 53곳은 위 두 수집기로는 더 안 나온다. 다음 후보 소스:
인스타그램·구글 비즈니스(로그인 필요), Wanderlog 장소 페이지(검색 API 없음).

## 재사용 자산 (저장소에 있음)

- `scripts/photo-source-render.py` — 업체 사이트를 Playwright로 렌더해 가장 큰 사진 수집. `python3 -I scripts/photo-source-render.py [limit]`
- `scripts/photo-source-commons.py` — Commons 파일 제목 목록 → 카탈로그 행. `python3 -I scripts/photo-source-commons.py pairs.json`
- 둘 다 `/tmp/*.json`으로만 쓰고, 검수 후 병합한다. 도시는 스크립트 안 `vancouver`를 바꿔서 지정.
- Wikidata 방식: OSM 태그 조회(Overpass) → `wikidata` QID → P18 이미지. 랜드마크에 잘 먹힌다.
  `node(id);out tags;` 로 한 번에 85개 노드를 받아왔다.

## 주의

- 사진 데이터는 DB가 아니라 앱 번들 JSON이고 이미지는 외부 CDN URL만 저장한다. 호스팅이 바뀌면 카드가 깨진다.
- 한 도시 사진은 200장이 상한이다(`city-places.ts` 검증). 지금 밴쿠버 147.
- 병합 후 `node --experimental-strip-types --test scripts/city-places.test.mjs` 필수.
  Commons `licenseUrl`이 `http://`이거나 `/deed.en`으로 끝나면 검증에서 떨어진다.
