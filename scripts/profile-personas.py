#!/usr/bin/env python3
"""기존 도시 운영 캐릭터의 고정 페르소나. --apply로 실제 seed 프로필과 원고 배정표를 동기화한다."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import runpy

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'marketing/profile-personas.json'
CITIES = {'vancouver': 'Vancouver', 'toronto': 'Toronto', 'montreal': 'Montréal', 'edmonton': 'Edmonton', 'calgary': 'Calgary'}
DETAILS = ['living', 'background', 'values', 'personality', 'interests', 'writing_purpose', 'voice', 'continuity']
INTERESTS = {
    'life': ['동네 산책', '장보기', '집밥', '카페', '도서관', '주말 문화생활', '반려동물', '중고 물건'],
    'transport': ['대중교통', '도보 이동', '동네 산책', '자전거', '통근 동선', '주말 근교 이동'],
    'food': ['카페', '간단한 집밥', '장보기', '새로운 음식', '빵과 디저트', '외식 비용'],
    'education': ['도서관', '언어 공부', '공부 공간', '취미 수업', '독서', '직무 공부'],
    'travel': ['주말 근교 이동', '산책 코스', '문화 행사', '전시', '사진', '공원'],
    'settlement': ['집 구하기', '생활비', '동네 비교', '장보기', '대중교통', '생활 서비스'],
}
PURPOSES = ['궁금한 점을 묻기', '찾아본 정보를 나누기', '확신 없는 생각을 나누기', '작은 불편을 풀어놓기',
            '경험과 선택지를 비교하기', '동네 변화를 살펴보기', '정착하며 필요한 것을 찾기', '생활 속 관찰을 나누기']


def enrich(profile, previous=None, assigned=None):
    if assigned is not None:
        if (assigned.get('version') != 4 or assigned.get('profile_id') != profile['id']
                or assigned.get('city_id') != profile['city_id'] or not all(assigned.get(k) for k in DETAILS)):
            raise ValueError('EXISTING_PERSONA_BINDING_OR_DETAILS_INVALID')
        p = {**assigned, 'nickname': profile['nickname'], 'voice': dict(assigned['voice'])}
        p['voice'].setdefault('place_name_language', ('ko', 'en')[int(profile['id'][-1], 16) % 2])
        return p
    rng = random.Random('gling-persona-v4:' + profile['id'])
    p = dict(previous or {})
    p.update(profile_id=profile['id'], nickname=profile['nickname'], city_id=profile['city_id'], version=4,
             kind='gling_operated_character')
    for k, value in [('age', rng.randrange(19, 44)), ('gender', rng.choice(['여', '남'])),
                     ('archetype', rng.randrange(1, 9)), ('post_window', rng.randrange(4)), ('main_tag', rng.choice(list(INTERESTS)))]:
        p.setdefault(k, value)
    for k in ['initiative', 'directness', 'verbosity', 'focus', 'humor', 'social']:
        p.setdefault(k, rng.randrange(3))
    age = p['age']
    years = rng.choice([.25, .5, 1]) if p['archetype'] == 7 else rng.choice([3, 5, 8, 12] if p['archetype'] == 6 else [1, 2, 3, 5, 7])
    years = min(years, age - 5)
    jobs = ['대학생', '직업 과정 학생', '카페 파트타이머'] if age < 22 else ['디자이너', '개발자', '사무직', '서비스직', '대학원생', '프리랜서', '기술직', '소규모 자영업자']
    living = {'residency_years': years, 'occupation': rng.choice(jobs), 'household': rng.choice(['혼자 거주', '룸메이트와 거주', '파트너와 거주', '가족과 거주']),
              'transport': rng.choice(['대중교통과 도보', '차량과 도보', '자전거와 대중교통']), 'spending': rng.choice(['실속 위주', '취미에는 선택적으로 지출', '시간과 편의에 지출'])}
    arrival = '학창 시절 가족과 함께 이곳으로 옮겨왔다' if age - years < 18 else rng.choice(['공부를 계기로 이곳 생활을 시작했다', '일과 생활환경을 바꾸려고 이곳으로 옮겨왔다', '다른 생활을 경험하고 싶어서 이곳으로 옮겨왔다'])
    primary = rng.sample(INTERESTS.get(p['main_tag'], INTERESTS['life']), 3)
    occasional = rng.sample([x for x in INTERESTS['life'] + ['지역 행사', '집 구하기', '사진', '언어 공부'] if x not in primary], 2)
    values = rng.sample(['가격', '편리함', '분위기', '안정', '새로운 배움', '사람과의 관계', '혼자 쉴 시간'], 2)
    p.update(living=living, background=[arrival, living['household'] + '하며 ' + living['occupation'] + ' 생활을 한다',
             rng.choice(['새로운 곳을 알아보는 데 시간을 쓰는 편이다', '익숙한 루틴을 바탕으로 조금씩 범위를 넓힌다', '취미와 생활비의 균형을 자주 고민한다'])],
             values=values, personality={'stance': ['조심스럽게 말을 꺼냄', '담백하게 의견을 냄', '불편한 점을 구체적으로 말함'][p['directness']],
             'small_contradiction': rng.choice(['지출에는 꼼꼼하지만 좋아하는 취미에는 느슨함', '혼자 쉬는 것을 좋아하지만 좋은 모임은 찾아봄', '새로운 곳은 궁금하지만 준비 없이 움직이는 것은 부담스러움', '계획을 세우지만 마음에 드는 발견에는 계획을 바꿈'])},
             interests={'primary': primary, 'occasional': occasional}, writing_purpose={'primary': PURPOSES[p['archetype'] - 1], 'secondary': rng.choice(PURPOSES)},
             voice={'sentence_length': ['짧은 문장 중심', '짧고 긴 문장을 자연스럽게 섞음', '구체적인 배경을 풀어 설명함'][p['verbosity']],
                    'place_name_language': ('ko', 'en')[int(profile['id'][-1], 16) % 2],
                    'register': '편한 한국어 반말', 'directness': p['directness'], 'humor': p['humor'], 'emoji': rng.choice(['거의 없음', '필요할 때 하나']),
                    'ending': '내용에 따라 감상·질문·의견을 달리하고 고정 첫 문장이나 끝맺음을 반복하지 않음'})
    p['continuity'] = {'fixed_facts': [str(age) + '세', living['occupation'], living['household'], str(years) + '년 거주', living['transport']],
                       'before_writing': '실제 최근 글을 읽고 이미 말한 생활 조건·관계·선호를 이어간다. 기존 설정과 충돌하면 확인 전 새 사실을 단정하지 않는다.'}
    p['bio'] = '글링 운영 캐릭터 · ' + CITIES[p['city_id']] + ' · ' + str(age) + '세 ' + p['gender'] + ' · ' + living['occupation'] + '\n' + ' · '.join(primary) + '에 관심이 많아요.'
    if len(p['bio']) > 160:
        raise ValueError('PERSONA_BIO_TOO_LONG')
    return p


def build_sql(rows, commit=False):
    encoded = json.dumps(rows, ensure_ascii=False).replace("'", "''")
    return """begin;set local lock_timeout='8s';set local statement_timeout='25s';
create temporary table persona_input on commit drop as
select * from jsonb_to_recordset('""" + encoded + """'::jsonb)
 as x(id uuid,nickname text,city_id text,metadata_md5 text,bio_md5 text,persona jsonb);
do $$ begin
 if (select count(distinct id) from persona_input)<>(select count(*) from persona_input)
 or exists(select 1 from persona_input x left join auth.users u on u.id=x.id left join public.profiles p on p.id=x.id
   where u.id is null or coalesce(u.email,'') not like '%@seed.gling.invalid'
   or p.city_id is distinct from x.city_id or p.nickname is distinct from x.nickname or p.account_status<>'active'
   or coalesce(u.raw_app_meta_data->>'role','')='admin' or u.raw_app_meta_data->'review_access'='true'::jsonb
   or exists(select 1 from private.personal_info i where i.user_id=x.id)
   or md5(coalesce(u.raw_app_meta_data,'{}'::jsonb)::text)<>x.metadata_md5 or md5(coalesce(p.bio,''))<>x.bio_md5
   or x.persona->>'profile_id' is distinct from x.id::text or x.persona->>'city_id' is distinct from x.city_id
   or x.persona->>'version' is distinct from '4' or x.persona->>'kind' is distinct from 'gling_operated_character'
   or char_length(x.persona->>'bio')>160) then
   raise exception 'SEED_PERSONA_SCOPE_OR_BASELINE_CHANGED';
 end if;
end $$;
create temporary table persona_before_auth on commit drop as
 select u.id,to_jsonb(u)-'raw_app_meta_data' protected,u.raw_app_meta_data original_metadata,coalesce(u.raw_app_meta_data,'{}'::jsonb)-'gling_persona' other_metadata
 from auth.users u;
create temporary table persona_before_profiles on commit drop as
 select p.id,to_jsonb(p)-'bio'-'updated_at' protected,p.bio from public.profiles p;
create temporary table persona_updated_metadata on commit drop as
 with updated as (update auth.users u set raw_app_meta_data=jsonb_set(coalesce(u.raw_app_meta_data,'{}'::jsonb),'{gling_persona}',x.persona,true)
 from persona_input x where u.id=x.id and u.raw_app_meta_data->'gling_persona' is distinct from x.persona returning u.id) select * from updated;
create temporary table persona_updated_bios on commit drop as
 with updated as (update public.profiles p set bio=x.persona->>'bio' from persona_input x
 where p.id=x.id and nullif(btrim(p.bio),'') is null returning p.id) select * from updated;
do $$ begin
 if exists(select 1 from persona_input x join auth.users u on u.id=x.id join public.profiles p on p.id=x.id
   where u.raw_app_meta_data->'gling_persona' is distinct from x.persona or nullif(btrim(p.bio),'') is null)
 or exists(select 1 from persona_before_auth b join auth.users u on u.id=b.id
   where b.protected is distinct from to_jsonb(u)-'raw_app_meta_data'
   or b.other_metadata is distinct from coalesce(u.raw_app_meta_data,'{}'::jsonb)-'gling_persona'
   or (not exists(select 1 from persona_input x where x.id=b.id) and u.raw_app_meta_data is distinct from b.original_metadata))
 or exists(select 1 from persona_before_profiles b join public.profiles p on p.id=b.id
   where b.protected is distinct from to_jsonb(p)-'bio'-'updated_at'
   or (not exists(select 1 from persona_input x where x.id=b.id) and b.bio is distinct from p.bio)) then
   raise exception 'SEED_PERSONA_UNEXPECTED_CHANGE';
 end if;
end $$;
select jsonb_build_object('profiles_verified',(select count(*) from persona_input),
 'metadata_updated',(select count(*) from persona_updated_metadata),'bios_updated',(select count(*) from persona_updated_bios),
 'human_profiles_and_auth_fields_preserved',true);
""" + ('commit;' if commit else 'rollback;')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report-dir', type=Path)
    args = parser.parse_args()
    from datetime import datetime, timezone
    report = args.report_dir or Path.home() / 'Library/Application Support/gling/operations/profile-personas' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    allowed = Path.home() / 'Library/Application Support/gling/operations'
    if not report.resolve().is_relative_to(allowed.resolve()):
        raise ValueError('PERSONA_REPORT_MUST_STAY_IN_PRIVATE_OPERATIONS')
    report.mkdir(parents=True, exist_ok=False, mode=0o700)
    original = MANIFEST.read_bytes()
    manifest = json.loads(original)
    by_id = {p['profile_id']: p for p in manifest['profiles'] if p.get('profile_id')}
    legacy = {(p['city_id'], p['nickname']): p for p in manifest['profiles'] if not p.get('profile_id')}
    helper = runpy.run_path(str(ROOT / 'scripts/storage-usage.py'))
    access = helper['token']()
    query = """select p.id,p.nickname,p.city_id,p.bio,md5(coalesce(p.bio,'')) bio_md5,
 u.raw_app_meta_data metadata,md5(coalesce(u.raw_app_meta_data,'{}'::jsonb)::text) metadata_md5,
 (select coalesce(jsonb_agg(recent),'[]'::jsonb) from (select post.id,post.title,post.body,post.created_at,t.slug tag
 from public.posts post join public.tags t on t.id=post.tag_id where post.author_id=p.id and post.status='published'
 order by post.created_at desc,post.id limit 3) recent) recent_posts
 from public.profiles p join auth.users u on u.id=p.id
 where u.email like '%@seed.gling.invalid' and p.account_status='active'
 and coalesce(u.raw_app_meta_data->>'role','')<>'admin' and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
 and not exists(select 1 from private.personal_info i where i.user_id=p.id)
 order by p.city_id,p.nickname;"""
    current = helper['query'](query, access)
    (report / 'before.json').write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n')
    (report / 'before.json').chmod(0o600)
    rows, entries = [], []
    for profile in current:
        prior = by_id.get(profile['id'], legacy.get((profile['city_id'], profile['nickname'])))
        persona = enrich(profile, prior, (profile['metadata'] or {}).get('gling_persona'))
        rows.append({k: profile[k] for k in ['id', 'nickname', 'city_id', 'metadata_md5', 'bio_md5']} | {'persona': persona})
        entries.append({**persona, 'recent_posts': profile['recent_posts']})
    planned = {**manifest, 'note': '2026-10-12 v4. 기존 도시 운영 캐릭터의 상세 설정은 고정하며 실제 최근 글로 연속성을 확인한다. 서버 app metadata gling_persona와 같은 profile_id에 연결한다.', 'profiles': entries}
    (report / 'planned-manifest.json').write_text(json.dumps(planned, ensure_ascii=False, indent=2) + '\n')
    sql = build_sql(rows, commit=args.apply)
    (report / 'apply.sql').write_text(sql + '\n')
    (report / 'apply.sql').chmod(0o600)
    verification = helper['query'](sql, access)[0]['jsonb_build_object']
    after = helper['query'](query, access)
    live = {p['id']: p for p in after}
    if args.apply:
        for row in rows:
            assert live[row['id']]['metadata']['gling_persona'] == row['persona'], row['id']
        if MANIFEST.read_bytes() != original:
            raise ValueError('PERSONAS_SAVED_DB_MANIFEST_CHANGED_RECONCILE_FROM_REPORT')
        runpy.run_path(str(ROOT / 'scripts/city-post-schedule.py'))['save'](MANIFEST, planned)
    else:
        assert current == after, 'PERSONA_REHEARSAL_DID_NOT_ROLL_BACK'
    result = {'committed': args.apply, 'verification': verification, 'live_readback_verified': True, 'report_path': str(report)}
    (report / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
