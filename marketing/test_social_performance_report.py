"""Critical metric and report boundary checks; no network or social actions."""
import unittest
from copy import deepcopy

from social_performance_report import view_change, validate, render, experiment_plan_hash, experiment_result


class SocialReportChecks(unittest.TestCase):
    def sample(self):
        return {
            "report_date": "2026-10-07", "run_id": "check",
            "generated_at": "2026-10-07T21:35:00-07:00", "status": "partial",
            "summary": "<script>alert(1)</script>",
            "accounts": [
                {"platform": "threads", "account": "chalkakandupload", "status": "partial"},
                {"platform": "instagram", "account": "gling.app", "status": "blocked"},
            ],
            "posts": [{
                "id": "test", "platform": "threads", "account": "chalkakandupload",
                "url": "https://www.threads.com/@chalkakandupload/post/test",
                "format": "text", "observed_at": "2026-10-07T21:35:00-07:00",
                "content_sha256": "same", "metrics": {"views": 120, "comments": None, "likes": 0},
                "previous": {"observed_at": "2026-10-06T21:35:00-07:00", "views": 100, "content_sha256": "same"},
            }], "comparisons": [], "next_steps": [], "sources": [],
        }

    def test_real_zero_missing_growth_and_unreliable_observations(self):
        post = self.sample()["posts"][0]
        self.assertEqual(view_change(post), 20)
        for field, value in [("views", None), ("views", 90), ("content_sha256", "changed"), ("approximate", True)]:
            changed = dict(post, **{field: value}) if field != "views" else dict(post, metrics={"views": value})
            self.assertIsNone(view_change(changed))
        same_time = dict(post, observed_at=post["previous"]["observed_at"])
        self.assertIsNone(view_change(same_time))
        zero = dict(post, metrics={"views": 100})
        self.assertEqual(view_change(zero), 0)

    def test_account_metrics_and_link_boundaries(self):
        for change in [
            {"account": "other"}, {"url": "javascript:alert(1)"},
            {"metrics": {"views": -1}}, {"metrics": {"views": True}},
            {"observed_at": "2026-10-07T21:35:00"},
        ]:
            data = self.sample()
            data["posts"][0].update(change)
            with self.assertRaises(ValueError):
                validate(data)

    def test_render_preserves_unknown_and_escapes_content(self):
        result = render(self.sample())
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", result)
        self.assertIn("미확인", result)
        self.assertIn('lang="ko"', result)
        self.assertIn("chalkakandupload", result)
        self.assertIn("gling.app", result)

    def test_official_threads_and_personal_threads_are_separate_accounts(self):
        data = self.sample()
        data['accounts'].insert(0, {'platform': 'threads', 'account': 'gling.app', 'status': 'complete'})
        official = deepcopy(data['posts'][0])
        official.update(id='official', account='gling.app', url='https://www.threads.com/@gling.app/post/official')
        data['posts'].insert(0, official)
        result = render(data)
        self.assertIn('글링 공식 Threads', result)
        self.assertEqual(result.count('href="https://www.threads.com/@gling.app/post/official"'), 1)
        self.assertEqual(result.count('href="https://www.threads.com/@chalkakandupload/post/test"'), 1)
        data['accounts'] = [a for a in data['accounts'] if a['account'] != 'chalkakandupload']
        with self.assertRaises(ValueError):
            validate(data)

    def experiment(self):
        item = {"id": "trial", "predecessor_id": None, "plan": {
            "platform": "threads", "account": "chalkakandupload", "created_at": "2026-10-07T21:35:00-07:00",
            "change": "질문 하나", "primary_metric": "comments_per_1000_views",
            "minimum_denominator": 500, "minimum_events": 5, "relative_threshold": .2, "absolute_threshold": .5,
        }, "targets": [], "observations": [], "frozen_at": "2026-10-08T07:00:00-07:00",
            "guardrails_passed": True, "comparison_receipt": "/proof/comparison.json", "confounders": []}
        item["plan_sha256"] = experiment_plan_hash(item)
        for arm, hour in (("reference", "08"), ("test", "10")):
            digest = ("a" if arm == "reference" else "b") * 64
            publication = {"platform": "threads", "account": "chalkakandupload", "native_id": arm,
                           "url": "https://www.threads.com/@chalkakandupload/post/" + arm,
                           "published_at": f"2026-10-08T{hour}:00:00-07:00", "verified_at": f"2026-10-08T{hour}:01:00-07:00",
                           "content_sha256": digest, "source": "/proof/native.json"}
            item["targets"].append({"arm": arm, "content_id": arm, "content_sha256": digest,
                                    "selected_at": "2026-10-08T07:00:00-07:00", "plan_sha256": item["plan_sha256"],
                                    "applied_at": "2026-10-08T07:00:00-07:00", "application_receipt": "/proof/applied.json",
                                    "publication": publication})
            for day in (10, 15):
                item["observations"].append({**publication, "observed_at": f"2026-10-{day}T21:35:00-07:00",
                                             "metrics": {"views": 1000, "comments": 10 if arm == "reference" else 15}})
        return item

    def test_experiment_requires_application_and_real_publication(self):
        item = self.experiment()
        item["targets"] = []
        self.assertEqual(experiment_result(item, "2026-10-09T21:35:00-07:00")["stage"], "planned")
        item = self.experiment()
        for target in item["targets"]:
            target.pop("publication")
        result = experiment_result(item, "2026-10-09T21:35:00-07:00")
        self.assertEqual(result["stage"], "awaiting_publication")
        self.assertFalse(result["due"])
        item["targets"][1].pop("application_receipt")
        self.assertEqual(experiment_result(item, "2026-10-09T21:35:00-07:00")["stage"], "awaiting_application")

    def test_experiment_uses_due_windows_and_does_not_finish_early(self):
        item = self.experiment()
        early = experiment_result(item, "2026-10-10T21:35:00-07:00")
        self.assertEqual(early["stage"], "observing")
        self.assertEqual(early["windows"][0]["signal"], "directional_support")
        self.assertIsNone(early["windows"][1]["signal"])
        final = experiment_result(item, "2026-10-15T21:35:00-07:00")
        self.assertEqual(final["stage"], "measured")
        self.assertEqual(final["windows"][1]["test_rate"], 15)
        changed = deepcopy(item)
        changed["observations"][1]["observed_at"] = "2026-10-16T10:00:00-07:00"  # late 7d
        self.assertEqual(experiment_result(changed, "2026-10-16T21:35:00-07:00")["stage"], "inconclusive")

    def test_experiment_rejects_wrong_bindings_and_posthoc_comparisons(self):
        for path, value in [("account", "someone_else"), ("content_sha256", "c" * 64), ("source", "")]:
            item = self.experiment()
            item["targets"][1]["publication"][path] = value
            self.assertEqual(experiment_result(item, "2026-10-15T21:35:00-07:00")["stage"], "inconclusive")
        for field, value in [("frozen_at", "2026-10-08T09:00:00-07:00"), ("confounders", ["속도도 변경"]), ("guardrails_passed", False)]:
            item = self.experiment()
            item[field] = value
            self.assertEqual(experiment_result(item, "2026-10-15T21:35:00-07:00")["stage"], "inconclusive")
        item = self.experiment()
        item["plan"]["change"] = "결과를 보고 다른 가설로 교체"
        self.assertEqual(experiment_result(item, "2026-10-15T21:35:00-07:00")["stage"], "inconclusive")

    def test_experiment_missing_zero_and_low_exposure_do_not_win(self):
        for views, comments in [(0, 0), (100, 5), (1000, None), (1000, 0)]:
            item = self.experiment()
            for obs in item["observations"]:
                obs["metrics"] = {"views": views, "comments": comments}
            result = experiment_result(item, "2026-10-16T21:35:00-07:00")
            self.assertEqual(result["stage"], "inconclusive")
        item = self.experiment()
        item["observations"][3]["approximate"] = True
        self.assertEqual(experiment_result(item, "2026-10-16T21:35:00-07:00")["stage"], "inconclusive")

    def test_reels_uses_saves_shares_and_reach_without_views_fallback(self):
        item = self.experiment()
        item["plan"].update(platform="instagram", account="gling.app", primary_metric="saves_shares_per_1000_reach", minimum_denominator=100)
        item["plan_sha256"] = experiment_plan_hash(item)
        for target in item["targets"]:
            target["plan_sha256"] = item["plan_sha256"]
            target["publication"].update(platform="instagram", account="gling.app", url="https://www.instagram.com/reel/" + target["arm"] + "/")
        for obs in item["observations"]:
            arm = obs["native_id"]
            obs.update(platform="instagram", account="gling.app", url="https://www.instagram.com/reel/" + arm + "/",
                       metrics={"reach": 200, "views": 10000, "saves": 5 if arm == "reference" else 10, "shares": 5})
        result = experiment_result(item, "2026-10-15T21:35:00-07:00")
        self.assertEqual(result["windows"][1]["test_rate"], 75)
        for obs in item["observations"]:
            obs["metrics"]["reach"] = None
        self.assertEqual(experiment_result(item, "2026-10-16T21:35:00-07:00")["stage"], "inconclusive")

    def test_report_displays_planned_trials_without_fake_results(self):
        data, item = self.sample(), self.experiment()
        item["targets"], item["observations"] = [], []
        data["experiments"] = [item]
        result = render(data)
        self.assertIn("개선 시험과 결과", result)
        self.assertIn("48시간과7일 결과는 아직 없습니다", result)
        self.assertNotIn("긍정 신호 · 재검증</", result)

    def test_missing_comparison_expires_without_stalling_the_loop(self):
        item = self.experiment()
        item["targets"] = [item["targets"][1]]
        self.assertEqual(experiment_result(item, "2026-10-10T21:35:00-07:00")["stage"], "awaiting_publication")
        self.assertEqual(experiment_result(item, "2026-10-16T21:35:00-07:00")["stage"], "inconclusive")


if __name__ == "__main__":
    unittest.main()
