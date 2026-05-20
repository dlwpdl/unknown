import {
  BadgeCheck,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Coffee,
  Home,
  Lock,
  MapPin,
  MessageCircle,
  Moon,
  Plus,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type Tab = "today" | "corners" | "places" | "me";
type SignalType = "Plan" | "Ask" | "Vibe Check" | "Drop" | "Find";

type Signal = {
  id: number;
  type: SignalType;
  title: string;
  detail: string;
  city: string;
  area: string;
  host: string;
  hostMeta: string;
  tags: string[];
  seats: string;
  trust: string[];
  tone: "mint" | "coral" | "blue" | "yellow" | "ink";
  own?: boolean;
};

type SignalRequest = {
  id: number;
  signalTitle: string;
  name: string;
  note: string;
  meta: string;
  tags: string[];
  badges: string[];
};

type MiniRoom = {
  id: number;
  title: string;
  expires: string;
  members: string[];
  keepInTouch: boolean;
  messages: {
    name: string;
    text: string;
    mine?: boolean;
  }[];
};

type Corner = {
  id: number;
  name: string;
  city: string;
  mood: string;
  members: number;
  requirement: string;
  tags: string[];
  joined?: boolean;
  private?: boolean;
};

const cities = [
  { name: "Vancouver", state: "active city" },
  { name: "Toronto", state: "active city" },
  { name: "Calgary", state: "founding city" },
  { name: "Montreal", state: "founding city" },
  { name: "Edmonton", state: "waitlist city" },
  { name: "Ottawa", state: "waitlist city" },
];

const vibeTags = [
  "coffee",
  "film",
  "quiet dinner",
  "jazz",
  "newcomer",
  "founders",
  "design",
  "korean",
  "roommates",
  "night walk",
  "gallery",
  "study",
];

const initialSignals: Signal[] = [
  {
    id: 1,
    type: "Plan",
    title: "Rainy jazz table tonight",
    detail: "Low-key bar, 3-4 people max, around 8pm.",
    city: "Vancouver",
    area: "Gastown",
    host: "Mina",
    hostMeta: "same city rhythm",
    tags: ["jazz", "quiet", "afterwork"],
    seats: "2 of 4 open",
    trust: ["face checked", "hosted once"],
    tone: "blue",
  },
  {
    id: 2,
    type: "Vibe Check",
    title: "Kits room / $1,250 / calm house",
    detail: "Good area for UBC commute? Looking for honest takes.",
    city: "Vancouver",
    area: "Kitsilano",
    host: "Jae",
    hostMeta: "new in city",
    tags: ["room", "quiet", "UBC"],
    seats: "18 checks",
    trust: ["phone checked"],
    tone: "yellow",
  },
  {
    id: 3,
    type: "Find",
    title: "Newcomer coffee loop",
    detail: "For people who landed this year and want an easy first table.",
    city: "Vancouver",
    area: "Mount Pleasant",
    host: "Sora",
    hostMeta: "2 shared tags",
    tags: ["newcomer", "coffee", "korean"],
    seats: "3 of 6 open",
    trust: ["face checked", "3 scenes"],
    tone: "mint",
  },
];

const initialSignalRequests: SignalRequest[] = [
  {
    id: 1,
    signalTitle: "Low-key coffee after work",
    name: "Mina",
    note: "Down if it stays small. I know a quiet spot near Main.",
    meta: "same corner - Rainy Coffee Crew",
    tags: ["coffee", "quiet", "newcomer"],
    badges: ["face checked", "3 scenes"],
  },
  {
    id: 2,
    signalTitle: "Low-key coffee after work",
    name: "Theo",
    note: "Can join around 6. No networking energy, promise.",
    meta: "2 shared tags",
    tags: ["design", "afterwork"],
    badges: ["phone checked"],
  },
];

const initialCorners: Corner[] = [
  {
    id: 1,
    name: "Rainy Coffee Crew",
    city: "Vancouver",
    mood: "Quiet cafes, soft plans, no pressure.",
    members: 42,
    requirement: "phone check",
    tags: ["coffee", "quiet", "newcomer"],
    joined: true,
  },
  {
    id: 2,
    name: "Korean Creatives",
    city: "Vancouver",
    mood: "Designers, makers, camera people, small tables.",
    members: 67,
    requirement: "request only",
    tags: ["design", "film", "korean"],
    joined: true,
  },
  {
    id: 3,
    name: "Room Vibe Check",
    city: "Vancouver",
    mood: "Rent screenshots, area checks, roommate rhythm.",
    members: 31,
    requirement: "face checked",
    tags: ["roommates", "rent", "safety"],
    private: true,
  },
  {
    id: 4,
    name: "Sunday Film Walks",
    city: "Vancouver",
    mood: "Slow walks, photo rolls, coffee after.",
    members: 28,
    requirement: "open request",
    tags: ["film", "walk", "coffee"],
  },
  {
    id: 5,
    name: "Founder Table",
    city: "Toronto",
    mood: "Builders, early ideas, no pitch theater.",
    members: 54,
    requirement: "work check optional",
    tags: ["founders", "afterwork", "ideas"],
    private: true,
  },
];

const placeCards = [
  {
    name: "Analog Corner",
    type: "Cafe",
    area: "Mount Pleasant",
    note: "Good for first coffee, quiet tables before 3pm.",
    image:
      "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Bar Lento",
    type: "Listening bar",
    area: "Gastown",
    note: "Low light, small groups, better for 3 people than 8.",
    image:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Kits Quiet Block",
    type: "Room note",
    area: "Kitsilano",
    note: "Rent is high, but transit and beach walks carry the vibe.",
    image:
      "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80",
  },
];

function App() {
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [step, setStep] = useState(0);
  const [city, setCity] = useState("Vancouver");
  const [selectedTags, setSelectedTags] = useState<string[]>([
    "coffee",
    "quiet dinner",
    "newcomer",
  ]);
  const [profileName, setProfileName] = useState("June");
  const [tab, setTab] = useState<Tab>("today");
  const [signals, setSignals] = useState(initialSignals);
  const [corners, setCorners] = useState(initialCorners);
  const [signalSheetOpen, setSignalSheetOpen] = useState(false);
  const [newSignalType, setNewSignalType] = useState<SignalType>("Plan");
  const [newSignalTitle, setNewSignalTitle] = useState("");
  const [newSignalDetail, setNewSignalDetail] = useState("");
  const [requestedSignalIds, setRequestedSignalIds] = useState<number[]>([]);
  const [savedSignalIds, setSavedSignalIds] = useState<number[]>([]);
  const [incomingRequests, setIncomingRequests] = useState(initialSignalRequests);
  const [miniRoom, setMiniRoom] = useState<MiniRoom | null>(null);
  const [roomSheetOpen, setRoomSheetOpen] = useState(false);
  const [faceChecked, setFaceChecked] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const joinedCorners = corners.filter((corner) => corner.joined);
  const slotsUsed = joinedCorners.length;
  const slotsMax = 3;
  const signalUsedToday = signals.some((signal) => signal.own);

  const onboardingTitle = useMemo(() => {
    if (step === 0) return "Find your people around the corner.";
    if (step === 1) return "Start with a city.";
    if (step === 2) return "Pick the rhythm you actually want.";
    if (step === 3) return "No face required. Just enough to feel real.";
    return "Choose your first corners carefully.";
  }, [step]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= 5) return current;
      return [...current, tag];
    });
  };

  const joinCorner = (id: number) => {
    if (slotsUsed >= slotsMax) return;
    setCorners((current) =>
      current.map((corner) =>
        corner.id === id ? { ...corner, joined: true } : corner
      )
    );
  };

  const createSignal = () => {
    const fallbackTitle =
      newSignalType === "Vibe Check"
        ? "Room vibe check near Kits"
        : "Low-key coffee after work";
    const signal: Signal = {
      id: Date.now(),
      type: newSignalType,
      title: newSignalTitle.trim() || fallbackTitle,
      detail:
        newSignalDetail.trim() ||
        "Keeping this small. Send a vibe if it feels like your pace.",
      city,
      area: "Mount Pleasant",
      host: profileName || "You",
      hostMeta: "your signal",
      tags: selectedTags.slice(0, 3),
      seats: "3 of 4 open",
      trust: faceChecked ? ["face checked", "host"] : ["new host"],
      tone: "coral",
      own: true,
    };

    setSignals((current) => [signal, ...current]);
    setSignalSheetOpen(false);
    setNewSignalTitle("");
    setNewSignalDetail("");
    setTab("today");
  };

  const acceptSignalRequest = (request: SignalRequest) => {
    setIncomingRequests((current) =>
      current.filter((item) => item.id !== request.id)
    );
    setMiniRoom((current) => {
      if (current?.title === request.signalTitle) {
        return {
          ...current,
          members: Array.from(new Set([...current.members, request.name])),
          messages: [
            ...current.messages,
            {
              name: "Corner",
              text: `${request.name} joined after you accepted the vibe.`,
            },
          ],
        };
      }

      return {
        id: Date.now(),
        title: request.signalTitle,
        expires: "18h",
        members: [profileName || "You", request.name],
        keepInTouch: false,
        messages: [
          {
            name: request.name,
            text: request.note,
          },
          {
            name: profileName || "You",
            text: "Nice. Keeping this tiny and easy.",
            mine: true,
          },
        ],
      };
    });
    setRoomSheetOpen(true);
  };

  const toggleKeepInTouch = () => {
    setMiniRoom((current) =>
      current ? { ...current, keepInTouch: !current.keepInTouch } : current
    );
  };

  if (!onboardingDone) {
    return (
      <main className="app-canvas">
        <section className="phone-shell onboarding-shell" aria-label="Corner onboarding">
          <header className="onboarding-top">
            <div className="brand-mark">C</div>
            <button className="ghost-button" onClick={() => setOnboardingDone(true)}>
              Skip
            </button>
          </header>

          <div className="step-dots" aria-label="Onboarding progress">
            {[0, 1, 2, 3, 4].map((item) => (
              <span key={item} className={item <= step ? "dot active" : "dot"} />
            ))}
          </div>

          <section className="onboarding-copy">
            <p className="eyebrow">Corner beta</p>
            <h1>{onboardingTitle}</h1>
            <p>
              A city community for small rooms, soft plans, trusted signals,
              and people who do not want another loud feed.
            </p>
          </section>

          <section className="onboarding-panel">
            {step === 0 && <IntroStep />}
            {step === 1 && (
              <CityStep city={city} setCity={setCity} />
            )}
            {step === 2 && (
              <TagStep selectedTags={selectedTags} toggleTag={toggleTag} />
            )}
            {step === 3 && (
              <ProfileStep
                profileName={profileName}
                setProfileName={setProfileName}
                faceChecked={faceChecked}
                setFaceChecked={setFaceChecked}
              />
            )}
            {step === 4 && (
              <StarterCorners corners={corners.slice(0, 4)} />
            )}
          </section>

          <footer className="onboarding-actions">
            <button
              className="secondary-button"
              disabled={step === 0}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
            >
              Back
            </button>
            <button
              className="primary-button"
              onClick={() => {
                if (step === 4) {
                  setOnboardingDone(true);
                  return;
                }
                setStep((current) => current + 1);
              }}
            >
              {step === 4 ? "Enter Corner" : "Next"}
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
        <AppHeader city={city} profileName={profileName} />
        <div className="screen-content">
          {tab === "today" && (
            <TodayScreen
              city={city}
              signals={signals}
              requestedSignalIds={requestedSignalIds}
              savedSignalIds={savedSignalIds}
              signalUsedToday={signalUsedToday}
              incomingRequests={incomingRequests}
              miniRoom={miniRoom}
              setSignalSheetOpen={setSignalSheetOpen}
              setRequestedSignalIds={setRequestedSignalIds}
              setSavedSignalIds={setSavedSignalIds}
              onAcceptRequest={acceptSignalRequest}
              openMiniRoom={() => setRoomSheetOpen(true)}
            />
          )}
          {tab === "corners" && (
            <CornersScreen
              corners={corners}
              slotsUsed={slotsUsed}
              slotsMax={slotsMax}
              joinCorner={joinCorner}
            />
          )}
          {tab === "places" && <PlacesScreen />}
          {tab === "me" && (
            <MeScreen
              profileName={profileName}
              city={city}
              selectedTags={selectedTags}
              faceChecked={faceChecked}
              setFaceChecked={setFaceChecked}
              slotsUsed={slotsUsed}
              signalUsedToday={signalUsedToday}
              adminOpen={adminOpen}
              setAdminOpen={setAdminOpen}
            />
          )}
        </div>
        <BottomNav tab={tab} setTab={setTab} />
      </section>

      {signalSheetOpen && (
        <SignalSheet
          newSignalType={newSignalType}
          setNewSignalType={setNewSignalType}
          newSignalTitle={newSignalTitle}
          setNewSignalTitle={setNewSignalTitle}
          newSignalDetail={newSignalDetail}
          setNewSignalDetail={setNewSignalDetail}
          createSignal={createSignal}
          close={() => setSignalSheetOpen(false)}
          disabled={signalUsedToday}
        />
      )}

      {roomSheetOpen && miniRoom && (
        <MiniRoomSheet
          room={miniRoom}
          close={() => setRoomSheetOpen(false)}
          toggleKeepInTouch={toggleKeepInTouch}
        />
      )}
    </main>
  );
}

function IntroStep() {
  return (
    <div className="intro-grid">
      <div className="mini-card mint">
        <Radio size={18} />
        <span>Drop one signal a day</span>
      </div>
      <div className="mini-card blue">
        <UsersRound size={18} />
        <span>Keep only 3 corners</span>
      </div>
      <div className="mini-card coral">
        <ShieldCheck size={18} />
        <span>Verify privately, show softly</span>
      </div>
    </div>
  );
}

function CityStep({
  city,
  setCity,
}: {
  city: string;
  setCity: (city: string) => void;
}) {
  return (
    <div className="city-list">
      {cities.map((item) => (
        <button
          key={item.name}
          className={city === item.name ? "city-row selected" : "city-row"}
          onClick={() => setCity(item.name)}
        >
          <span>
            <strong>{item.name}</strong>
            <small>{item.state}</small>
          </span>
          {city === item.name && <Check size={18} />}
        </button>
      ))}
    </div>
  );
}

function TagStep({
  selectedTags,
  toggleTag,
}: {
  selectedTags: string[];
  toggleTag: (tag: string) => void;
}) {
  return (
    <>
      <div className="chip-grid">
        {vibeTags.map((tag) => (
          <button
            key={tag}
            className={selectedTags.includes(tag) ? "chip selected" : "chip"}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      <p className="helper-text">{selectedTags.length}/5 tags selected</p>
    </>
  );
}

function ProfileStep({
  profileName,
  setProfileName,
  faceChecked,
  setFaceChecked,
}: {
  profileName: string;
  setProfileName: (name: string) => void;
  faceChecked: boolean;
  setFaceChecked: (checked: boolean) => void;
}) {
  return (
    <div className="profile-step">
      <label className="input-label">
        Display name
        <input
          value={profileName}
          onChange={(event) => setProfileName(event.target.value)}
          placeholder="June"
        />
      </label>
      <div className="mood-strip" aria-label="Mood photo examples">
        <span className="mood-photo photo-one" />
        <span className="mood-photo photo-two" />
        <span className="mood-photo photo-three" />
      </div>
      <button
        className={faceChecked ? "trust-option checked" : "trust-option"}
        onClick={() => setFaceChecked(!faceChecked)}
      >
        <ShieldCheck size={20} />
        <span>
          <strong>Face checked privately</strong>
          <small>Not shown on your profile.</small>
        </span>
        {faceChecked && <Check size={18} />}
      </button>
    </div>
  );
}

function StarterCorners({ corners }: { corners: Corner[] }) {
  return (
    <div className="starter-stack">
      <p className="helper-text">You get 3 corner slots. Pick slowly.</p>
      {corners.map((corner) => (
        <article key={corner.id} className="starter-row">
          <span>
            <strong>{corner.name}</strong>
            <small>{corner.mood}</small>
          </span>
          <span className={corner.joined ? "status-pill filled" : "status-pill"}>
            {corner.joined ? "in" : "request"}
          </span>
        </article>
      ))}
    </div>
  );
}

function AppHeader({
  city,
  profileName,
}: {
  city: string;
  profileName: string;
}) {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">Corner</p>
        <h2>{city}</h2>
      </div>
      <div className="header-actions">
        <button className="icon-button" title="Search">
          <Search size={18} />
        </button>
        <button className="avatar-button" title="Profile">
          {profileName.slice(0, 1).toUpperCase() || "C"}
        </button>
      </div>
    </header>
  );
}

function TodayScreen({
  city,
  signals,
  requestedSignalIds,
  savedSignalIds,
  signalUsedToday,
  incomingRequests,
  miniRoom,
  setSignalSheetOpen,
  setRequestedSignalIds,
  setSavedSignalIds,
  onAcceptRequest,
  openMiniRoom,
}: {
  city: string;
  signals: Signal[];
  requestedSignalIds: number[];
  savedSignalIds: number[];
  signalUsedToday: boolean;
  incomingRequests: SignalRequest[];
  miniRoom: MiniRoom | null;
  setSignalSheetOpen: (open: boolean) => void;
  setRequestedSignalIds: React.Dispatch<React.SetStateAction<number[]>>;
  setSavedSignalIds: React.Dispatch<React.SetStateAction<number[]>>;
  onAcceptRequest: (request: SignalRequest) => void;
  openMiniRoom: () => void;
}) {
  return (
    <div className="screen-stack">
      <section className="today-hero">
        <div>
          <p className="eyebrow">Today in {city}</p>
          <h1>Small signals, not a loud feed.</h1>
          <p>
            One public call at a time. Real conversation opens only when the
            host accepts the vibe.
          </p>
        </div>
        <button
          className="floating-add"
          title="Drop signal"
          onClick={() => setSignalSheetOpen(true)}
        >
          <Plus size={22} />
        </button>
      </section>

      <section className="limit-band">
        <Radio size={18} />
        <span>
          {signalUsedToday
            ? "Your free signal is live. Next one unlocks tomorrow."
            : "Free members can drop 1 signal today."}
        </span>
      </section>

      <ConnectionFlowPanel
        incomingRequests={incomingRequests}
        miniRoom={miniRoom}
        onAcceptRequest={onAcceptRequest}
        openMiniRoom={openMiniRoom}
      />

      <section className="signal-stack" aria-label="Signals">
        {signals.map((signal) => (
          <SignalCard
            key={signal.id}
            signal={signal}
            requested={requestedSignalIds.includes(signal.id)}
            saved={savedSignalIds.includes(signal.id)}
            onRequest={() =>
              setRequestedSignalIds((current) =>
                current.includes(signal.id)
                  ? current.filter((id) => id !== signal.id)
                  : [...current, signal.id]
              )
            }
            onSave={() =>
              setSavedSignalIds((current) =>
                current.includes(signal.id)
                  ? current.filter((id) => id !== signal.id)
                  : [...current, signal.id]
              )
            }
          />
        ))}
      </section>
    </div>
  );
}

function ConnectionFlowPanel({
  incomingRequests,
  miniRoom,
  onAcceptRequest,
  openMiniRoom,
}: {
  incomingRequests: SignalRequest[];
  miniRoom: MiniRoom | null;
  onAcceptRequest: (request: SignalRequest) => void;
  openMiniRoom: () => void;
}) {
  return (
    <section className="flow-panel">
      <header className="flow-header">
        <div>
          <p className="eyebrow">Signal flow</p>
          <h2>Requests do not become DMs.</h2>
        </div>
        <MessageCircle size={22} />
      </header>
      <div className="flow-steps" aria-label="Signal room flow">
        <span>Signal</span>
        <ChevronRight size={14} />
        <span>Request</span>
        <ChevronRight size={14} />
        <span>Mini room</span>
      </div>

      {incomingRequests.length > 0 ? (
        <div className="request-stack">
          {incomingRequests.map((request) => (
            <article className="request-card" key={request.id}>
              <div className="request-copy">
                <span className="tiny-avatar">{request.name.slice(0, 1)}</span>
                <div>
                  <strong>{request.name}</strong>
                  <small>{request.meta}</small>
                  <p>{request.note}</p>
                </div>
              </div>
              <div className="tag-row compact">
                {request.badges.map((badge) => (
                  <span key={badge}>
                    <BadgeCheck size={12} />
                    {badge}
                  </span>
                ))}
              </div>
              <div className="request-actions">
                <button className="secondary-button tight">Pass</button>
                <button
                  className="primary-button tight"
                  onClick={() => onAcceptRequest(request)}
                >
                  Accept
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-request-card">
          <Bell size={18} />
          <span>No waiting requests. Your room stays quiet.</span>
        </div>
      )}

      {miniRoom && (
        <button className="room-peek" onClick={openMiniRoom}>
          <span>
            <strong>{miniRoom.title}</strong>
            <small>
              {miniRoom.members.length} people - expires in {miniRoom.expires}
            </small>
          </span>
          <ChevronRight size={18} />
        </button>
      )}
    </section>
  );
}

function SignalCard({
  signal,
  requested,
  saved,
  onRequest,
  onSave,
}: {
  signal: Signal;
  requested: boolean;
  saved: boolean;
  onRequest: () => void;
  onSave: () => void;
}) {
  return (
    <article className={`signal-card ${signal.tone}`}>
      <header className="signal-card-top">
        <span className="type-pill">{signal.type}</span>
        <span className="seat-pill">{signal.seats}</span>
      </header>
      <h3>{signal.title}</h3>
      <p>{signal.detail}</p>
      <div className="tag-row">
        {signal.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <footer className="signal-footer">
        <div className="host-line">
          <span className="tiny-avatar">{signal.host.slice(0, 1)}</span>
          <span>
            <strong>{signal.host}</strong>
            <small>
              {signal.area} - {signal.hostMeta}
            </small>
          </span>
        </div>
        <div className="trust-row">
          {signal.trust.map((item) => (
            <span key={item}>
              <BadgeCheck size={12} />
              {item}
            </span>
          ))}
        </div>
      </footer>
      <div className="action-row">
        <button className={requested ? "action-button active" : "action-button"} onClick={onRequest}>
          <Send size={16} />
          {requested ? "Sent" : "I'm down"}
        </button>
        <button className="action-button" onClick={onSave}>
          <Moon size={16} />
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {requested && (
        <div className="sent-note">
          Host sees your request card first. Chat opens only if they accept.
        </div>
      )}
    </article>
  );
}

function CornersScreen({
  corners,
  slotsUsed,
  slotsMax,
  joinCorner,
}: {
  corners: Corner[];
  slotsUsed: number;
  slotsMax: number;
  joinCorner: (id: number) => void;
}) {
  const [activeCornerId, setActiveCornerId] = useState<number | null>(1);
  const activeCorner = corners.find((corner) => corner.id === activeCornerId);

  return (
    <div className="screen-stack">
      <section className="slots-panel">
        <div>
          <p className="eyebrow">Your corners</p>
          <h1>{slotsUsed}/{slotsMax} slots used</h1>
          <p>Leaving a corner starts a 7 day cooldown. Scarcity keeps the room real.</p>
        </div>
        <Lock size={22} />
      </section>

      <section className="corner-list">
        {corners.map((corner) => (
          <article
            key={corner.id}
            className={corner.joined ? "corner-card joined" : "corner-card"}
            onClick={() => setActiveCornerId(corner.id)}
          >
            <div>
              <header>
                <h3>{corner.name}</h3>
                {corner.private && <span className="status-pill">private</span>}
              </header>
              <p>{corner.mood}</p>
              <div className="tag-row">
                {corner.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <small>
                {corner.members} members · {corner.requirement}
              </small>
            </div>
            {corner.joined ? (
              <span className="check-badge">
                <Check size={15} />
              </span>
            ) : (
              <button
                className="join-button"
                disabled={slotsUsed >= slotsMax}
                onClick={(event) => {
                  event.stopPropagation();
                  joinCorner(corner.id);
                }}
              >
                Request
              </button>
            )}
          </article>
        ))}
      </section>

      {activeCorner && activeCorner.joined && (
        <section className="lounge-section">
          <p className="eyebrow">{activeCorner.name}</p>
          <h2>Lounge</h2>
          <div className="lounge-tabs">
            <span>Signals</span>
            <span>Talk</span>
            <span>Notes</span>
          </div>
          <div className="message-stack">
            <div className="message-bubble">
              <strong>Mina</strong>
              <span>Analog Corner has two seats free around 5.</span>
            </div>
            <div className="message-bubble mine">
              <strong>You</strong>
              <span>Down if it stays low-key.</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function PlacesScreen() {
  return (
    <div className="screen-stack">
      <section className="places-intro">
        <p className="eyebrow">Places</p>
        <h1>City spots with a social read.</h1>
        <p>Not ratings. Just where the room feels right for a first table.</p>
      </section>
      <section className="place-stack">
        {placeCards.map((place) => (
          <article className="place-card" key={place.name}>
            <img src={place.image} alt="" />
            <div>
              <span className="type-pill">{place.type}</span>
              <h3>{place.name}</h3>
              <p>{place.note}</p>
              <small>
                <MapPin size={13} />
                {place.area}
              </small>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function MeScreen({
  profileName,
  city,
  selectedTags,
  faceChecked,
  setFaceChecked,
  slotsUsed,
  signalUsedToday,
  adminOpen,
  setAdminOpen,
}: {
  profileName: string;
  city: string;
  selectedTags: string[];
  faceChecked: boolean;
  setFaceChecked: (value: boolean) => void;
  slotsUsed: number;
  signalUsedToday: boolean;
  adminOpen: boolean;
  setAdminOpen: (value: boolean) => void;
}) {
  return (
    <div className="screen-stack">
      <section className="profile-card">
        <div className="profile-hero">
          <span className="large-avatar">{profileName.slice(0, 1).toUpperCase() || "C"}</span>
          <button className="status-pill filled">free plan</button>
        </div>
        <h1>{profileName || "Corner user"}</h1>
        <p>{city} · mood photos over face-first profiles</p>
        <div className="tag-row">
          {selectedTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </section>

      <section className="trust-panel">
        <header>
          <div>
            <p className="eyebrow">Trust layer</p>
            <h2>Private checks, soft badges.</h2>
          </div>
          <ShieldCheck size={22} />
        </header>
        <button
          className={faceChecked ? "trust-option checked" : "trust-option"}
          onClick={() => setFaceChecked(!faceChecked)}
        >
          <BadgeCheck size={20} />
          <span>
            <strong>Face checked privately</strong>
            <small>{faceChecked ? "Badge visible" : "Optional for higher-trust corners"}</small>
          </span>
          {faceChecked && <Check size={18} />}
        </button>
        <button className="trust-option checked">
          <BadgeCheck size={20} />
          <span>
            <strong>Phone checked</strong>
            <small>Used for safety and duplicate prevention.</small>
          </span>
          <Check size={18} />
        </button>
      </section>

      <section className="membership-panel">
        <p className="eyebrow">Scarcity model</p>
        <div className="limit-row">
          <span>Corner slots</span>
          <strong>{slotsUsed}/3</strong>
        </div>
        <div className="limit-row">
          <span>Signals today</span>
          <strong>{signalUsedToday ? "1/1" : "0/1"}</strong>
        </div>
        <div className="upgrade-card">
          <Sparkles size={18} />
          <span>
            <strong>Plus preview</strong>
            <small>5 corners, 2 signals, no partner cards, shorter cooldown.</small>
          </span>
        </div>
      </section>

      <section className="admin-preview">
        <button className="admin-toggle" onClick={() => setAdminOpen(!adminOpen)}>
          <Lock size={16} />
          Founder safety console
        </button>
        {adminOpen && (
          <div className="admin-panel">
            <div className="limit-row">
              <span>Reported signals</span>
              <strong>2</strong>
            </div>
            <div className="limit-row">
              <span>Sensitive data</span>
              <strong>locked</strong>
            </div>
            <button className="danger-button">Reveal with audit log</button>
          </div>
        )}
      </section>
    </div>
  );
}

function SignalSheet({
  newSignalType,
  setNewSignalType,
  newSignalTitle,
  setNewSignalTitle,
  newSignalDetail,
  setNewSignalDetail,
  createSignal,
  close,
  disabled,
}: {
  newSignalType: SignalType;
  setNewSignalType: (type: SignalType) => void;
  newSignalTitle: string;
  setNewSignalTitle: (title: string) => void;
  newSignalDetail: string;
  setNewSignalDetail: (detail: string) => void;
  createSignal: () => void;
  close: () => void;
  disabled: boolean;
}) {
  const types: SignalType[] = ["Plan", "Ask", "Vibe Check", "Drop", "Find"];

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="signal-sheet">
        <header>
          <div>
            <p className="eyebrow">Drop signal</p>
            <h2>{disabled ? "Today's signal is already live." : "Keep it small."}</h2>
          </div>
          <button className="icon-button" onClick={close} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="type-switcher">
          {types.map((type) => (
            <button
              key={type}
              className={newSignalType === type ? "type-choice active" : "type-choice"}
              onClick={() => setNewSignalType(type)}
              disabled={disabled}
            >
              {type}
            </button>
          ))}
        </div>
        <label className="input-label">
          Signal title
          <input
            value={newSignalTitle}
            onChange={(event) => setNewSignalTitle(event.target.value)}
            placeholder="Quiet dinner for newcomers"
            disabled={disabled}
          />
        </label>
        <label className="input-label">
          Details
          <textarea
            value={newSignalDetail}
            onChange={(event) => setNewSignalDetail(event.target.value)}
            placeholder="3-4 people max, no networking energy."
            disabled={disabled}
          />
        </label>
        <button className="primary-button full" onClick={createSignal} disabled={disabled}>
          <Radio size={18} />
          Drop signal
        </button>
      </section>
    </div>
  );
}

function MiniRoomSheet({
  room,
  close,
  toggleKeepInTouch,
}: {
  room: MiniRoom;
  close: () => void;
  toggleKeepInTouch: () => void;
}) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="signal-sheet mini-room-sheet">
        <header>
          <div>
            <p className="eyebrow">Mini room</p>
            <h2>{room.title}</h2>
          </div>
          <button className="icon-button" onClick={close} title="Close">
            <X size={18} />
          </button>
        </header>

        <div className="room-status-card">
          <div className="member-row">
            {room.members.map((member) => (
              <span className="tiny-avatar" key={member}>
                {member.slice(0, 1)}
              </span>
            ))}
          </div>
          <span>
            <strong>{room.members.length} people accepted</strong>
            <small>expires in {room.expires} - not a permanent DM</small>
          </span>
        </div>

        <div className="room-message-stack">
          {room.messages.map((message, index) => (
            <div
              className={message.mine ? "room-message mine" : "room-message"}
              key={`${message.name}-${index}`}
            >
              <strong>{message.name}</strong>
              <span>{message.text}</span>
            </div>
          ))}
        </div>

        <div className="prompt-row">
          <button>Still around?</button>
          <button>Place?</button>
          <button>Keep it 3 max</button>
        </div>

        <button
          className={room.keepInTouch ? "keep-button active" : "keep-button"}
          onClick={toggleKeepInTouch}
        >
          <BadgeCheck size={17} />
          {room.keepInTouch ? "You asked to keep in touch" : "Keep in touch after"}
        </button>

        <p className="room-footnote">
          1:1 opens only when both people choose keep in touch after the room.
        </p>
      </section>
    </div>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const navItems = [
    { id: "today", label: "Today", icon: CalendarDays },
    { id: "corners", label: "Corners", icon: UsersRound },
    { id: "places", label: "Places", icon: Store },
    { id: "me", label: "Me", icon: UserRound },
  ] as const;

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={tab === item.id ? "nav-item active" : "nav-item"}
            onClick={() => setTab(item.id)}
          >
            <Icon size={19} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default App;
