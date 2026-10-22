-- Prepared for the owner's 2026-09-21 request. Default is a ROLLBACK preview.
-- No real account is reused. Seed identities and counters are synthetic.
-- To publish after the destination is confirmed, replace only the final ROLLBACK with COMMIT.
begin;
create temporary table city_info_seed (
 id uuid primary key, author_id uuid unique, city_id text, nickname text unique,
 tag_slug text, title text, body text, view_count integer
) on commit drop;
insert into city_info_seed values
  ('e64065b0-6ded-5f18-a852-b2a38a897bd0'::uuid, 'bfe21c78-da18-5a49-908f-3d3afae8144d'::uuid, 'vancouver', '비오는지도', 'life', '시월은 스탠리파크에만 있는 길이 아니네요', '밴쿠버 시 안내를 보면 시월 해안길은 컨벤션센터에서 스패니시뱅크스까지 이어져요. 스탠리파크 구간만 생각했다면 폴스크릭 쪽도 지도에 넣어보세요. 한 번에 전부 걷기보다 출발점과 돌아올 교통편을 정해서 일부 구간만 걷는 코스로 잡아도 좋겠어요.

출처: https://vancouver.ca/parks-recreation-culture/seawall.aspx', 143),
  ('a021177e-9257-5946-9e46-2b2eec7be83c'::uuid, '48245f66-8000-5b9c-8aea-54d15e7f1786'::uuid, 'vancouver', '솔방울주머니', 'travel', '스탠리파크, 바닷길과 숲길 중 어디부터?', '스탠리파크에는 바다를 따라 걷는 시월뿐 아니라 공원 안쪽 산책로도 있어요. 물가 풍경을 보고 싶은 날과 숲을 걷고 싶은 날의 코스를 나눠 생각해볼 수 있겠네요. 공원 규모가 큰 만큼 안내 지도를 먼저 보고, 당일 통제 공지도 확인하고 출발하세요.

출처: https://vancouver.ca/parks-recreation-culture/stanley-park.aspx', 38),
  ('50899edb-8c57-52c4-9d6d-1560a1ae3acd'::uuid, '4be0cb69-384e-56d2-ae98-cf7f317d0767'::uuid, 'vancouver', '언덕위귤', 'travel', '퀸엘리자베스 공원에서 전망 보러 가기', '퀸엘리자베스 공원은 밴쿠버 시내와 산 쪽 전망을 볼 수 있는 공원이에요. 정원과 블로델 온실도 같은 공원에 있어서 관심 있는 곳을 묶어 둘러볼 수 있어요. 공원 산책과 유료 시설 관람은 별개이니 온실까지 갈 계획이면 운영 안내를 따로 확인해보세요.

출처: https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx', 117),
  ('612a2be7-f3aa-5b36-a19a-006637bdee83'::uuid, '2f30b0bb-c687-50c5-8c57-bf4da94eb511'::uuid, 'vancouver', '초록우산끝', 'life', '비 오는 날 후보로 적어둘 블로델 온실', '퀸엘리자베스 공원 안의 블로델 온실은 실내에서 식물과 새를 볼 수 있는 공간이에요. 야외 산책이 부담스러운 날의 나들이 후보로 넣어둘 만하겠네요. 계절에 따라 방문 시간이 달라질 수 있으니 입장료와 운영시간은 시청 공식 안내에서 확인하세요.

출처: https://vancouver.ca/parks-recreation-culture/bloedel-conservatory.aspx', 59),
  ('a48d38f1-b449-5e13-b229-1b2bbc9ae198'::uuid, '4eceb2cf-5a52-5568-af07-de73ff0dd596'::uuid, 'vancouver', '시장바구니', 'food', '그랜빌아일랜드 퍼블릭마켓은 이런 곳이에요', '그랜빌아일랜드 퍼블릭마켓에는 농산물, 베이커리, 식재료와 먹거리를 파는 상점들이 모여 있어요. 식사만 할지 장도 볼지 정해두면 둘러보기 편하겠어요. 매장별 메뉴와 가격은 다르니 특정 가게가 가장 싸다거나 맛있다고 단정하기보다는 공식 상점 목록부터 참고해보세요.

출처: https://granvilleisland.com/public-market', 43),
  ('09d26025-1fdf-56ed-afae-b4198b7f19b1'::uuid, 'ce273bca-ad45-50bb-b3d7-ef6021a90e4c'::uuid, 'vancouver', '책갈피구름', 'education', '다운타운에서 도서관 찾을 때 Central Library', '밴쿠버 공공도서관 Central Library는 다운타운에 있는 중앙도서관이에요. 공식 지점 페이지에서 운영시간과 이용 시설을 한 번에 확인할 수 있어요. 공부나 독서를 하러 갈 계획이면 행사 일정도 같이 보고, 조용히 이용할 공간이 필요한 경우에는 현장 안내를 확인해보세요.

출처: https://www.vpl.ca/branches/central', 100),
  ('3266eeeb-e6ac-510c-8356-a18321a05c01'::uuid, 'c09404bf-88a7-51fd-a4f0-1759650607f2'::uuid, 'vancouver', '물결한모금', 'transport', '노스밴 갈 때 씨버스도 교통편이에요', '씨버스는 다운타운 Waterfront와 노스밴쿠버 Lonsdale Quay를 연결하는 대중교통이에요. 이름만 보고 관광 유람선으로 생각하기 쉽지만 TransLink 교통망의 일부랍니다. 노스쇼어에 갈 일이 있다면 버스나 차량 경로와 함께 비교해보고, 막차와 당일 운행 정보는 공식 시간표에서 확인하세요.

출처: https://www.translink.ca/schedules-and-maps/seabus', 214),
  ('02c58f8f-ac99-5010-a46b-64517562fdb7'::uuid, '49468bf2-8df8-5524-8478-3100940b9c7f'::uuid, 'vancouver', '공항가는참새', 'transport', '캐나다라인 탈 때 목적지 표시 한 번 더', '캐나다라인은 다운타운에서 YVR 공항과 리치몬드로 이어지는 노선이에요. 공항행과 Richmond–Brighouse행 목적지가 다르니 승강장 전광판을 확인하고 타세요. 짐이 많은 날에는 목적지 역의 출입구와 엘리베이터 위치도 미리 찾아두면 이동 계획을 세우기 편해요.

출처: https://www.translink.ca/schedules-and-maps/skytrain', 198),
  ('d32d23d2-bc4a-5013-822d-7a6c5d1e97cb'::uuid, 'ac1f7971-aea0-5180-8d57-1c63ef2a7c7a'::uuid, 'vancouver', '동쪽창가', 'settlement', '버나비·뉴웨스트·써리 이동할 때 보는 노선', 'Expo Line은 밴쿠버 다운타운과 버나비, 뉴웨스트민스터, 써리를 연결해요. 다만 모든 열차의 종착역이 같지는 않아서 노선 색깔만 보고 타기보다 목적지 표시도 봐야 해요. 처음 가는 동네라면 TransLink 노선도에서 내릴 역과 환승역을 먼저 확인해두세요.

출처: https://www.translink.ca/schedules-and-maps/skytrain', 116),
  ('3739b410-f333-5c00-aee6-ce4ff791c271'::uuid, '048d0a72-bff5-5696-98ae-f5d95df9eab4'::uuid, 'vancouver', '포트무디메모', 'transport', '코퀴틀람 쪽 나들이는 밀레니엄라인 확인', 'Millennium Line은 이스트밴쿠버에서 버나비를 지나 포트무디와 코퀴틀람으로 이어져요. 차 없이 동쪽 생활권을 둘러볼 때 참고할 노선이에요. 역에서 최종 목적지까지는 버스나 도보 이동이 추가될 수 있으니 역 이름만 보고 끝내지 말고 마지막 구간도 같이 확인해보세요.

출처: https://www.translink.ca/schedules-and-maps/skytrain', 189),
  ('a7b1587f-9d84-5a3c-9f8d-fdf7038cc3e7'::uuid, 'f327c630-ce49-5d4b-b4fb-730f50311905'::uuid, 'toronto', '블루어도토리', 'travel', '하이파크 산책, 공식 지도로 코스 골라보기', '하이파크에는 산책로와 정원 등 여러 공간이 있고 TTC로 접근할 수 있어요. 한 번에 모두 돌아보려 하기보다 보고 싶은 구역을 먼저 고르면 동선을 짜기 좋겠어요. 산책 전에는 시청 공원 페이지의 지도와 방문 안내를 확인해보세요.

출처: https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/high-park/', 187),
  ('327e5283-efa3-5cd0-abcc-f384ea7179aa'::uuid, '33632488-6d24-5fb8-8430-ba9b6e9ccc17'::uuid, 'toronto', '호수옆연필', 'travel', '토론토아일랜드는 돌아오는 배 시간도 같이', '토론토 시 공식 사이트에서 아일랜드 페리 노선과 시간표, 승선 정보를 확인할 수 있어요. 섬에 들어가는 시간만 정하기보다 돌아오는 편까지 함께 보는 게 좋겠죠. 계절과 운항 상황에 따라 일정이 바뀔 수 있으니 오래된 여행 글의 시간표 대신 당일 안내를 참고하세요.

출처: https://www.toronto.ca/explore-enjoy/toronto-island-ferries/', 56),
  ('a859d87b-14f6-54a8-9fcb-25130d5cf111'::uuid, 'dc37bc86-48e9-575d-aad5-8333e702820b'::uuid, 'toronto', '마켓앞토스트', 'food', '세인트로렌스마켓 가기 전에 볼 페이지', 'St. Lawrence Market 공식 사이트에는 시장 운영시간과 판매점 안내가 있어요. 식재료를 사러 가는지, 먹거리를 둘러보러 가는지에 따라 상점 목록을 먼저 찾아보면 좋겠어요. 요일별로 이용할 수 있는 시장과 시간이 다를 수 있으니 방문일 기준으로 확인하고 가세요.

출처: https://www.stlawrencemarket.com/', 203),
  ('c5e18c8d-2af1-52cd-ba99-c00880149cd5'::uuid, '79ee6ee8-57ca-5951-b408-e06a6799973a'::uuid, 'toronto', '분리수거메모', 'housing', '이거 어느 통에 버리지? 토론토 Waste Wizard', '토론토 시에는 버릴 물건을 검색해 배출 방법을 확인하는 Waste Wizard가 있어요. 포장재가 헷갈릴 때 다른 도시의 분리배출표를 그대로 따르기보다 토론토 기준을 찾아보세요. 건물 공용 수거함을 쓴다면 관리사무소의 배출 장소 안내도 함께 확인하면 좋겠어요.

출처: https://www.toronto.ca/services-payments/recycling-organics-garbage/waste-wizard/', 166),
  ('064456f7-c0b6-5bfd-9d44-21897747d1d4'::uuid, '47653465-5e1b-5812-a4e4-b27fd01fc8e2'::uuid, 'toronto', '서가사이달', 'education', '토론토 도서관 처음 쓸 때 찾을 메뉴', 'Toronto Public Library의 이용 안내에는 카드 발급, 자료 검색, 대출과 계정 관리 메뉴가 모여 있어요. 처음 이용한다면 가까운 지점의 운영시간부터 확인해보세요. 카드 발급에 필요한 조건과 준비 서류는 공식 카드 안내에서 확인하면 방문 준비에 도움이 돼요.

출처: https://tpl.ca/using-the-library/', 55),
  ('fe4b47e6-3c83-56f0-8fef-ac0c2eb776b5'::uuid, '087aa95e-575a-5e94-9a9d-811e0e50a52b'::uuid, 'toronto', '저녁책산책', 'life', '책 고를 때 TPL 온라인 목록도 활용해요', 'Toronto Public Library는 온라인에서 책과 오디오북 등 자료를 찾아볼 수 있어요. 도서관에 가서 서가만 둘러보는 방법 말고, 관심 있는 제목을 미리 검색하는 방법도 있답니다. 소장 여부와 대출 가능 상태를 보고 방문할 지점을 고르면 헛걸음을 줄이는 데 도움이 되겠어요.

출처: https://tpl.ca/using-the-library/', 227),
  ('56d56971-2b19-51ad-9871-789992938f07'::uuid, '6cdcdb88-a406-523f-aff7-6554e0278769'::uuid, 'toronto', '전차창문', 'transport', 'TTC 출발 전에 Service advisories 확인', 'TTC 공식 사이트에는 노선과 시간표 외에 Service advisories 메뉴가 따로 있어요. 같은 목적지라도 운행 변경이 있으면 평소 경로와 달라질 수 있으니 출발 전에 확인해보세요. 특히 약속 시간이 정해진 날에는 Trip planner와 운행 공지를 같이 보는 습관이 유용하겠어요.

출처: https://www.ttc.ca/riding-the-ttc', 121),
  ('4fd63441-5677-5e2a-9b8f-f456022a9102'::uuid, 'e9857780-d4c1-5ab3-a223-7d4e4392e602'::uuid, 'toronto', '환승하는수달', 'transport', '공항 가는 TTC 정보는 공식 안내부터', 'TTC 이용 안내에는 공항 이동을 위한 Service to the airport 항목이 있어요. 공항에 간다고 무조건 같은 정류장이나 노선을 이용하는 건 아니니 출발 위치와 도착 공항을 정확히 넣어 확인하세요. 비행기 시간에 맞춰 계획할 때는 환승과 짐 이동에 필요한 시간도 여유 있게 잡아두세요.

출처: https://www.ttc.ca/riding-the-ttc', 34),
  ('fb98318b-914d-5fe8-92f0-528855a7dbde'::uuid, '08db325f-9c20-537a-8e88-4418cecf447b'::uuid, 'toronto', '벽돌골목빛', 'travel', '디스틸러리 디스트릭트, 행사 날짜는 따로 확인', '토론토 Distillery Historic District 공식 사이트에는 상점, 음식점과 행사 안내가 있어요. 동네를 둘러보는 일정과 특정 행사에 참여하는 일정은 나눠서 계획하면 좋겠어요. 온라인 사진에 보이는 장식이나 마켓이 늘 열리는 것은 아니니 방문하려는 날의 안내를 먼저 확인하세요.

출처: https://www.thedistillerydistrict.com/', 300),
  ('28f70854-dd1c-551e-8d03-6dc7dea72f93'::uuid, '8a9dc553-03cd-5013-8248-0a0f0d66f220'::uuid, 'toronto', '초록벽돌길', 'life', '에버그린 브릭웍스 일정 찾아보기', 'Evergreen Brick Works는 시장과 여러 프로그램을 운영하는 토론토의 공간이에요. 공식 사이트에서 방문 안내와 행사 일정을 확인할 수 있어요. 그냥 둘러보는 날인지 프로그램에 참여하는 날인지 정한 뒤, 해당 날짜의 운영 여부와 예약 조건을 확인해보세요.

출처: https://www.evergreen.ca/evergreen-brick-works/', 277),
  ('a35e5b22-049d-5958-a300-216aceda2d06'::uuid, 'cc3ea647-6ac1-5ffc-ba83-8d4724d2e0f1'::uuid, 'montreal', '몽루아얄잎새', 'travel', '몽루아얄 산책할 때는 지정 산책로로', '몬트리올 시는 몽루아얄 공원을 자연과 전망, 역사적 가치를 함께 가진 공간으로 소개해요. 자연 보호를 위해 지정된 길 안에서 이동해달라는 안내도 있어요. 전망을 보러 가더라도 샛길로 지름길을 찾기보다 공식 지도를 보고 코스를 골라보세요.

출처: https://montreal.ca/lieux/parc-du-mont-royal', 121),
  ('048db4b8-efaf-5880-bccb-1bf0407f87a0'::uuid, '58ccb286-f809-5c83-91f5-0b249eb68fa0'::uuid, 'montreal', '장탈롱바구니', 'food', '장탈롱시장은 리틀이탈리에 있어요', 'Jean-Talon Market은 몬트리올 리틀이탈리에 있는 상설 공공시장이에요. 농식품과 지역 생산품을 둘러볼 수 있는 곳이라 장보기나 먹거리 탐색 코스로 살펴볼 만해요. 판매 품목과 가격은 가게와 시기에 따라 다르니 방문일의 상점 안내를 참고하세요.

출처: https://www.marchespublicsduquebec.ca/en/marches-publics/marche-jean-talon/', 237),
  ('adb78563-1a96-5238-a50c-b889e91dd3e3'::uuid, '2212d766-7329-5611-847e-ee0f59c8eb0e'::uuid, 'montreal', '아트워터오후', 'shopping', '아트워터시장도 공식 마켓 안내에서 찾아봐요', 'Atwater Market은 몬트리올 공공시장 운영기관이 관리하는 시장 중 하나예요. Jean-Talon만 알고 있었다면 다른 시장도 함께 비교해볼 수 있겠네요. 판매점과 계절별 운영 안내를 확인하고, 장을 많이 볼 계획이라면 돌아오는 이동편부터 정해두세요.

출처: https://www.marchespublics-mtl.com/fr/a-propos', 166),
  ('5c9bfe7d-93b1-5f3a-970b-be78fb32e85c'::uuid, '04528f50-f69f-5ecf-a9d5-cc9b092f2ba2'::uuid, 'montreal', '운하옆돌멩이', 'travel', '라신운하, 풍경 뒤에 있는 역사도 보기', 'Lachine Canal은 캐나다 국립사적지로 지정된 운하예요. 몬트리올의 교통과 산업 발전에서 어떤 역할을 했는지 Parks Canada 안내에서 읽어볼 수 있어요. 물가 풍경만 보는 코스에 역사 안내를 조금 곁들여도 재미있겠네요. 방문 전 현장 접근 안내도 확인해보세요.

출처: https://www.pc.gc.ca/apps/dfhd/page_nhs_eng.aspx?id=627', 257),
  ('ba806ab4-ab3d-5853-b5b8-3f20ae39c6ad'::uuid, '3af69d3c-ebe8-5e33-9f8c-e62a1abc7e24'::uuid, 'montreal', '우편번호수첩', 'housing', '몬트리올 쓰레기 수거일은 우편번호로 확인', '몬트리올 시 Info-collectes에서는 우편번호로 수거 정보를 찾을 수 있어요. 같은 도시라도 사는 구역이 다르면 수거 일정이 다를 수 있으니 이사한 뒤에는 새 주소 기준으로 다시 확인하세요. 음식물, 재활용품 등 어떤 종류를 언제 내놓는지 함께 살펴보면 좋아요.

출처: https://montreal.ca/en/services/collection-schedules', 294),
  ('e92fcc81-4170-5c37-8965-3b0561c6b9f4'::uuid, '81c6d246-f1fb-5956-8092-4d437caeae8e'::uuid, 'montreal', '불어책갈피', 'education', '몬트리올 시립도서관 회원 가입 안내', '몬트리올 19개 자치구 주민은 시립도서관 회원 가입을 무료로 할 수 있어요. 도서관 자료와 서비스를 이용하려면 공식 페이지에서 본인에게 맞는 가입 구분과 준비 사항을 확인해보세요. 어린이 회원은 보호자 관련 안내도 있으니 가족이 함께 가입할 때 참고하면 좋겠어요.

출처: https://montreal.ca/en/join-montreal-libraries', 280),
  ('2c7690d8-aa60-5a1b-94f7-d2e17e2f02bd'::uuid, '75513359-f87a-5b69-9bde-8261e0854bb6'::uuid, 'montreal', '두바퀴메이플', 'transport', 'BIXI는 반납할 때 초록불까지 확인', 'BIXI 공식 안내에 따르면 자전거를 거치대에 넣은 뒤 초록불이 켜져야 정상 반납이에요. 빨간불이면 잠기지 않은 상태일 수 있으니 그대로 두고 떠나지 마세요. 목적지 근처 거치대의 빈자리도 미리 확인해두면 반납할 곳을 찾는 데 도움이 돼요.

출처: https://bixi.com/en/how-to-use-the-bixi-service/', 84),
  ('bb0c4c9d-5d09-5eb0-9109-8f58cb5cb014'::uuid, '49392196-fb82-5ea3-bced-4b7bb76dcec0'::uuid, 'montreal', '메트로한칸', 'transport', '몬트리올 메트로는 STM 안내에서 노선 확인', '몬트리올 메트로의 공식 운영 정보는 STM 사이트에서 확인할 수 있어요. 처음 가는 역이라면 노선도뿐 아니라 운행 상태와 역별 안내도 같이 살펴보세요. 환승이나 접근 가능한 출입구가 중요한 일정이라면 출발 직전에 한 번 더 확인해두는 편이 좋겠어요.

출처: https://www.stm.info/en/info/networks/metro', 37),
  ('c368c0c5-47fa-52ea-bac5-a3e7d0c79fdd'::uuid, '21e4d27b-49b2-5587-a3ec-9639beaa589a'::uuid, 'montreal', '정원그림자', 'travel', '몬트리올 식물원은 보고 싶은 정원부터 고르기', '몬트리올 Jardin botanique에는 여러 주제의 정원과 온실이 있어요. 식물원 공식 방문 안내와 지도를 보고 관심 있는 구역부터 골라보세요. 야외 정원과 온실, 특별 프로그램은 이용 조건이 같지 않을 수 있으니 방문일의 티켓과 운영시간도 확인하는 게 좋아요.

출처: https://m.espacepourlavie.ca/en/guided-tours-garden', 242),
  ('5be79b5e-203e-572b-9415-ff73c1a0254f'::uuid, '6aa367e6-70a0-5702-a758-af383ce1503c'::uuid, 'montreal', '올드포트바람', 'life', '올드포트 나들이 전에는 시설별 안내 확인', '몬트리올 Old Port 공식 사이트에는 여러 즐길 거리와 행사 안내가 모여 있어요. 물가를 둘러보는 일정과 유료 시설을 이용하는 일정은 따로 생각하면 예산을 잡기 편하겠네요. 가려는 시설이 있다면 각각의 운영시간과 예약 여부를 확인하고 출발하세요.

출처: https://www.oldportofmontreal.com/', 48),
  ('55bfb730-68a6-5199-b457-2d7aa2763668'::uuid, '9693606b-6fb3-50dc-ad2e-a6c23514c907'::uuid, 'edmonton', '강변자작나무', 'travel', '리버밸리는 공원 하나의 이름만은 아니에요', '에드먼튼 시는 리버밸리의 여러 공원과 산책 공간을 공식 목록으로 안내하고 있어요. 막연히 리버밸리로 가기보다 출발할 공원을 하나 고르면 동선을 정하기 편해요. 걷기나 자전거 타기처럼 하고 싶은 활동에 맞춰 공원별 시설과 접근 경로를 확인해보세요.

출처: https://www.edmonton.ca/activities_parks_recreation/parks_rivervalley/river-valley-parks', 156),
  ('c6009576-44b1-546c-b49e-fbb96f154438'::uuid, '1b8858a7-d4f4-5e73-b589-72e1a666cb4f'::uuid, 'edmonton', '피라미드새싹', 'life', '머타트 온실은 실내 식물 나들이 후보', 'Muttart Conservatory는 에드먼튼 리버밸리에 있는 실내 식물 관람 시설이에요. 날씨와 관계없이 식물을 보고 싶은 날의 후보로 알아볼 수 있겠어요. 특별 전시와 입장 조건은 바뀔 수 있으니 방문 날짜를 정한 뒤 시청 공식 안내를 확인하세요.

출처: https://www.edmonton.ca/attractions_events/muttart-conservatory', 116),
  ('751b8af4-9740-5311-9349-c51942d73be5'::uuid, 'a1effdc4-5fae-5cbc-8c3f-fc1473a9042d'::uuid, 'edmonton', '백번가구름', 'transport', '다운타운에서 강변으로, 100 Street Funicular', '100 Street Funicular는 에드먼튼 다운타운과 리버밸리를 연결하는 시설이에요. 시청 안내에는 운영시간과 날씨에 따른 운휴 조건도 나와 있어요. 경사 이동을 줄이려고 이용할 계획이라면 당일 시설 공지를 확인하고, 운휴 중일 때의 이동 방법도 함께 생각해두세요.

출처: https://www.edmonton.ca/activities_parks_recreation/parks_rivervalley/funicular', 237),
  ('e7e9876a-13c2-5c4a-ab80-03f11b41799a'::uuid, '6f8fc36b-529b-50db-af21-acb4fa66b520'::uuid, 'edmonton', '수거요일노트', 'housing', '에드먼튼 이사 후엔 WasteWise 확인', 'WasteWise는 에드먼튼 시의 쓰레기 배출 안내 도구예요. 수거 일정과 품목별 분리배출 방법을 찾을 때 이용할 수 있어요. 새 집으로 옮겼다면 예전 주소의 요일을 그대로 기억하기보다 새 주소 기준으로 확인하고 알림도 설정해보세요.

출처: https://www.edmonton.ca/programs_services/apps_mobile/wastewise-app', 272),
  ('c5252b08-4acf-579c-abc7-a71f44601a5d'::uuid, 'e772f774-91de-5571-8e9e-dbe051186cdd'::uuid, 'edmonton', '프레리책장', 'settlement', '에드먼튼 주민이라면 EPL 카드부터 살펴봐요', 'Edmonton Public Library는 에드먼튼 주민에게 무료 도서관 카드를 제공해요. 책뿐 아니라 다양한 자료와 서비스를 이용할 수 있답니다. 주민이 아닌 경우에는 적용되는 이용 방식이 다를 수 있으니 공식 회원 안내에서 본인에게 맞는 항목을 확인해보세요.

출처: https://www.epl.ca/membership/', 124),
  ('2e46f385-3d32-593e-9a5d-d62f44b9ed34'::uuid, '4efe7e58-340d-5a7a-9999-7c282d6018f7'::uuid, 'edmonton', '만들기참새', 'education', 'EPL에는 메이커스페이스도 있어요', '에드먼튼 공공도서관은 Makerspace에서 여러 제작 장비를 이용할 수 있다고 안내해요. 도서관을 책 빌리는 곳으로만 생각했다면 이런 서비스도 찾아볼 만하겠네요. 장비마다 예약이나 교육 조건이 다를 수 있으니 원하는 작업에 맞는 이용 안내를 먼저 확인하세요.

출처: https://www.epl.ca/membership/', 113),
  ('9092a077-402f-59b3-80b8-e7b0f6343e0e'::uuid, '6c9ef47f-e5c1-5358-977c-4260b2926e11'::uuid, 'edmonton', '수요일서가', 'education', 'EPL 프로그램에서 영어와 독서 모임 찾기', 'EPL은 영어 학습 수업, 스토리타임, 독서 모임 같은 프로그램도 안내하고 있어요. 관심 있는 주제가 있다면 행사 목록에서 연령대와 지점, 날짜를 함께 확인해보세요. 프로그램에 따라 자리가 정해져 있을 수 있으니 참여 전에 신청 여부를 살펴보면 좋겠어요.

출처: https://www.epl.ca/membership/', 107),
  ('dbdd8462-4f4c-5433-a56a-c3a4ee6f0b20'::uuid, '037e2821-46ca-5d82-8241-f001f477bcdc'::uuid, 'edmonton', '주말운동화', 'life', '시 프로그램 찾을 때 move.learn.play', '에드먼튼 시의 move.learn.play에서 프로그램과 시설 예약 정보를 찾아볼 수 있어요. 운동 수업이나 공원 이용을 알아볼 때 여러 검색 결과를 헤매기보다 공식 안내에서 시작해보세요. 원하는 날짜와 장소를 정하고 이용료, 남은 자리와 예약 조건을 확인하면 계획하기 수월해요.

출처: https://movelearnplay.edmonton.ca/', 51),
  ('5f4af8cb-e1e1-521d-8ced-343f76fdeb1a'::uuid, 'e64f591a-676e-5778-8a10-fc892105f91c'::uuid, 'edmonton', '동물그림수첩', 'travel', '에드먼튼 동물원 일정 찾는 공식 경로', 'Edmonton Valley Zoo는 에드먼튼 시의 관광시설 안내에 올라 있는 방문 장소예요. 가족 나들이를 계획한다면 시청의 Attractions and Events 페이지에서 동물원 안내로 들어갈 수 있어요. 운영시간과 입장권, 당일 프로그램은 방문 날짜에 맞춰 확인하세요.

출처: https://www.edmonton.ca/attractions-events', 90),
  ('b42e7b24-1dce-5c8a-8e2c-bab9c8e88d5c'::uuid, 'cc10d780-bb2e-5c0e-8bde-76030655ef1a'::uuid, 'edmonton', '오래된전차길', 'travel', 'Fort Edmonton Park는 방문 일정부터 확인', 'Fort Edmonton Park는 에드먼튼 시가 소개하는 관광 명소 중 하나예요. 관심이 있다면 공식 시설 안내에서 방문 가능한 날짜와 프로그램을 먼저 살펴보세요. 계절별 운영이나 특별 행사 조건이 다를 수 있으니 언제나 같은 방식으로 입장할 수 있다고 생각하지 않는 게 좋겠어요.

출처: https://www.edmonton.ca/attractions-events', 291);
do $$ begin
 assert (select count(*) from city_info_seed)=40, 'Expected 40 posts';
 assert (select count(distinct lower(btrim(nickname))) from city_info_seed)=40, 'Nicknames must be globally unique across all cities';
 assert not exists(select 1 from city_info_seed s join public.profiles p on lower(btrim(p.nickname::text))=lower(btrim(s.nickname)) where p.id<>s.author_id), 'Nickname already belongs to another profile';
 assert not exists(select 1 from city_info_seed s join public.profiles p on p.id=s.author_id where p.city_id<>s.city_id or p.nickname::text<>s.nickname), 'Seed profile must keep its independent city and nickname';
 assert (select count(*) from (select city_id from city_info_seed group by city_id having count(*)=10) x)=4, 'Expected 10 per city';
 assert not exists(select 1 from city_info_seed s left join public.cities c on c.id=s.city_id where c.id is null or not c.is_open), 'City must be open';
 assert not exists(select 1 from city_info_seed s left join public.tags t on t.slug=s.tag_slug where t.id is null), 'Missing category';
 assert not exists(select 1 from city_info_seed s join auth.users u on u.id=s.author_id where u.email is distinct from s.author_id::text||'@seed.gling.invalid'), 'Author ID collision';
 assert not exists(select 1 from city_info_seed s join public.posts p on p.id=s.id where p.author_id<>s.author_id or p.title<>s.title or p.body<>s.body), 'Post ID collision';
end $$;
insert into auth.users (id,email,raw_app_meta_data,raw_user_meta_data)
select author_id,author_id::text||'@seed.gling.invalid','{}'::jsonb,
 '{"seed":true,"batch":"city-info-2026-09-21"}'::jsonb from city_info_seed
on conflict(id) do nothing;
insert into public.profiles (id,nickname,city_id,bio,verification_level,consent_version,
 terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select author_id,nickname::citext,city_id,
 'Gling 운영팀의 도시 정보용 샘플 프로필입니다. 닉네임과 초기 조회수는 합성 데이터입니다.',
 1,'synthetic-seed',now(),now(),now() from city_info_seed
on conflict(id) do nothing;
with inserted as (
insert into public.posts (id,author_id,city_id,tag_id,title,body,view_count,created_at)
select s.id,s.author_id,s.city_id,t.id,s.title,s.body,s.view_count,
 '2026-09-21 12:00:00'::timestamp at time zone c.timezone
from city_info_seed s join public.tags t on t.slug=s.tag_slug
join public.cities c on c.id=s.city_id
on conflict(id) do nothing
returning id,created_at,view_count
)
insert into private.post_view_pulse(post_id,bucket,views)
select id,date_bin(interval '10 minutes',created_at,'2000-01-01'::timestamptz),view_count from inserted;
-- The normal insertion trigger assigns the current local day; preserve the requested fixed date.
update public.posts p set posted_on='2026-09-21' where p.id in(select id from city_info_seed)
 and p.posted_on is distinct from '2026-09-21'::date;
do $$ begin
 assert (select count(*) from public.posts p join city_info_seed s using(id)
   where p.author_id=s.author_id and p.city_id=s.city_id and p.posted_on='2026-09-21'
   and p.status='published' and p.view_count=s.view_count)=40, 'Imported data mismatch';
 assert (select count(*) from public.safety_review_queue q join city_info_seed s on s.id=q.target_id
   where q.target_type='post')=40, 'Every post must retain safety monitoring';
end $$;
select p.city_id,count(*) as posts,count(distinct p.author_id) as authors,
 min(p.posted_on) as posted_on,min(p.view_count) as min_views,max(p.view_count) as max_views
from public.posts p join city_info_seed s using(id) group by p.city_id order by p.city_id;
rollback;
