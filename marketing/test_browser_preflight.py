"""Run with: python3 marketing/test_browser_preflight.py (no browser writes)."""
import runpy
import unittest
from pathlib import Path


class BrowserPreflightTests(unittest.TestCase):
    def guard(self):
        source = Path(__file__).with_name("browser_preflight.py")
        if not source.exists():
            self.fail("Missing deterministic Gling tab/input preflight")
        return runpy.run_path(str(source))

    def test_background_owned_tab_and_wrong_destinations(self):
        guard = self.guard()
        tab = {"browserPageId": "test-page", "active": False,
               "worktreeId": "folder:e88d505b-f6bb-47d6-ba41-904ef2a72a8b",
               "profileId": "default", "url": "https://www.threads.com/search?q=test"}
        self.assertEqual(guard["checked_tab"]([tab], "test-page", "threads"), tab)
        for change in ({"worktreeId": "folder:other-product"},
                       {"profileId": "other-account"},
                       {"url": "https://www.threads.com.attacker.example/"},
                       {"url": "http://www.threads.com/"},
                       {"url": "https://user@www.threads.com/"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                guard["checked_tab"]([{**tab, **change}], "test-page", "threads")
        for tabs in ([], [tab, tab]):
            with self.assertRaises(ValueError):
                guard["checked_tab"](tabs, "test-page", "threads")

    def test_search_is_not_a_draft_but_composers_still_block(self):
        guard = self.guard()
        search = {"isSearch": True, "nonEmpty": True}
        composer = {"isSearch": False, "nonEmpty": True}
        self.assertFalse(guard["blocked_input"]({"dialogOpen": False, "editables": [search]}))
        for probe in ({"dialogOpen": False, "editables": [search, composer]},
                      {"dialogOpen": True, "editables": [search]},
                      {"dialogOpen": False, "editables": [{}]}):
            with self.subTest(probe=probe):
                self.assertTrue(guard["blocked_input"](probe))


if __name__ == "__main__":
    unittest.main()
