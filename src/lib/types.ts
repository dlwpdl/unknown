// 도메인 타입 — supabase/migrations/0001_init.sql 스키마와 1:1 대응

export type CityState = 'open' | 'soon'; // soon = 대기열(cohort 전). DB cities.state와 매핑

export interface City {
  id: string;
  name: string;
  province: string; // BC · ON · QC · MB · SK · AB
  state: CityState;
}

export type TagSlug =
  | 'life'
  | 'food'
  | 'travel'
  | 'shopping'
  | 'settlement'
  | 'transport'
  | 'housing'
  | 'education'
  | 'meetup';

export interface Tag {
  id: number;
  slug: TagSlug;
  label: string;
  kind: 'post' | 'meetup';
}

export interface Author {
  id: string;
  nickname: string;
  neighborhood?: string;
  verified: boolean; // true면 L2 추가 확인, false면 L1 소셜 계정 확인
  trustLevel?: 2 | 3; // 3 = 신분증과 얼굴 대조 완료. 없으면 verified로 판단
}

export interface RoomPreview {
  id: string;
  title: string;
  memberCount: number;
  capacity?: number;
  verifiedOnly: boolean;
}

export interface PostComment {
  id: string;
  authorId?: string;
  nickname: string;
  body: string;
  likes?: number; // 댓글 공감 수
  likedByMe?: boolean;
  mine?: boolean; // 내가 쓴 댓글 (시각적 구분)
  verified?: boolean; // true면 L2, false/없음이면 L1
  trustLevel?: 2 | 3;
  createdAt?: string;
}

export interface Post {
  id: string;
  cityId: string; // 소속 도시 (피드 필터). 소도시·동네는 author.neighborhood로
  author: Author;
  tag: Tag;
  title: string;
  body: string;
  hashtags?: string[]; // # 없이 대표 표기로 저장하는 주제 키워드 (#2030, #맛집 등)
  createdAtLabel: string; // mock 단계: 표시용 상대시간. Supabase 연결 시 timestamptz로 교체
  createdAt?: string;
  likes: number; // 공감(좋아요) — 탭 토글
  views: number; // 조회수 = 글을 클릭(상세 진입)한 유니크 유저 수
  comments: number; // 표시용 카운트
  commentList?: PostComment[]; // 목 댓글 시드 (상세 화면 초기값)
  saves: number;
  shares?: number;
  likedByMe?: boolean;
  savedByMe?: boolean;
  imagePaths?: string[];
  imageUris?: string[];
  room?: RoomPreview;
}

export interface DailyQuota {
  used: number;
  max: number;
}

// 네이티브 인피드 광고 — 글 카드와 같은 셸, '광고' 라벨 명시. 피드 N개당 1 슬롯 상한
export interface Ad {
  id: string;
  advertiser: string; // 로컬 업체명
  title: string;
  body: string;
  cta: string;
  cityId?: string; // 도시 타겟 (없으면 전체)
}
