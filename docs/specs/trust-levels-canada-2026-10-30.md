# 캐나다 기준 인증 단계 (2026-10-30)

사장님 결정: "추천안대로 실명제 하고" (정책 §6-10). 이번 변경은 돈이 들지 않는 부분만 한다. 문자 인증 업체와 신분증 업체는 사장님이 계정·비용을 확인한 뒤 붙인다.

## 단계와 지금 상태

| 단계 | 확인하는 것 | 저장하지 않는 것 | 지금 |
|---|---|---|---|
| Lv1 계정 확인 | 소셜 로그인 + 내 휴대폰 번호로 문자 인증 | 이름·나이는 받지 않음. 번호는 다른 회원에게 안 보임 | 소셜 로그인만 적용. 문자 인증은 준비 중 |
| Lv2 신분증 확인 | 신분증 + 그 자리에서 찍은 얼굴 자동 대조, 성인 여부 | 신분증·얼굴 사진, 신분증 번호, 생년월일 | 준비 중. 지금은 관리자 부여만 |
| Lv3 믿을 수 있는 호스트 | Lv2 + 모임 참석·호스트 기록·노쇼·처리된 신고·낮은 매너 평가 | 새로 받는 정보 없음. 남에게는 배지만 보임 | 서버 자동 판정(매시 17분) + 관리자 부여 |

값은 `profiles.verification_level` 1·2·3 그대로다. 옛 앱(v1.4.6)은 2를 "전화번호 확인 완료", 3을 "신분증과 본인 촬영 대조 완료"로 보여 준다. 위 단계는 아래 단계를 포함하므로, 업체를 붙인 뒤에는 옛 앱 문구도 사실이 된다.

## Lv3 기준 (`private.trusted_host_rule`, 한 줄 설정)

| 열 | 기본값 | 뜻 |
|---|---|---|
| `enabled` | true | 끄면 다음 회차에 자동 배지만 Lv2로 돌아간다(관리자 Lv3는 그대로) |
| `min_confirmed_meetups` | 3 | 끝난 모임에서 서로 확인(또는 관리자 확인)된 참석 횟수 |
| `min_hosted_meetups` | 3 | 내가 연 모임 중 다른 사람이 체크인·확인된 횟수 (0이면 검사 안 함) |
| `no_show_days` | 90 | 이 기간에 노쇼(`private.meetup_absences`)가 없어야 함 (0이면 검사 안 함) |
| `conduct_days` | 365 | 이 기간에 처리된 신고(`reports.status='actioned'`)와 공개된 5점 이하 매너 평가가 없어야 함 (0이면 검사 안 함) |

바꾸는 법(앱 출시 필요 없음): `update private.trusted_host_rule set min_confirmed_meetups=5, updated_at=now();`

- 자동으로 붙인 배지는 `private.trusted_host_auto`에 `granted`로 남고, 기준에서 벗어나면 회수된다.
- 관리자가 Lv3를 주면 자동 판정이 건드리지 않는다. 관리자가 Lv3를 내리면 `held`가 되어 자동으로 다시 붙지 않는다.
- 다른 회원은 단계(배지)만 본다. 본인은 신뢰 화면에서 `get_my_trust_progress()`로 횟수와 충족 여부만 본다. 노쇼·신고 세부 내용은 어디에도 나가지 않는다.
- 알려진 한계: 횟수는 모임 회차로 센다. 도우미 계정 하나로 기록을 만들 수 있어서, 악용이 보이면 서로 다른 참석자 수 기준을 더한다.

## 적용 전 확인 (운영 DB)

새 앱에서 Lv2는 "신분증 확인"으로 보인다. 지금 Lv2·Lv3인 계정은 실제 신분증 확인 없이 관리자가 주었거나 예시 계정이다. `20261030220100`은 0154와 같은 보호 조건으로 예시 계정의 Lv2만 Lv1로 돌린다. 나머지는 적용 전에 숫자를 본다.

```sql
select p.verification_level,
  count(*) total,
  count(*) filter (where u.email like '%@seed.gling.invalid') seed,
  count(*) filter (where exists (select 1 from public.admin_access_logs l
    where l.scope='trust_level' and l.subject_user_id=p.id)) admin_set
from public.profiles p join auth.users u on u.id=p.id
where p.verification_level>1 group by 1;
```

페르소나·공식 계정이 Lv2·Lv3라면 남길지 사장님이 정한다. `20261030220000`은 `20261029110000`(노쇼 기록)과 `20261029140000`(`meetup_hosted_count`) 뒤에 적용해야 한다.

## 문자 인증을 붙일 때 (Lv1)

- 방법: Supabase Auth 전화번호 인증을 쓴다. 로그인한 사용자가 `auth.updateUser({ phone })` → 문자 코드 → `verifyOtp({ phone, token, type: 'phone_change' })`. 결과는 `auth.users.phone_confirmed_at`에 남는다. 새 표나 레벨 값은 필요 없다.
- 업체 후보(Supabase가 지원): Twilio Verify, Twilio, MessageBird, Vonage. 캐나다 +1 번호 발송 단가와 월 최소 비용은 업체 견적으로 확인한다.
- 저장: 번호와 확인 시각만(Supabase Auth). 번호는 다른 회원에게 보여 주지 않는다. 같은 번호를 두 계정에 붙이지 못하는지(auth.users 번호 중복 제한) 붙일 때 확인한다.
- 앱: 신뢰 화면 Lv1 "준비 중"을 실제 버튼으로 바꾸고, `phone_confirmed_at`이 있으면 완료로 보인다. 개인정보처리방침(`src/lib/legal-documents.ts`)에 번호 수집 목적을 더한다.
- 비용 주의: 문자 폭탄을 막는 횟수 제한(Supabase Auth rate limit)과 업체 쪽 국가 제한을 먼저 켠다.

## 신분증 업체를 붙일 때 (Lv2)

- 후보: Stripe Identity, Persona, Veriff. 고를 때 볼 것: 캐나다 운전면허·여권·주 신분증 지원, 얼굴 대조와 위조 검사 포함 여부, 건당 비용과 최소 계약, 사진 보관 기간을 줄이거나 바로 지우는 기능(예: Stripe의 세션 삭제), 데이터 처리 위치(캐나다/미국), 웹훅 서명.
- 흐름: 앱에서 업체 화면을 연다 → 업체가 결과를 웹훅으로 보낸다 → Edge Function이 서명을 확인하고 서버 함수로 `verification_level`을 2로 올린다(1인 경우에만). 앱은 사진을 받거나 올리지 않는다.
- 저장할 값(새 비공개 표, 그때 만든다): `user_id`, 업체 이름, 업체 확인 번호(분쟁·삭제 요청용), 결과(확인됨/실패), 성인 여부(true/false), 확인 시각. 저장하지 않을 값: 사진, 얼굴 특징, 신분증 번호, 이름, 생년월일, 주소.
- 성인 기준: BC·NS·NB 등은 19세, 온타리오·퀘벡은 18세다. 도시별로 다르게 볼지, 19세로 통일할지 사장님이 정한다.
- 업체 쪽 사진 보관 기간을 가장 짧게 설정하고, 계정 삭제 때 업체 삭제 API도 부른다.

### 퀘벡 Law 25 동의 문구 자리

Lv2 시작 화면에 약관과 분리된 동의 체크를 둔다. 아래는 법률 검토 전 초안이다.

> 신분증 확인을 위해 [업체 이름]이 내 신분증 사진과 지금 찍은 얼굴 사진을 비교해요. 이 과정에서 얼굴 특징(생체 정보)을 씁니다. 글링은 결과로 '확인됨'과 성인 여부만 받고, 사진과 얼굴 정보는 저장하지 않아요. [업체 이름]은 사진을 [보관 기간] 뒤 지워요. 동의하지 않아도 글링의 다른 기능은 그대로 쓸 수 있어요.

업체를 붙이기 전에 확인할 것:
- 생체 정보로 신원을 확인하는 경우 퀘벡 개인정보위원회(CAI) 사전 신고가 필요한지, 업체가 처리하는 경우에도 해당하는지.
- 개인정보가 퀘벡 밖(업체 서버)으로 나갈 때 필요한 개인정보 영향평가(PIA).
- 퀘벡 사용자에게 프랑스어 동의 문구가 필요한지.
- 영어 문구는 한국어를 확정한 뒤 따로 쓴다.

## 바뀐 파일

- 서버: `supabase/migrations/20261030220000_trusted_host_level.sql`, `20261030220100_remove_unearned_synthetic_l2.sql`, 확인 SQL `supabase/tests/trusted_host_level.test.sql`
- 앱: `src/app/profile/trust.tsx`, `src/lib/trust.ts`, 배지·프로필·1:1 대화방 문구(`src/i18n/ko.ts`, `en.ts`, `ui-en.ts`), 관리자 신뢰 단계 안내(`src/components/admin/admin-user-review.tsx`)
