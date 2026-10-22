"""Render source-backed Gling social reports locally; no network or publishing."""
import argparse
import base64
from datetime import date, datetime, timedelta
import hashlib
import html
import json
import math
import re
from pathlib import Path
import tempfile
from string import Template
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
ACCOUNTS = {("threads", "gling.app"), ("threads", "chalkakandupload"), ("instagram", "gling.app")}
LABELS = {("threads", "gling.app"): "글링 공식 Threads", ("threads", "chalkakandupload"): "개인 Threads",
          ("instagram", "gling.app"): "글링 Reels"}
STATES = {"partial": "일부 확인", "blocked": "조회 보류", "cached": "이전 관측", "complete": "확인 완료"}
EXPERIMENT_METRICS = {"comments_per_1000_views": (("comments",), "views"),
                      "saves_shares_per_1000_reach": (("saves", "shares"), "reach")}


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("A timezone is required")
    return parsed


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def safe_url(value):
    value = str(value)
    parts = urlsplit(value)
    if parts.scheme not in ("https", "file", "") or parts.username or parts.password or (not parts.scheme and parts.netloc):
        raise ValueError("Unsafe report link")
    if parts.scheme == "https" and not parts.hostname:
        raise ValueError("Missing report link host")
    return value


def validate(data):
    date.fromisoformat(data["report_date"])
    timestamp(data["generated_at"])
    seen = set()
    covered = {(a["platform"], a["account"]) for a in data["accounts"]}
    if len(covered) != len(data["accounts"]) or not covered <= ACCOUNTS or ("instagram", "gling.app") not in covered or not any(p == "threads" for p, _ in covered):
        raise ValueError("Exact reporting accounts and platform coverage are required")
    for post in data.get("posts", []):
        if (post["platform"], post["account"]) not in covered:
            raise ValueError("Wrong reporting account")
        if post["url"] in seen:
            raise ValueError("Duplicate observation URL")
        seen.add(post["url"])
        if urlsplit(safe_url(post["url"])).scheme != "https":
            raise ValueError("Published posts require HTTPS permalinks")
        observed = timestamp(post["observed_at"])
        if post.get("published_at") and timestamp(post["published_at"]) > observed:
            raise ValueError("Future reservations are not published performance")
        for value in post.get("metrics", {}).values():
            if value is not None and not number(value):
                raise ValueError("Metrics must be finite non-negative numbers or null")
    for item in data.get("comparisons", []):
        if item["account"] not in {a for _, a in covered}:
            raise ValueError("Wrong comparison account")
        for name in ("higher", "lower"):
            if item.get(name):
                safe_url(item[name])
    for item in data.get("sources", []):
        safe_url(item["url"])
    return data


def view_change(post):
    previous = post.get("previous") or {}
    current, old = post.get("metrics", {}).get("views"), previous.get("views")
    if not number(current) or not number(old) or current < old:
        return None
    if post.get("approximate") or previous.get("approximate"):
        return None
    if not post.get("content_sha256") or post["content_sha256"] != previous.get("content_sha256"):
        return None
    if not previous.get("observed_at") or timestamp(post["observed_at"]) <= timestamp(previous["observed_at"]):
        return None
    return current - old


def experiment_plan_hash(item):
    frozen = {key: item.get(key) for key in ("id", "predecessor_id", "plan")}
    return hashlib.sha256(json.dumps(frozen, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def experiment_result(item, now):
    """Check prospective organic pairs; never turn a draft/early/missing value into a win."""
    now, plan = timestamp(now), item["plan"]
    result = {"stage": "planned", "reason": "적격 콘텐츠 선정 대기", "rows": [], "windows": [], "due": []}
    def hold(reason):
        return {**result, "stage": "inconclusive", "reason": reason}
    metric = plan.get("primary_metric")
    expected = "comments_per_1000_views" if plan.get("platform") == "threads" else "saves_shares_per_1000_reach"
    if (plan.get("platform"), plan.get("account")) not in ACCOUNTS or metric != expected:
        return hold("시험 계정/지표 불일치")
    if item.get("plan_sha256") != experiment_plan_hash(item):
        return hold("동결한 가설/기준이 변경됨 · 새 시험 ID 필요")
    if any(not number(plan.get(k)) or plan[k] <= 0 for k in ("minimum_denominator", "minimum_events", "relative_threshold", "absolute_threshold")):
        return hold("사전 판정 기준 누락 또는 잘못된 값")
    targets = item.get("targets", [])
    test = [t for t in targets if t.get("arm") == "test"]
    if not test:
        return result
    if len(test) != 1 or len(targets) > 2 or len({t.get("content_id") for t in targets}) != len(targets):
        return hold("시험/비교 콘텐츠 중복")
    if not test[0].get("application_receipt") or not test[0].get("applied_at"):
        return {**result, "stage": "awaiting_application", "reason": "실제 적용 영수증 대기"}
    if test[0].get("plan_sha256") != item["plan_sha256"]:
        return hold("적용본의 계획 hash 불일치")
    live = [t for t in targets if t.get("publication")]
    if not live:
        return {**result, "stage": "awaiting_publication", "reason": "실제 공개 확인 대기 · 예약은 측정 시작이 아님"}
    for target in live:
        pub = target["publication"]
        try:
            if (any(not pub.get(k) for k in ("native_id", "source", "verified_at", "published_at"))
                    or pub.get("account") != plan["account"] or pub.get("platform") != plan["platform"]
                    or pub.get("content_sha256") != target.get("content_sha256")
                    or not re.fullmatch("[a-f0-9]{64}", str(pub.get("content_sha256")))
                    or urlsplit(safe_url(pub["url"])).scheme != "https"
                    or not timestamp(plan["created_at"]) <= timestamp(pub["published_at"]) <= timestamp(pub["verified_at"]) <= now):
                return hold("공개 계정/최종 hash/시각/근거 불일치")
        except (KeyError, ValueError, TypeError, AttributeError):
            return hold("실제 공개 연결 근거 부족")
    paired = len(live) == 2 and {t.get("arm") for t in live} == {"test", "reference"}
    first = min(timestamp(t["publication"]["published_at"]) for t in live)
    if (not item.get("frozen_at") or not timestamp(plan["created_at"]) <= timestamp(item["frozen_at"]) <= first
            or any(not t.get("selected_at") or not timestamp(plan["created_at"]) <= timestamp(t["selected_at"]) <= timestamp(item["frozen_at"]) for t in targets)
            or not timestamp(plan["created_at"]) <= timestamp(test[0]["applied_at"]) <= timestamp(test[0].get("publication", {}).get("published_at", now.isoformat()))):
        return hold("공개 이후 선정/변경된 비교 · 사후 판정 불가")
    comparable = (paired and item.get("guardrails_passed") is True and bool(item.get("comparison_receipt"))
                  and not item.get("confounders") and len({t["publication"]["url"] for t in live}) == len({t["publication"]["native_id"] for t in live}) == 2
                  and (max(timestamp(t["publication"]["published_at"]) for t in live) - first).total_seconds() <= 72 * 3600)
    numerator_keys, denominator_key = EXPERIMENT_METRICS[metric]
    for hours in (48, 168):
        rows = []
        for target in live:
            pub = target["publication"]
            due = timestamp(pub["published_at"]) + timedelta(hours=hours)
            end = due + timedelta(hours=24)
            matches = [o for o in item.get("observations", [])
                       if all(o.get(k) == pub.get(k) for k in ("platform", "account", "url", "content_sha256", "published_at"))
                       and o.get("source") and not o.get("approximate")
                       and due <= timestamp(o["observed_at"]) < end and timestamp(o["observed_at"]) <= now
                       and all(number(o.get("metrics", {}).get(k)) for k in (*numerator_keys, denominator_key))]
            obs = min(matches, key=lambda o: timestamp(o["observed_at"])) if matches else None
            denominator = obs["metrics"][denominator_key] if obs else None
            numerator = sum(obs["metrics"][k] for k in numerator_keys) if obs else None
            row = {"content_id": target["content_id"], "arm": target["arm"], "url": pub["url"], "window": hours,
                   "observed_at": obs["observed_at"] if obs else None, "source": obs["source"] if obs else None,
                   "age_hours": (timestamp(obs["observed_at"]) - timestamp(pub["published_at"])).total_seconds() / 3600 if obs else None,
                   "numerator": numerator, "denominator": denominator,
                   "rate": 1000 * numerator / denominator if denominator else None,
                   "due_at": due.isoformat(), "expires_at": end.isoformat(),
                   "status": "captured" if obs else "not_due" if now < due else "missed" if now >= end else "due"}
            rows.append(row)
            if not obs and due <= now < end:
                result["due"].append(row)
        result["rows"].extend(rows)
        rates = {r["arm"]: r["rate"] for r in rows}
        window = {"hours": hours, "test_rate": rates.get("test"), "reference_rate": rates.get("reference"),
                  "relative_change": None, "signal": None, "reason": "관측 대기"}
        if paired and all(r["observed_at"] for r in rows):
            eligible = (comparable and all(r["rate"] is not None and r["denominator"] >= plan["minimum_denominator"] for r in rows)
                        and sum(r["numerator"] for r in rows) >= plan["minimum_events"]
                        and abs(rows[0]["age_hours"] - rows[1]["age_hours"]) <= 12)
            window["signal"] = "inconclusive"
            window["reason"] = "노출/반응 부족 또는 비교·품질·교란 조건 불일치"
            if eligible:
                baseline, treatment = rates["reference"], rates["test"]
                window["relative_change"] = (treatment - baseline) / baseline if baseline else None
                support = treatment - baseline >= plan["absolute_threshold"] and treatment >= baseline * (1 + plan["relative_threshold"])
                window.update(signal="directional_support" if support else "not_supported", reason="자연 노출 한 쌍의 방향 신호 · 인과/통계적 승자 아님")
        result["windows"].append(window)
    final = result["windows"][-1]
    expired = all(now >= timestamp(t["publication"]["published_at"]) + timedelta(hours=192) for t in live)
    stage = ("measured" if final["signal"] in ("directional_support", "not_supported")
             else "inconclusive" if final["signal"] == "inconclusive" or expired
             else "awaiting_publication" if not paired else "observing")
    return {**result, "stage": stage, "reason": final["reason"] if stage == "measured" else
            "비교/관측 보완 필요" if stage == "inconclusive" else "실제 공개 비교본 대기" if not paired else "48h 중간 점검 → 7d 관측까지 이월"}


def esc(value):
    return html.escape(str(value if value is not None else "미확인"), quote=True)


def count(value):
    return f"{value:,.0f}" if number(value) else "미확인"


def display_time(value):
    return timestamp(value).astimezone(ZoneInfo("America/Vancouver")).strftime("%m/%d %H:%M (밴쿠버)") if value else "미확인"


def link(url, label):
    return f'<a href="{esc(safe_url(url))}">{esc(label)}</a>'


def paragraphs(value):
    return "".join(f"<p>{esc(part)}</p>" for part in str(value or "미확인").split("\n\n"))


def render_experiments(data):
    stages = {"planned": "적용 대상 선정 대기", "awaiting_application": "실제 적용 대기", "awaiting_publication": "공개 확인 대기",
              "observing": "결과 관측 중", "measured": "7일 결과 확인 · 다음 시험 검토", "inconclusive": "판정 보류 · 근거 보완"}
    signals = {"directional_support": "긍정 신호 · 재검증", "not_supported": "개선 신호 부족 · 한 요소 수정", "inconclusive": "판정 보류"}
    blocks = []
    for item in data.get("experiments", []):
        plan = item["plan"]
        result = experiment_result(item, data["generated_at"])
        unit = "조회1,000회당 답글" if plan["platform"] == "threads" else "도달1,000명당 저장+공유"
        rows = []
        for row in result["rows"]:
            value = f'{row["rate"]:.2f}' if row["rate"] is not None else "미확인"
            scope = f'{row["age_hours"]:.1f}h' if row["age_hours"] is not None else "미관측"
            rows.append(f'<tr><th scope="row">{link(row["url"], row["content_id"])}<small>{"개선본" if row["arm"] == "test" else "비교본"} · {"48h" if row["window"] == 48 else "7d"} 창</small></th>'
                        f'<td>{value}<small>{count(row["numerator"])} / {count(row["denominator"])}</small></td><td>{scope}<small>{display_time(row["observed_at"])}</small></td></tr>')
        table = ('<div class="table-wrap" tabindex="0" aria-label="실험별 관측 표 가로 스크롤"><table class="experiment-table">'
                 f'<caption>핵심 지표: {unit} · 분자/분모 원값도 함께 표시</caption><thead><tr><th scope="col">대상·관측 창</th><th scope="col">핵심 지표</th><th scope="col">실제 게시 나이</th></tr></thead>'
                 f'<tbody>{"".join(rows)}</tbody></table></div>') if rows else '<p class="empty">실제 적용·공개 확인 전입니다. 48시간과7일 결과는 아직 없습니다.</p>'
        windows = "".join(f'<li><strong>{"48시간 중간 점검" if w["hours"] == 48 else "7일 결과"}</strong> · {signals.get(w["signal"], "관측 대기")}'
                          f'<small>{esc(w["reason"])}{" / 상대 변화 " + format(w["relative_change"], "+.1%") if w["relative_change"] is not None else ""}</small></li>' for w in result["windows"])
        if not windows:
            windows = '<li>48시간 중간 점검 · 실제 공개 후48–72시간 창</li><li>7일 결과 · 실제 공개 후168–192시간 창</li>'
        due = "".join(f'<p class="muted">{esc(r["content_id"])} · {"48h" if r["window"] == 48 else "7d"} 조회 필요 / 창 종료 {display_time(r["expires_at"])}</p>' for r in result["due"])
        decision = item.get("decision") or {}
        actions = {"repeat": "다른 장면으로 재시험", "revise": "한 요소 수정", "collect": "관측 보완", "stop": "해당 가설 중단"}
        bound_sources = {r["source"] for r in result["rows"] if r["source"]}
        decision_bound = bool(decision.get("observation_sources")) and set(decision["observation_sources"]) <= bound_sources
        conclusion = (f'<p><strong>{esc(actions.get(decision.get("action"), "다음 행동 검토"))}</strong></p>' + paragraphs(decision.get("rationale"))
                      if result["stage"] in ("measured", "inconclusive") and decision_bound else
                      '<p>측정 근거가 모이면 재시험·한 요소 수정·관측 보완 중 다음 행동을 정합니다.</p>')
        fixed = " · ".join(plan.get("fixed", []))
        confounders = " · ".join(item.get("confounders", [])) or ("선정 시 확인 대기" if result["stage"] == "planned" else "기록 없음")
        blocks.append(f'<article class="experiment"><h3>{esc(plan.get("title", item["id"]))}<span>@{esc(plan["account"])}</span></h3>'
                      f'<p class="status">{esc(stages[result["stage"]])} · {esc(item["id"])}</p>{paragraphs(plan["change"])}<p class="muted">가설: {esc(plan.get("hypothesis"))}</p>'
                      f'<p><strong>핵심 지표</strong> · {unit}</p><p class="muted">{esc(result["reason"])} / {esc(item.get("blocker") or "다음 정상 회차에서 현재 적격성 확인")}</p>'
                      f'{table}<ul class="actions">{windows}</ul>{due}<h4>다음 행동</h4>{conclusion}{paragraphs(item.get("next_check"))}'
                      f'<details><summary>고정 조건과 비교 근거</summary><div class="detail">{paragraphs(fixed)}{paragraphs(plan.get("comparison_rule"))}'
                      f'<p>두 글 각각 분모{count(plan["minimum_denominator"])} 이상 · 핵심 반응 합계{count(plan["minimum_events"])} 이상. '
                      f'7일 창에서{plan["relative_threshold"]:.0%} 이상, 1,000회/명당{plan["absolute_threshold"]:g}건 이상 증가하면 다른 장면으로 재검증합니다.</p>'
                      f'<p class="muted">계획 {display_time(plan["created_at"])} · 선행 시험 {esc(item.get("predecessor_id") or "첫 시험")}<br>근거 보고: {esc(plan.get("source_report"))}<br>'
                      f'교란: {esc(confounders)}</p></div></details></article>')
    return "".join(blocks) or '<p class="empty">직전 보고에 이어갈 시험이 없습니다. 현재 근거와 다음 적격 후보를 확인합니다.</p>'


def render(data):
    validate(data)
    blocks = []
    used_sections = set()
    for coverage in data["accounts"]:
        platform, account = coverage["platform"], coverage["account"]
        section = platform if platform not in used_sections else platform + '-' + account.replace('.', '-')
        used_sections.add(platform)
        posts = [p for p in data.get("posts", []) if p["platform"] == platform and p["account"] == account]
        rows, cases = [], []
        for post in posts:
            metrics = post.get("metrics", {})
            age = ((timestamp(post["observed_at"]) - timestamp(post["published_at"])).total_seconds() / 3600
                   if post.get("published_at") else None)
            delta = view_change(post)
            title = post.get("title") or post["id"]
            views = ("약 " if post.get("approximate") else "") + count(metrics.get("views"))
            rows.append(f'<tr><th scope="row">{link(post["url"], title)}<small>{esc(post.get("format"))} / {esc(post.get("observation_scope"))}<br>관측 {display_time(post["observed_at"])}</small></th>'
                        f'<td>{views}</td><td>{count(metrics.get("likes"))}</td><td>{count(metrics.get("comments"))}</td><td>{count(metrics.get("shares"))}</td><td>{count(metrics.get("saves"))}</td>'
                        f'<td>{f"{age:.1f}시간" if age is not None else "미확인"}</td><td>{"+" + count(delta) if delta is not None else "미확인"}</td></tr>')
            structure = "".join(f'<li><span>{esc(s.get("time"))}</span><div>{paragraphs(s.get("observation"))}<small>근거: {esc(s.get("source"))}</small></div></li>' for s in post.get("structure", []))
            extra = " · ".join(f'{label} {count(metrics[key])}{unit}' for key, label, unit in (
                ("reach", "도달", ""), ("profile_visits", "프로필 방문", ""), ("follows", "팔로우", ""),
                ("watch_seconds", "총 시청시간", "초"), ("average_watch_seconds", "평균 시청", "초")) if number(metrics.get(key)))
            cases.append(f'<details><summary>{esc(title)} · 전개와 개선점</summary><div class="detail">'
                         f'<p class="muted">{esc(post.get("structure_scope", "전개 미점검"))} / 음향: {esc(post.get("audio_scope", "해당 없음 또는 미청취"))}</p>'
                         f'{"<p>" + extra + "</p>" if extra else ""}'
                         f'<ol class="sequence">{structure}</ol>{"<p>실제 전개 관찰 자료가 없습니다.</p>" if not structure else ""}'
                         f'<h4>다음 개선 후보</h4>{paragraphs(post.get("improvement"))}<p class="muted">원자료: {esc(post.get("source"))}</p></div></details>')
        comparisons = []
        for case in data.get("comparisons", []):
            if case["account"] != account:
                continue
            if case.get('platform') != platform and (case.get('platform') or sum(a['account'] == account for a in data['accounts']) > 1):
                continue
            references = " / ".join(link(case[k], label) for k, label in (("higher", "상위 관측 사례"), ("lower", "하위 관측 사례")) if case.get(k))
            comparisons.append(f'<article class="comparison"><h3>{references or "비교 근거 부족"}</h3><p class="muted">{esc(case.get("basis"))}</p>'
                               f'<h4>관측한 차이</h4>{paragraphs(case.get("difference"))}<h4>가능한 이유 · 가설</h4>{paragraphs(case.get("hypothesis"))}'
                               f'<h4>다음에 바꿀 한 가지</h4>{paragraphs(case.get("change"))}<p class="muted">비교 한계: {esc(case.get("limitation"))}</p></article>')
        table = ('<div class="table-wrap" tabindex="0" aria-label="글별 성과 표 가로 스크롤"><table><caption>글별 관측값 · 계정 합계와 별도</caption>'
                 '<thead><tr><th scope="col">콘텐츠</th><th scope="col">조회</th><th scope="col">좋아요</th><th scope="col">답글·댓글</th><th scope="col">공유</th><th scope="col">저장</th><th scope="col">게시 나이</th><th scope="col">직전 대비 조회</th></tr></thead>'
                 f'<tbody>{"".join(rows)}</tbody></table></div>') if rows else '<p class="empty">이번 보고에 포함할 실제 글별 관측이 없습니다. 확인 범위와 원인을 아래에 남겼습니다.</p>'
        blocks.append(f'<section id="{section}"><h2>{LABELS[(platform, account)]} <span>@{account}</span></h2><p class="status">{esc(STATES.get(coverage.get("status"), coverage.get("status")))} · 관측 {display_time(coverage.get("observed_at"))}</p>'
                      f'{paragraphs(coverage.get("note"))}{table}<div class="comparisons">{"".join(comparisons) or "<p>비교 가능한 상·하위 표본을 아직 확보하지 못했습니다.</p>"}</div>'
                      f'<div class="cases">{"".join(cases)}</div></section>')
    steps = "".join(f'<li><strong>@{esc(s.get("account"))} · {esc(s.get("target"))}</strong>{paragraphs(s.get("change"))}<small>{esc(s.get("hypothesis"))} / {esc(s.get("status"))}</small></li>' for s in data.get("next_steps", []))
    sources = "".join(f'<li>{link(s["url"], s.get("label") or s["url"])}</li>' for s in data.get("sources", []))
    logo = base64.b64encode((ROOT.parent / "assets/brand/gling-night-wordmark.png").read_bytes()).decode()
    font = (ROOT.parent / "output/design/gling-cinematic-korean-2026-09-30/MaruBuri-SemiBold.woff2").as_uri()
    return Template((ROOT / "templates/social-performance.html").read_text()).substitute(
        logo=logo, font=font, report_date=esc(data["report_date"]), generated_at=display_time(data["generated_at"]),
        status=esc(STATES.get(data.get("status"), data.get("status"))), summary=paragraphs(data.get("summary")), blocks="".join(blocks),
        experiments=render_experiments(data),
        steps=steps or "<li>새 제안을 만들 근거가 부족합니다. 기존 승인·예약 콘텐츠를 유지합니다.</li>",
        sources=sources or "<li>새 원자료 미확인</li>")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    content = render(json.loads(args.data.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=args.output.parent, encoding="utf-8", delete=False) as target:
        target.write(content)
        temporary = Path(target.name)
    temporary.replace(args.output)
    print(f"Rendered source-backed report: {args.output.resolve()}")


if __name__ == "__main__":
    main()
