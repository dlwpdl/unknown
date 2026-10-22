"""Keyboard routing checks use only a fake CLI and temporary GUI guards."""
import os
from pathlib import Path
import runpy
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("browser_preflight.py")


class BrowserInputTests(unittest.TestCase):
    def test_unfocused_page_and_terminal_receiver_never_receive_text(self):
        for focus, receiver, allowed in ((False, "Editor content", False),
                                         (True, "Terminal input", False),
                                         (True, "Editor content", True)):
            with self.subTest(focus=focus, receiver=receiver), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                cli = root / "orca"
                cli.write_text("#!" + sys.executable + "\n" + """
import json,os,sys
from pathlib import Path
if sys.argv[1] == 'eval':
    result={'result':json.dumps({'hasFocus':os.environ['TEST_PAGE_FOCUS']=='yes'})}
elif sys.argv[1] == 'computer':
    result={'snapshot':{'focusedElementId':4,'treeText':'4 text field '+os.environ['TEST_RECEIVER']}}
else:
    (Path(__file__).parent/'input-sent').touch()
    result={}
print(json.dumps({'ok':True,'result':result}))
""")
                cli.chmod(0o700)
                environment = {"PATH": directory + os.pathsep + os.environ["PATH"],
                               "TEST_PAGE_FOCUS": "yes" if focus else "no",
                               "TEST_RECEIVER": receiver}
                guard = runpy.run_path(str(SOURCE))
                with patch.dict(os.environ, environment):
                    with guard["gui_bundle"]("test", "keyboard", time.time() + 5, lock=root / "gui.lock"):
                        if allowed:
                            guard["orca"]("inserttext", "--worktree", "all", "--page", "owned-page", "--text", "safe test")
                        else:
                            with self.assertRaisesRegex(ValueError, "GUI_INPUT"):
                                guard["orca"]("inserttext", "--worktree", "all", "--page", "owned-page", "--text", "safe test")
                self.assertEqual((root / "input-sent").exists(), allowed)

    def test_keyboard_requires_a_guard_and_explicit_page(self):
        guard = runpy.run_path(str(SOURCE))
        with patch.dict(os.environ, {}, clear=True), patch("subprocess.run") as run:
            with self.assertRaisesRegex(ValueError, "GUI_INPUT"):
                guard["orca"]("keypress", "--key", "Enter")
            run.assert_not_called()
        with tempfile.TemporaryDirectory() as directory:
            with guard["gui_bundle"]("test", "destination", time.time() + 2, lock=Path(directory) / "gui.lock"):
                with patch("subprocess.run") as run:
                    with self.assertRaisesRegex(ValueError, "GUI_INPUT"):
                        guard["orca"]("type", "--input", "safe test")
                    run.assert_not_called()

    def test_acquired_bundle_limits_gui_calls_to_55_seconds(self):
        guard = runpy.run_path(str(SOURCE))
        with tempfile.TemporaryDirectory() as directory, patch("time.time", return_value=100):
            with guard["gui_bundle"]("test", "bounded", 400, lock=Path(directory) / "gui.lock"):
                self.assertLessEqual(float(os.environ["GLING_GUI_DEADLINE"]), 155)


if __name__ == "__main__":
    unittest.main()
