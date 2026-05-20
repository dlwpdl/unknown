import {
  BadgeCheck,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Lock,
  MessageCircle,
  Moon,
  Plus,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type Lang = "ko" | "en";
type Tab = "today" | "corners" | "rooms" | "me";
type SignalType = "Plan" | "Ask" | "Vibe Check" | "Drop" | "Find";

type Copy = {
  ko: string;
  en: string;
};

type Signal = {
  id: number;
  type: SignalType;
  title: Copy;
  detail: Copy;
  area: string;
  host: string;
  hostMeta: Copy;
  tags: Copy[];
  seats: Copy;
  trust: Copy[];
  tone: "mint" | "coral" | "blue" | "yellow";
  own?: boolean;
};

type SignalRequest = {
  id: number;
  signalTitle: Copy;
  name: string;
  note: Copy;
  meta: Copy;
  badges: Copy[];
};

type MiniRoom = {
  id: number;
  title: Copy;
  expires: string;
  members: string[];
  keepInTouch: boolean;
  messages: { name: string; text: Copy; mine?: boolean }[];
};

type Corner = {
  id: number;
  name: string;
  mood: Copy;
  members: number;
  requirement: Copy;
  tags: Copy[];
  joined?: boolean;
  private?: boolean;
};

const t = (copy: Copy, lang: Lang) => copy[lang];
const c = (ko: string, en: string): Copy => ({ ko, en });
const same = (a: Copy, b: Copy) => a.en === b.en || a.ko === b.ko;

const ui = {
  ko: {
    skip: "건너뛰기",
    back: "이전",
    next: "다음",
    enter: "Corner 들어가기",
    beta: "Corner 베타",
    onboarding: [
      "도시에서 나랑 결 맞는 사람을 찾는 곳",
      "먼저 도시를 골라줘",
      "내가 진짜 원하는 리듬만 골라",
      "얼굴 공개 없이도 충분히 신뢰 있게",
      "처음 들어갈 코너는 천천히 골라",
    ],
    body: "캐나다 도시에서 한인/이민자들이 부담 없이 연결되는 작은 커뮤니티.",
    intro: ["하루에 시그널 하나", "무료는 코너 3개만", "인증은 비공개, 배지는 작게"],
    displayName: "표시 이름",
    faceCheck: "얼굴 비공개 인증",
    faceHint: "프로필에는 얼굴이 공개되지 않아요.",
    starterHint: "코너 슬롯은 3개. 신중하게 골라요.",
    in: "입장중",
    request: "신청",
    todayIn: "오늘의",
    todayTitle: "큰 피드 말고, 작은 시그널.",
    todayBody: "공개로는 짧게 부르고, 진짜 대화는 수락된 뒤에만 열려요.",
    signalUsed: "오늘 무료 시그널은 이미 떠 있어요. 내일 다시 열려요.",
    signalAvailable: "무료 멤버는 오늘 시그널 1개를 날릴 수 있어요.",
    roomLive: "명 - 방 종료까지",
    requestsInRooms: "요청은 Rooms에서 확인해요",
    requestsHint: "시그널은 공개, 대화는 수락 후에만.",
    sentNote: "호스트가 먼저 요청 카드를 봐요. 수락해야 대화가 열려요.",
    imDown: "나도 갈래",
    sent: "보냄",
    save: "저장",
    saved: "저장됨",
    roomsTitle: "요청은 바로 DM이 아니에요.",
    roomsBody: "누군가 시그널에 노크하면, 내가 골라서 작은 방을 열 수 있어요.",
    flow: ["Signal", "Request", "Mini room"],
    noRequests: "대기 중인 요청이 없어요. 방은 조용히 유지돼요.",
    pass: "넘기기",
    accept: "수락",
    activeRoom: "열린 미니룸",
    noRoom: "요청을 수락하면 임시방이 열려요.",
    corners: "내 코너",
    slots: "슬롯 사용중",
    cooldown: "코너를 나가면 7일 쿨다운이 걸려요. 희소성이 분위기를 지켜요.",
    private: "비공개",
    members: "명",
    lounge: "코너 라운지",
    loungeNote: "이 코너에 들어온 사람들끼리 쓰는 영구 그룹방이에요.",
    loungeTabs: ["시그널", "대화", "노트"],
    write: "메시지 쓰기",
    trust: "신뢰 레이어",
    trustTitle: "인증은 비공개, 배지는 작게.",
    badgeVisible: "배지 표시 중",
    higherTrust: "신뢰 높은 코너 입장에 도움돼요.",
    phone: "전화번호 인증",
    phoneHint: "안전과 중복 계정 방지에 사용돼요.",
    scarcity: "희소성 모델",
    cornerSlots: "코너 슬롯",
    signalsToday: "오늘 시그널",
    plus: "Plus 미리보기",
    plusHint: "코너 5개, 시그널 2개, 광고 제거, 짧은 쿨다운.",
    admin: "Founder 안전 콘솔",
    reported: "신고된 시그널",
    sensitive: "민감 정보",
    locked: "잠김",
    reveal: "감사 로그 남기고 열람",
    dropSignal: "시그널 날리기",
    alreadyLive: "오늘의 시그널은 이미 떠 있어요.",
    keepSmall: "작게 부르기.",
    signalTitle: "시그널 제목",
    signalPlaceholder: "새로 온 사람들끼리 조용한 저녁",
    details: "내용",
    detailsPlaceholder: "3-4명 정도, 네트워킹 느낌 없이.",
    miniRoom: "미니룸",
    accepted: "명 수락됨",
    notDm: "영구 DM이 아니에요",
    still: "아직 근처?",
    place: "장소?",
    keep3: "3명까지만",
    keepTouch: "끝나고도 연락하기",
    askedKeep: "연락 이어가자고 요청함",
    footnote: "1:1은 둘 다 연락 이어가기를 눌렀을 때만 열려요.",
    nav: { today: "Today", corners: "Corners", rooms: "Rooms", me: "Me" },
  },
  en: {
    skip: "Skip",
    back: "Back",
    next: "Next",
    enter: "Enter Corner",
    beta: "Corner beta",
    onboarding: [
      "Find your people around the corner.",
      "Start with a city.",
      "Pick the rhythm you actually want.",
      "No face required. Just enough to feel real.",
      "Choose your first corners carefully.",
    ],
    body: "A city community for small rooms, soft plans, trusted signals, and people who do not want another loud feed.",
    intro: ["Drop one signal a day", "Keep only 3 corners", "Verify privately, show softly"],
    displayName: "Display name",
    faceCheck: "Face checked privately",
    faceHint: "Not shown on your profile.",
    starterHint: "You get 3 corner slots. Pick slowly.",
    in: "in",
    request: "request",
    todayIn: "Today in",
    todayTitle: "Small signals, not a loud feed.",
    todayBody: "One public call at a time. Real conversation opens only when accepted.",
    signalUsed: "Your free signal is live. Next one unlocks tomorrow.",
    signalAvailable: "Free members can drop 1 signal today.",
    roomLive: "people - room expires in",
    requestsInRooms: "Requests live in Rooms",
    requestsHint: "Signals stay public. Conversations stay accepted.",
    sentNote: "Host sees your request card first. Chat opens only if they accept.",
    imDown: "I'm down",
    sent: "Sent",
    save: "Save",
    saved: "Saved",
    roomsTitle: "Requests do not become DMs.",
    roomsBody: "People can knock from a signal. You choose who enters the mini room.",
    flow: ["Signal", "Request", "Mini room"],
    noRequests: "No waiting requests. Your room stays quiet.",
    pass: "Pass",
    accept: "Accept",
    activeRoom: "Active mini room",
    noRoom: "Accept a request to open a temporary room.",
    corners: "Your corners",
    slots: "slots used",
    cooldown: "Leaving a corner starts a 7 day cooldown. Scarcity keeps the room real.",
    private: "private",
    members: "members",
    lounge: "Corner lounge",
    loungeNote: "This is the persistent group room for people already inside this corner.",
    loungeTabs: ["Signals", "Talk", "Notes"],
    write: "Write to",
    trust: "Trust layer",
    trustTitle: "Private checks, soft badges.",
    badgeVisible: "Badge visible",
    higherTrust: "Optional for higher-trust corners",
    phone: "Phone checked",
    phoneHint: "Used for safety and duplicate prevention.",
    scarcity: "Scarcity model",
    cornerSlots: "Corner slots",
    signalsToday: "Signals today",
    plus: "Plus preview",
    plusHint: "5 corners, 2 signals, no partner cards, shorter cooldown.",
    admin: "Founder safety console",
    reported: "Reported signals",
    sensitive: "Sensitive data",
    locked: "locked",
    reveal: "Reveal with audit log",
    dropSignal: "Drop signal",
    alreadyLive: "Today's signal is already live.",
    keepSmall: "Keep it small.",
    signalTitle: "Signal title",
    signalPlaceholder: "Quiet dinner for newcomers",
    details: "Details",
    detailsPlaceholder: "3-4 people max, no networking energy.",
    miniRoom: "Mini room",
    accepted: "people accepted",
    notDm: "not a permanent DM",
    still: "Still around?",
    place: "Place?",
    keep3: "Keep it 3 max",
    keepTouch: "Keep in touch after",
    askedKeep: "You asked to keep in touch",
    footnote: "1:1 opens only when both people choose keep in touch after the room.",
    nav: { today: "Today", corners: "Corners", rooms: "Rooms", me: "Me" },
  },
};

const signalTypeLabels: Record<SignalType, Copy> = {
  Plan: c("약속", "Plan"),
  Ask: c("질문", "Ask"),
  "Vibe Check": c("바이브 체크", "Vibe Check"),
  Drop: c("드롭", "Drop"),
  Find: c("찾기", "Find"),
};

const cityOptions = [
  { name: "Vancouver", state: c("활성 도시", "active city") },
  { name: "Toronto", state: c("활성 도시", "active city") },
  { name: "Calgary", state: c("파운딩 도시", "founding city") },
  { name: "Montreal", state: c("파운딩 도시", "founding city") },
  { name: "Edmonton", state: c("대기 도시", "waitlist city") },
  { name: "Ottawa", state: c("대기 도시", "waitlist city") },
];

const vibeTags = [
  { id: "coffee", label: c("커피", "coffee") },
  { id: "film", label: c("필름", "film") },
  { id: "quiet-dinner", label: c("조용한 저녁", "quiet dinner") },
  { id: "jazz", label: c("재즈", "jazz") },
  { id: "newcomer", label: c("새로 온 사람", "newcomer") },
  { id: "founders", label: c("창업", "founders") },
  { id: "design", label: c("디자인", "design") },
  { id: "korean", label: c("한인", "korean") },
  { id: "roommates", label: c("룸메이트", "roommates") },
  { id: "night-walk", label: c("밤 산책", "night walk") },
  { id: "gallery", label: c("갤러리", "gallery") },
  { id: "study", label: c("공부", "study") },
];

const tagLabel = (id: string) => vibeTags.find((tag) => tag.id === id)?.label ?? c(id, id);

const initialSignals: Signal[] = [
  {
    id: 1,
    type: "Plan",
    title: c("오늘 밤 비 오는 재즈바 테이블", "Rainy jazz table tonight"),
    detail: c("부담 없는 바, 3-4명만, 밤 8시쯤.", "Low-key bar, 3-4 people max, around 8pm."),
    area: "Gastown",
    host: "Mina",
    hostMeta: c("도시 리듬이 비슷함", "same city rhythm"),
    tags: [c("재즈", "jazz"), c("조용함", "quiet"), c("퇴근 후", "afterwork")],
    seats: c("4자리 중 2자리 남음", "2 of 4 open"),
    trust: [c("얼굴 인증", "face checked"), c("호스트 1회", "hosted once")],
    tone: "blue",
  },
  {
    id: 2,
    type: "Vibe Check",
    title: c("Kits 방 / $1,250 / 조용한 집", "Kits room / $1,250 / calm house"),
    detail: c("UBC 통학 괜찮은 동네인지 솔직한 의견 필요해요.", "Good area for UBC commute? Looking for honest takes."),
    area: "Kitsilano",
    host: "Jae",
    hostMeta: c("새로 온 사람", "new in city"),
    tags: [c("방", "room"), c("조용함", "quiet"), c("UBC", "UBC")],
    seats: c("18개 체크", "18 checks"),
    trust: [c("전화번호 인증", "phone checked")],
    tone: "yellow",
  },
  {
    id: 3,
    type: "Find",
    title: c("새로 온 사람들 커피 루프", "Newcomer coffee loop"),
    detail: c("올해 막 온 사람들끼리 부담 없이 첫 테이블.", "For people who landed this year and want an easy first table."),
    area: "Mount Pleasant",
    host: "Sora",
    hostMeta: c("공통 태그 2개", "2 shared tags"),
    tags: [c("새로 온 사람", "newcomer"), c("커피", "coffee"), c("한인", "korean")],
    seats: c("6자리 중 3자리 남음", "3 of 6 open"),
    trust: [c("얼굴 인증", "face checked"), c("3개 scene 참여", "3 scenes")],
    tone: "mint",
  },
];

const initialRequests: SignalRequest[] = [
  {
    id: 1,
    signalTitle: c("퇴근 후 조용한 커피", "Low-key coffee after work"),
    name: "Mina",
    note: c("작게 가는 거면 좋아요. Main 근처 조용한 곳 알아요.", "Down if it stays small. I know a quiet spot near Main."),
    meta: c("같은 코너 - Rainy Coffee Crew", "same corner - Rainy Coffee Crew"),
    badges: [c("얼굴 인증", "face checked"), c("3개 scene", "3 scenes")],
  },
  {
    id: 2,
    signalTitle: c("퇴근 후 조용한 커피", "Low-key coffee after work"),
    name: "Theo",
    note: c("6시쯤 가능해요. 네트워킹 느낌 절대 없음.", "Can join around 6. No networking energy, promise."),
    meta: c("공통 태그 2개", "2 shared tags"),
    badges: [c("전화번호 인증", "phone checked")],
  },
];

const initialCorners: Corner[] = [
  {
    id: 1,
    name: "Rainy Coffee Crew",
    mood: c("조용한 카페, 부담 없는 약속, 압박 없는 분위기.", "Quiet cafes, soft plans, no pressure."),
    members: 42,
    requirement: c("전화번호 인증", "phone check"),
    tags: [c("커피", "coffee"), c("조용함", "quiet"), c("새로 온 사람", "newcomer")],
    joined: true,
  },
  {
    id: 2,
    name: "Korean Creatives",
    mood: c("디자이너, 만드는 사람들, 카메라 좋아하는 사람들의 작은 테이블.", "Designers, makers, camera people, small tables."),
    members: 67,
    requirement: c("신청제", "request only"),
    tags: [c("디자인", "design"), c("필름", "film"), c("한인", "korean")],
    joined: true,
  },
  {
    id: 3,
    name: "Room Vibe Check",
    mood: c("렌트 캡처, 동네 체크, 룸메이트 리듬을 같이 보는 곳.", "Rent screenshots, area checks, roommate rhythm."),
    members: 31,
    requirement: c("얼굴 인증", "face checked"),
    tags: [c("룸메이트", "roommates"), c("렌트", "rent"), c("안전", "safety")],
    joined: true,
    private: true,
  },
  {
    id: 4,
    name: "Sunday Film Walks",
    mood: c("느린 산책, 필름 한 롤, 끝나고 커피.", "Slow walks, photo rolls, coffee after."),
    members: 28,
    requirement: c("오픈 신청", "open request"),
    tags: [c("필름", "film"), c("산책", "walk"), c("커피", "coffee")],
  },
  {
    id: 5,
    name: "Founder Table",
    mood: c("빌더, 초기 아이디어, 과한 피칭 없는 테이블.", "Builders, early ideas, no pitch theater."),
    members: 54,
    requirement: c("직장 인증 선택", "work check optional"),
    tags: [c("창업", "founders"), c("퇴근 후", "afterwork"), c("아이디어", "ideas")],
    private: true,
  },
];

const loungeCopy: Record<number, { messages: { name: string; text: Copy; mine?: boolean }[]; composer: Copy }> = {
  1: {
    messages: [
      { name: "Mina", text: c("오늘 Analog Corner 5시쯤 두 자리 비어요.", "Analog Corner has two seats free around 5.") },
      { name: "You", text: c("작게 가는 거면 좋아요.", "Down if it stays low-key."), mine: true },
      { name: "Sora", text: c("이건 코너 안에서만 얘기할까, 시그널로 열까?", "Should we make this a signal or keep it inside the corner?") },
    ],
    composer: c("Rainy Coffee Crew에 메시지 쓰기", "Write to Rainy Coffee Crew"),
  },
  2: {
    messages: [
      { name: "Jae", text: c("이번 주말에 작은 포트폴리오 리뷰 테이블 열 사람?", "Anyone down for a tiny portfolio review table this weekend?") },
      { name: "You", text: c("좋아요. 4명 이하면 들어갈게요.", "Yes. I am in if it stays under 4."), mine: true },
      { name: "Mina", text: c("필카 산책이랑 묶어도 재밌을 듯.", "Could be fun to pair it with a film walk.") },
    ],
    composer: c("Korean Creatives에 메시지 쓰기", "Write to Korean Creatives"),
  },
  3: {
    messages: [
      { name: "Hana", text: c("Kits $1,250 방이면 위치 괜찮아도 조금 센 편인가요?", "Is $1,250 in Kits a bit high even if the location is good?") },
      { name: "Theo", text: c("집 컨디션이랑 룸메 vibe가 더 중요할 듯.", "The house condition and roommate vibe probably matter more.") },
      { name: "You", text: c("스크린샷 올리면 같이 봐줄게요.", "Drop a screenshot and I can vibe check it."), mine: true },
    ],
    composer: c("Room Vibe Check에 메시지 쓰기", "Write to Room Vibe Check"),
  },
};

function App() {
  const [lang, setLang] = useState<Lang>("ko");
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [step, setStep] = useState(0);
  const [city, setCity] = useState("Vancouver");
  const [selectedTags, setSelectedTags] = useState(["coffee", "quiet-dinner", "newcomer"]);
  const [profileName, setProfileName] = useState("June");
  const [tab, setTab] = useState<Tab>("today");
  const [signals, setSignals] = useState(initialSignals);
  const [corners, setCorners] = useState(initialCorners);
  const [requests, setRequests] = useState(initialRequests);
  const [miniRoom, setMiniRoom] = useState<MiniRoom | null>(null);
  const [signalSheetOpen, setSignalSheetOpen] = useState(false);
  const [roomSheetOpen, setRoomSheetOpen] = useState(false);
  const [newSignalType, setNewSignalType] = useState<SignalType>("Plan");
  const [newSignalTitle, setNewSignalTitle] = useState("");
  const [newSignalDetail, setNewSignalDetail] = useState("");
  const [requestedSignalIds, setRequestedSignalIds] = useState<number[]>([]);
  const [savedSignalIds, setSavedSignalIds] = useState<number[]>([]);
  const [faceChecked, setFaceChecked] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const copy = ui[lang];
  const slotsUsed = corners.filter((corner) => corner.joined).length;
  const signalUsedToday = signals.some((signal) => signal.own);
  const onboardingTitle = useMemo(() => copy.onboarding[step] ?? copy.onboarding[4], [copy, step]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= 5) return current;
      return [...current, tag];
    });
  };

  const joinCorner = (id: number) => {
    if (slotsUsed >= 3) return;
    setCorners((current) => current.map((corner) => (corner.id === id ? { ...corner, joined: true } : corner)));
  };

  const createSignal = () => {
    const fallbackTitle = newSignalType === "Vibe Check" ? c("Kits 근처 방 vibe check", "Room vibe check near Kits") : c("퇴근 후 조용한 커피", "Low-key coffee after work");
    const fallbackDetail = c("작게만 열어요. 결이 맞으면 가볍게 보내주세요.", "Keeping this small. Send a vibe if it feels like your pace.");
    const signal: Signal = {
      id: Date.now(),
      type: newSignalType,
      title: newSignalTitle.trim() ? c(newSignalTitle.trim(), newSignalTitle.trim()) : fallbackTitle,
      detail: newSignalDetail.trim() ? c(newSignalDetail.trim(), newSignalDetail.trim()) : fallbackDetail,
      area: "Mount Pleasant",
      host: profileName || "You",
      hostMeta: c("내 시그널", "your signal"),
      tags: selectedTags.slice(0, 3).map(tagLabel),
      seats: c("4자리 중 3자리 남음", "3 of 4 open"),
      trust: faceChecked ? [c("얼굴 인증", "face checked"), c("호스트", "host")] : [c("새 호스트", "new host")],
      tone: "coral",
      own: true,
    };

    setSignals((current) => [signal, ...current]);
    setSignalSheetOpen(false);
    setNewSignalTitle("");
    setNewSignalDetail("");
    setTab("today");
  };

  const acceptRequest = (request: SignalRequest) => {
    setRequests((current) => current.filter((item) => item.id !== request.id));
    setMiniRoom((current) => {
      if (current && same(current.title, request.signalTitle)) {
        return {
          ...current,
          members: Array.from(new Set([...current.members, request.name])),
          messages: [...current.messages, { name: "Corner", text: c(`${request.name}님이 수락 후 미니룸에 들어왔어요.`, `${request.name} joined after you accepted the vibe.`) }],
        };
      }
      return {
        id: Date.now(),
        title: request.signalTitle,
        expires: "18h",
        members: [profileName || "You", request.name],
        keepInTouch: false,
        messages: [
          { name: request.name, text: request.note },
          { name: profileName || "You", text: c("좋아요. 작고 편하게 가요.", "Nice. Keeping this tiny and easy."), mine: true },
        ],
      };
    });
    setRoomSheetOpen(true);
  };

  if (!onboardingDone) {
    return (
      <main className="app-canvas">
        <section className="phone-shell onboarding-shell" aria-label="Corner onboarding">
          <header className="onboarding-top">
            <div className="brand-mark">C</div>
            <div className="top-actions">
              <LanguageToggle lang={lang} setLang={setLang} />
              <button className="ghost-button" onClick={() => setOnboardingDone(true)}>{copy.skip}</button>
            </div>
          </header>

          <div className="step-dots" aria-label="Onboarding progress">
            {[0, 1, 2, 3, 4].map((item) => <span key={item} className={item <= step ? "dot active" : "dot"} />)}
          </div>

          <section className="onboarding-copy">
            <p className="eyebrow">{copy.beta}</p>
            <h1>{onboardingTitle}</h1>
            <p>{copy.body}</p>
          </section>

          <section className="onboarding-panel">
            {step === 0 && <IntroStep copy={copy} />}
            {step === 1 && <CityStep city={city} setCity={setCity} lang={lang} />}
            {step === 2 && <TagStep selectedTags={selectedTags} toggleTag={toggleTag} lang={lang} />}
            {step === 3 && <ProfileStep profileName={profileName} setProfileName={setProfileName} faceChecked={faceChecked} setFaceChecked={setFaceChecked} copy={copy} />}
            {step === 4 && <StarterCorners corners={corners.slice(0, 4)} lang={lang} copy={copy} />}
          </section>

          <footer className="onboarding-actions">
            <button className="secondary-button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>{copy.back}</button>
            <button className="primary-button" onClick={() => step === 4 ? setOnboardingDone(true) : setStep((current) => current + 1)}>
              {step === 4 ? copy.enter : copy.next}
              <ChevronRight size={18} />
            </button>
          </footer>
        </section>
      </main>
    );
  }

  return (
    <main className="app-canvas">
      <section className="phone-shell" aria-label="Corner mobile proof of concept">
        <AppHeader city={city} profileName={profileName} lang={lang} setLang={setLang} />
        <div className="screen-content">
          {tab === "today" && (
            <TodayScreen
              city={city}
              copy={copy}
              lang={lang}
              signals={signals}
              requestedSignalIds={requestedSignalIds}
              savedSignalIds={savedSignalIds}
              signalUsedToday={signalUsedToday}
              miniRoom={miniRoom}
              setSignalSheetOpen={setSignalSheetOpen}
              setRequestedSignalIds={setRequestedSignalIds}
              setSavedSignalIds={setSavedSignalIds}
              goToRooms={() => setTab("rooms")}
              openMiniRoom={() => setRoomSheetOpen(true)}
            />
          )}
          {tab === "corners" && <CornersScreen copy={copy} lang={lang} corners={corners} slotsUsed={slotsUsed} joinCorner={joinCorner} />}
          {tab === "rooms" && <RoomsScreen copy={copy} lang={lang} requests={requests} miniRoom={miniRoom} acceptRequest={acceptRequest} openMiniRoom={() => setRoomSheetOpen(true)} />}
          {tab === "me" && <MeScreen copy={copy} lang={lang} profileName={profileName} city={city} selectedTags={selectedTags} faceChecked={faceChecked} setFaceChecked={setFaceChecked} slotsUsed={slotsUsed} signalUsedToday={signalUsedToday} adminOpen={adminOpen} setAdminOpen={setAdminOpen} />}
        </div>
        <BottomNav tab={tab} setTab={setTab} copy={copy} />
      </section>

      {signalSheetOpen && <SignalSheet copy={copy} lang={lang} newSignalType={newSignalType} setNewSignalType={setNewSignalType} newSignalTitle={newSignalTitle} setNewSignalTitle={setNewSignalTitle} newSignalDetail={newSignalDetail} setNewSignalDetail={setNewSignalDetail} createSignal={createSignal} close={() => setSignalSheetOpen(false)} disabled={signalUsedToday} />}
      {roomSheetOpen && miniRoom && <MiniRoomSheet copy={copy} lang={lang} room={miniRoom} close={() => setRoomSheetOpen(false)} toggleKeepInTouch={() => setMiniRoom((current) => current ? { ...current, keepInTouch: !current.keepInTouch } : current)} />}
    </main>
  );
}

function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <div className="language-toggle" aria-label="Language selector">
      <button className={lang === "ko" ? "active" : ""} onClick={() => setLang("ko")}>KO</button>
      <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}

function IntroStep({ copy }: { copy: typeof ui.ko }) {
  return (
    <div className="intro-grid">
      <div className="mini-card mint"><Radio size={18} /><span>{copy.intro[0]}</span></div>
      <div className="mini-card blue"><UsersRound size={18} /><span>{copy.intro[1]}</span></div>
      <div className="mini-card coral"><ShieldCheck size={18} /><span>{copy.intro[2]}</span></div>
    </div>
  );
}

function CityStep({ city, setCity, lang }: { city: string; setCity: (city: string) => void; lang: Lang }) {
  return (
    <div className="city-list">
      {cityOptions.map((item) => (
        <button key={item.name} className={city === item.name ? "city-row selected" : "city-row"} onClick={() => setCity(item.name)}>
          <span><strong>{item.name}</strong><small>{t(item.state, lang)}</small></span>
          {city === item.name && <Check size={18} />}
        </button>
      ))}
    </div>
  );
}

function TagStep({ selectedTags, toggleTag, lang }: { selectedTags: string[]; toggleTag: (tag: string) => void; lang: Lang }) {
  return (
    <>
      <div className="chip-grid">
        {vibeTags.map((tag) => (
          <button key={tag.id} className={selectedTags.includes(tag.id) ? "chip selected" : "chip"} onClick={() => toggleTag(tag.id)}>
            {t(tag.label, lang)}
          </button>
        ))}
      </div>
      <p className="helper-text">{selectedTags.length}/5 tags selected</p>
    </>
  );
}

function ProfileStep({ profileName, setProfileName, faceChecked, setFaceChecked, copy }: { profileName: string; setProfileName: (name: string) => void; faceChecked: boolean; setFaceChecked: (checked: boolean) => void; copy: typeof ui.ko }) {
  return (
    <div className="profile-step">
      <label className="input-label">{copy.displayName}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="June" /></label>
      <div className="mood-strip" aria-label="Mood photo examples"><span className="mood-photo photo-one" /><span className="mood-photo photo-two" /><span className="mood-photo photo-three" /></div>
      <button className={faceChecked ? "trust-option checked" : "trust-option"} onClick={() => setFaceChecked(!faceChecked)}>
        <ShieldCheck size={20} /><span><strong>{copy.faceCheck}</strong><small>{copy.faceHint}</small></span>{faceChecked && <Check size={18} />}
      </button>
    </div>
  );
}

function StarterCorners({ corners, lang, copy }: { corners: Corner[]; lang: Lang; copy: typeof ui.ko }) {
  return (
    <div className="starter-stack">
      <p className="helper-text">{copy.starterHint}</p>
      {corners.map((corner) => (
        <article key={corner.id} className="starter-row">
          <span><strong>{corner.name}</strong><small>{t(corner.mood, lang)}</small></span>
          <span className={corner.joined ? "status-pill filled" : "status-pill"}>{corner.joined ? copy.in : copy.request}</span>
        </article>
      ))}
    </div>
  );
}

function AppHeader({ city, profileName, lang, setLang }: { city: string; profileName: string; lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <header className="app-header">
      <div><p className="eyebrow">Corner</p><h2>{city}</h2></div>
      <div className="header-actions"><LanguageToggle lang={lang} setLang={setLang} /><button className="icon-button" title="Search"><Search size={18} /></button><button className="avatar-button" title="Profile">{profileName.slice(0, 1).toUpperCase() || "C"}</button></div>
    </header>
  );
}

function TodayScreen({ city, copy, lang, signals, requestedSignalIds, savedSignalIds, signalUsedToday, miniRoom, setSignalSheetOpen, setRequestedSignalIds, setSavedSignalIds, goToRooms, openMiniRoom }: { city: string; copy: typeof ui.ko; lang: Lang; signals: Signal[]; requestedSignalIds: number[]; savedSignalIds: number[]; signalUsedToday: boolean; miniRoom: MiniRoom | null; setSignalSheetOpen: (open: boolean) => void; setRequestedSignalIds: React.Dispatch<React.SetStateAction<number[]>>; setSavedSignalIds: React.Dispatch<React.SetStateAction<number[]>>; goToRooms: () => void; openMiniRoom: () => void }) {
  return (
    <div className="screen-stack">
      <section className="today-hero">
        <div><p className="eyebrow">{copy.todayIn} {city}</p><h1>{copy.todayTitle}</h1><p>{copy.todayBody}</p></div>
        <button className="floating-add" title={copy.dropSignal} onClick={() => setSignalSheetOpen(true)}><Plus size={22} /></button>
      </section>
      <section className="limit-band"><Radio size={18} /><span>{signalUsedToday ? copy.signalUsed : copy.signalAvailable}</span></section>
      {miniRoom ? (
        <button className="room-peek today-room-peek" onClick={openMiniRoom}><span><strong>{t(miniRoom.title, lang)}</strong><small>{miniRoom.members.length} {copy.roomLive} {miniRoom.expires}</small></span><ChevronRight size={18} /></button>
      ) : (
        <button className="room-peek today-room-peek soft" onClick={goToRooms}><span><strong>{copy.requestsInRooms}</strong><small>{copy.requestsHint}</small></span><ChevronRight size={18} /></button>
      )}
      <section className="signal-stack" aria-label="Signals">
        {signals.map((signal) => (
          <SignalCard key={signal.id} copy={copy} lang={lang} signal={signal} requested={requestedSignalIds.includes(signal.id)} saved={savedSignalIds.includes(signal.id)} onRequest={() => setRequestedSignalIds((current) => current.includes(signal.id) ? current.filter((id) => id !== signal.id) : [...current, signal.id])} onSave={() => setSavedSignalIds((current) => current.includes(signal.id) ? current.filter((id) => id !== signal.id) : [...current, signal.id])} />
        ))}
      </section>
    </div>
  );
}

function RoomsScreen({ copy, lang, requests, miniRoom, acceptRequest, openMiniRoom }: { copy: typeof ui.ko; lang: Lang; requests: SignalRequest[]; miniRoom: MiniRoom | null; acceptRequest: (request: SignalRequest) => void; openMiniRoom: () => void }) {
  return (
    <div className="screen-stack">
      <section className="rooms-hero"><div><p className="eyebrow">Rooms</p><h1>{copy.roomsTitle}</h1><p>{copy.roomsBody}</p></div><MessageCircle size={22} /></section>
      <section className="flow-panel">
        <div className="flow-steps" aria-label="Signal room flow"><span>{copy.flow[0]}</span><ChevronRight size={14} /><span>{copy.flow[1]}</span><ChevronRight size={14} /><span>{copy.flow[2]}</span></div>
        {requests.length > 0 ? (
          <div className="request-stack">
            {requests.map((request) => (
              <article className="request-card" key={request.id}>
                <div className="request-copy"><span className="tiny-avatar">{request.name.slice(0, 1)}</span><div className="request-body"><strong>{request.name}</strong><small>{t(request.meta, lang)}</small><p>{t(request.note, lang)}</p></div></div>
                <div className="tag-row compact">{request.badges.map((badge) => <span key={badge.en}><BadgeCheck size={12} />{t(badge, lang)}</span>)}</div>
                <div className="request-actions"><button className="secondary-button tight">{copy.pass}</button><button className="primary-button tight" onClick={() => acceptRequest(request)}>{copy.accept}</button></div>
              </article>
            ))}
          </div>
        ) : <div className="empty-request-card"><Bell size={18} /><span>{copy.noRequests}</span></div>}
      </section>
      <section className="active-room-section">
        <p className="eyebrow">{copy.activeRoom}</p>
        {miniRoom ? <button className="room-peek" onClick={openMiniRoom}><span><strong>{t(miniRoom.title, lang)}</strong><small>{miniRoom.members.length} {copy.roomLive} {miniRoom.expires}</small></span><ChevronRight size={18} /></button> : <div className="empty-request-card"><MessageCircle size={18} /><span>{copy.noRoom}</span></div>}
      </section>
    </div>
  );
}

function SignalCard({ copy, lang, signal, requested, saved, onRequest, onSave }: { copy: typeof ui.ko; lang: Lang; signal: Signal; requested: boolean; saved: boolean; onRequest: () => void; onSave: () => void }) {
  return (
    <article className={`signal-card ${signal.tone}`}>
      <header className="signal-card-top"><span className="type-pill">{t(signalTypeLabels[signal.type], lang)}</span><span className="seat-pill">{t(signal.seats, lang)}</span></header>
      <h3>{t(signal.title, lang)}</h3><p>{t(signal.detail, lang)}</p>
      <div className="tag-row">{signal.tags.map((tag) => <span key={tag.en}>{t(tag, lang)}</span>)}</div>
      <footer className="signal-footer">
        <div className="host-line"><span className="tiny-avatar">{signal.host.slice(0, 1)}</span><span><strong>{signal.host}</strong><small>{signal.area} - {t(signal.hostMeta, lang)}</small></span></div>
        <div className="trust-row">{signal.trust.map((item) => <span key={item.en}><BadgeCheck size={12} />{t(item, lang)}</span>)}</div>
      </footer>
      <div className="action-row"><button className={requested ? "action-button active" : "action-button"} onClick={onRequest}><Send size={16} />{requested ? copy.sent : copy.imDown}</button><button className="action-button" onClick={onSave}><Moon size={16} />{saved ? copy.saved : copy.save}</button></div>
      {requested && <div className="sent-note">{copy.sentNote}</div>}
    </article>
  );
}

function CornersScreen({ copy, lang, corners, slotsUsed, joinCorner }: { copy: typeof ui.ko; lang: Lang; corners: Corner[]; slotsUsed: number; joinCorner: (id: number) => void }) {
  const [activeCornerId, setActiveCornerId] = useState(1);
  const activeCorner = corners.find((corner) => corner.id === activeCornerId);
  const lounge = activeCorner ? loungeCopy[activeCorner.id] : undefined;

  return (
    <div className="screen-stack">
      <section className="slots-panel"><div><p className="eyebrow">{copy.corners}</p><h1>{slotsUsed}/3 {copy.slots}</h1><p>{copy.cooldown}</p></div><Lock size={22} /></section>
      <section className="corner-list">
        {corners.map((corner) => (
          <article key={corner.id} className={corner.joined ? "corner-card joined" : "corner-card"} onClick={() => setActiveCornerId(corner.id)}>
            <div><header><h3>{corner.name}</h3>{corner.private && <span className="status-pill">{copy.private}</span>}</header><p>{t(corner.mood, lang)}</p><div className="tag-row">{corner.tags.map((tag) => <span key={tag.en}>{t(tag, lang)}</span>)}</div><small>{corner.members}{copy.members} - {t(corner.requirement, lang)}</small></div>
            {corner.joined ? <span className="check-badge"><Check size={15} /></span> : <button className="join-button" disabled={slotsUsed >= 3} onClick={(event) => { event.stopPropagation(); joinCorner(corner.id); }}>{copy.request}</button>}
          </article>
        ))}
      </section>
      {activeCorner && activeCorner.joined && lounge && (
        <section className="lounge-section">
          <div className="lounge-heading"><div><p className="eyebrow">{activeCorner.name}</p><h2>{copy.lounge}</h2></div><MessageCircle size={21} /></div>
          <p className="lounge-note">{copy.loungeNote}</p>
          <div className="lounge-tabs">{copy.loungeTabs.map((tab) => <span key={tab}>{tab}</span>)}</div>
          <div className="message-stack">{lounge.messages.map((message, index) => <div className={message.mine ? "message-bubble mine" : "message-bubble"} key={`${message.name}-${index}`}><strong>{message.name}</strong><span>{t(message.text, lang)}</span></div>)}</div>
          <div className="corner-composer"><span>{t(lounge.composer, lang)}</span><button title={copy.write}><Send size={16} /></button></div>
        </section>
      )}
    </div>
  );
}

function MeScreen({ copy, lang, profileName, city, selectedTags, faceChecked, setFaceChecked, slotsUsed, signalUsedToday, adminOpen, setAdminOpen }: { copy: typeof ui.ko; lang: Lang; profileName: string; city: string; selectedTags: string[]; faceChecked: boolean; setFaceChecked: (value: boolean) => void; slotsUsed: number; signalUsedToday: boolean; adminOpen: boolean; setAdminOpen: (value: boolean) => void }) {
  return (
    <div className="screen-stack">
      <section className="profile-card"><div className="profile-hero"><span className="large-avatar">{profileName.slice(0, 1).toUpperCase() || "C"}</span><button className="status-pill filled">free plan</button></div><h1>{profileName || "Corner user"}</h1><p>{city} - mood photos over face-first profiles</p><div className="tag-row">{selectedTags.map((tag) => <span key={tag}>{t(tagLabel(tag), lang)}</span>)}</div></section>
      <section className="trust-panel"><header><div><p className="eyebrow">{copy.trust}</p><h2>{copy.trustTitle}</h2></div><ShieldCheck size={22} /></header><button className={faceChecked ? "trust-option checked" : "trust-option"} onClick={() => setFaceChecked(!faceChecked)}><BadgeCheck size={20} /><span><strong>{copy.faceCheck}</strong><small>{faceChecked ? copy.badgeVisible : copy.higherTrust}</small></span>{faceChecked && <Check size={18} />}</button><button className="trust-option checked"><BadgeCheck size={20} /><span><strong>{copy.phone}</strong><small>{copy.phoneHint}</small></span><Check size={18} /></button></section>
      <section className="membership-panel"><p className="eyebrow">{copy.scarcity}</p><div className="limit-row"><span>{copy.cornerSlots}</span><strong>{slotsUsed}/3</strong></div><div className="limit-row"><span>{copy.signalsToday}</span><strong>{signalUsedToday ? "1/1" : "0/1"}</strong></div><div className="upgrade-card"><Sparkles size={18} /><span><strong>{copy.plus}</strong><small>{copy.plusHint}</small></span></div></section>
      <section className="admin-preview"><button className="admin-toggle" onClick={() => setAdminOpen(!adminOpen)}><Lock size={16} />{copy.admin}</button>{adminOpen && <div className="admin-panel"><div className="limit-row"><span>{copy.reported}</span><strong>2</strong></div><div className="limit-row"><span>{copy.sensitive}</span><strong>{copy.locked}</strong></div><button className="danger-button">{copy.reveal}</button></div>}</section>
    </div>
  );
}

function SignalSheet({ copy, lang, newSignalType, setNewSignalType, newSignalTitle, setNewSignalTitle, newSignalDetail, setNewSignalDetail, createSignal, close, disabled }: { copy: typeof ui.ko; lang: Lang; newSignalType: SignalType; setNewSignalType: (type: SignalType) => void; newSignalTitle: string; setNewSignalTitle: (title: string) => void; newSignalDetail: string; setNewSignalDetail: (detail: string) => void; createSignal: () => void; close: () => void; disabled: boolean }) {
  const types: SignalType[] = ["Plan", "Ask", "Vibe Check", "Drop", "Find"];
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="signal-sheet"><header><div><p className="eyebrow">{copy.dropSignal}</p><h2>{disabled ? copy.alreadyLive : copy.keepSmall}</h2></div><button className="icon-button" onClick={close} title="Close"><X size={18} /></button></header><div className="type-switcher">{types.map((type) => <button key={type} className={newSignalType === type ? "type-choice active" : "type-choice"} onClick={() => setNewSignalType(type)} disabled={disabled}>{t(signalTypeLabels[type], lang)}</button>)}</div><label className="input-label">{copy.signalTitle}<input value={newSignalTitle} onChange={(event) => setNewSignalTitle(event.target.value)} placeholder={copy.signalPlaceholder} disabled={disabled} /></label><label className="input-label">{copy.details}<textarea value={newSignalDetail} onChange={(event) => setNewSignalDetail(event.target.value)} placeholder={copy.detailsPlaceholder} disabled={disabled} /></label><button className="primary-button full" onClick={createSignal} disabled={disabled}><Radio size={18} />{copy.dropSignal}</button></section>
    </div>
  );
}

function MiniRoomSheet({ copy, lang, room, close, toggleKeepInTouch }: { copy: typeof ui.ko; lang: Lang; room: MiniRoom; close: () => void; toggleKeepInTouch: () => void }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="signal-sheet mini-room-sheet">
        <header><div><p className="eyebrow">{copy.miniRoom}</p><h2>{t(room.title, lang)}</h2></div><button className="icon-button" onClick={close} title="Close"><X size={18} /></button></header>
        <div className="room-status-card"><div className="member-row">{room.members.map((member) => <span className="tiny-avatar" key={member}>{member.slice(0, 1)}</span>)}</div><span><strong>{room.members.length}{copy.accepted}</strong><small>{room.expires} - {copy.notDm}</small></span></div>
        <div className="room-message-stack">{room.messages.map((message, index) => <div className={message.mine ? "room-message mine" : "room-message"} key={`${message.name}-${index}`}><strong>{message.name}</strong><span>{t(message.text, lang)}</span></div>)}</div>
        <div className="prompt-row"><button>{copy.still}</button><button>{copy.place}</button><button>{copy.keep3}</button></div>
        <button className={room.keepInTouch ? "keep-button active" : "keep-button"} onClick={toggleKeepInTouch}><BadgeCheck size={17} />{room.keepInTouch ? copy.askedKeep : copy.keepTouch}</button>
        <p className="room-footnote">{copy.footnote}</p>
      </section>
    </div>
  );
}

function BottomNav({ tab, setTab, copy }: { tab: Tab; setTab: (tab: Tab) => void; copy: typeof ui.ko }) {
  const navItems = [
    { id: "today", label: copy.nav.today, icon: CalendarDays },
    { id: "corners", label: copy.nav.corners, icon: UsersRound },
    { id: "rooms", label: copy.nav.rooms, icon: MessageCircle },
    { id: "me", label: copy.nav.me, icon: UserRound },
  ] as const;

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => setTab(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
      })}
    </nav>
  );
}

export default App;
