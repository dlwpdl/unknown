"""Real process checks; all locks and commands stay inside a temporary directory."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("browser_preflight.py")


class BrowserQueueTests(unittest.TestCase):
    def admission_bundle(self, root, policy):
        function = self.bundle()
        scope = function.__wrapped__.__globals__
        scope["LOCK"] = root / "gui.lock"
        scope["ADMISSION"] = root / "triage-actions.json"
        scope["ADMISSION"].write_text(json.dumps({"gui_admission": policy}))
        return function

    def test_official_reservation_blocks_other_terminal_without_gui_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.admission_bundle(root, {"state": "reserved", "owner_terminal": "official"})
            with patch.dict(os.environ, {"ORCA_TERMINAL_HANDLE": "personal"}):
                with self.assertRaises(TimeoutError):
                    with bundle("threads", "personal", time.time() + .12, lock=root / "gui.lock"):
                        self.fail("Personal work entered during official reservation")
            self.assertFalse((root / "gui.lock").exists())

    def test_reserved_owner_still_uses_existing_bounded_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.admission_bundle(root, {"state": "reserved", "owner_terminal": "official"})
            with patch.dict(os.environ, {"ORCA_TERMINAL_HANDLE": "official"}):
                with bundle("meta", "official", time.time() + 2, lock=root / "gui.lock"):
                    self.assertTrue((root / "gui.lock").exists())
                    self.assertLessEqual(float(os.environ["GLING_GUI_DEADLINE"]), time.time() + 55)
            self.assertFalse((root / "gui.lock").exists())

    def test_released_reservation_resumes_waiting_work_with_original_deadline(self):
        import threading
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.admission_bundle(root, {"state": "reserved", "owner_terminal": "official"})
            deadline = time.time() + 2
            def release():
                temporary = root / "released.json"
                temporary.write_text(json.dumps({"gui_admission": {"state": "open"}}))
                temporary.replace(root / "triage-actions.json")
            timer = threading.Timer(.1, release)
            with patch.dict(os.environ, {"ORCA_TERMINAL_HANDLE": "personal"}):
                timer.start()
                try:
                    with bundle("threads", "personal", deadline, lock=root / "gui.lock"):
                        self.assertLessEqual(float(os.environ["GLING_GUI_DEADLINE"]), deadline)
                        policy = json.loads((root / "triage-actions.json").read_text())
                        self.assertEqual(policy["gui_admission"]["state"], "open")
                finally:
                    timer.join()

    def test_unreadable_or_invalid_admission_never_enters_gui(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.admission_bundle(root, {"state": "reserved"})
            for body in ('{', '{"gui_admission": {"state": "reserved"}}'):
                (root / "triage-actions.json").write_text(body)
                with self.assertRaisesRegex(ValueError, "GUI_ADMISSION_UNVERIFIED"):
                    with bundle("meta", "unknown", time.time() + .1, lock=root / "gui.lock"):
                        self.fail("Unverified admission entered GUI")
                self.assertFalse((root / "gui.lock").exists())

    def test_reservation_changed_during_os_acquisition_is_rechecked(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.admission_bundle(root, {"state": "open"})
            original_flock = fcntl.flock
            def claim_guard(guard, operation):
                original_flock(guard, operation)
                if operation == fcntl.LOCK_EX | fcntl.LOCK_NB:
                    policy = {"gui_admission": {"state": "reserved", "owner_terminal": "other"}}
                    (root / "triage-actions.json").write_text(json.dumps(policy))
            with patch.dict(os.environ, {"ORCA_TERMINAL_HANDLE": "official"}), patch("fcntl.flock", side_effect=claim_guard):
                with self.assertRaises(TimeoutError):
                    with bundle("meta", "official", time.time() + .12, lock=root / "gui.lock"):
                        self.fail("Changed reservation was ignored after OS acquisition")
            self.assertFalse((root / "gui.lock").exists())

    def bundle(self):
        function = runpy.run_path(str(SOURCE)).get("gui_bundle")
        self.assertTrue(callable(function), "Missing bounded, process-owned GUI queue")
        return function

    def wait_for(self, path, process):
        deadline = time.monotonic() + 3
        while not path.exists() and time.monotonic() < deadline:
            if process.poll() is not None:
                self.fail(process.communicate()[1])
            time.sleep(0.02)
        self.assertTrue(path.exists(), "Child did not reach the expected stage")

    def test_busy_job_waits_until_owner_finishes(self):
        bundle = self.bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child_code = """
import sys,time
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from browser_preflight import gui_bundle
root=Path(sys.argv[2]); (root/'waiting').touch()
with gui_bundle('repair','second',time.time()+5,lock=root/'gui.lock'):
    (root/'entered').touch()
"""
            with bundle("repair", "first", time.time() + 5, lock=root / "gui.lock"):
                child = subprocess.Popen([sys.executable, "-c", child_code,
                                          str(SOURCE.parent), directory],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.wait_for(root / "waiting", child)
                    time.sleep(0.15)
                    self.assertFalse((root / "entered").exists(), "Two jobs entered the GUI together")
                except BaseException:
                    child.kill(); child.communicate()
                    raise
            stdout, stderr = child.communicate(timeout=5)
            self.assertEqual(child.returncode, 0, stderr)
            self.assertTrue((root / "entered").exists(), "Waiting job was dropped")
            self.assertFalse((root / "gui.lock").exists())

    def test_exception_releases_own_lock(self):
        bundle = self.bundle()
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "gui.lock"
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                with bundle("repair", "failed", time.time() + 2, lock=lock):
                    raise RuntimeError("interrupted")
            self.assertFalse(lock.exists())
            with bundle("repair", "next", time.time() + 2, lock=lock):
                self.assertTrue(lock.exists())

    def test_expired_wait_preserves_unverified_owner(self):
        bundle = self.bundle()
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "gui.lock"
            lock.mkdir()
            owner = b'{"owner_token":"other-worker","pid":1}\n'
            (lock / "owner.json").write_bytes(owner)
            with self.assertRaises(TimeoutError):
                with bundle("repair", "waiting", time.time() + 0.15, lock=lock):
                    self.fail("Busy lock was stolen")
            self.assertEqual((lock / "owner.json").read_bytes(), owner)

    def test_expired_bundle_does_not_start_a_gui_command(self):
        bundle = self.bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli = root / "orca"
            cli.write_text("#!" + sys.executable + "\nfrom pathlib import Path\n"
                           + "Path(" + repr(str(root / "called")) + ").touch()\n"
                           + "print('{\"ok\":true,\"result\":{}}')\n")
            cli.chmod(0o700)
            with patch.dict(os.environ, {"PATH": directory + os.pathsep + os.environ["PATH"]}):
                with bundle("repair", "expired-command", time.time() + 0.12, lock=root / "gui.lock"):
                    time.sleep(0.16)
                    with self.assertRaises(TimeoutError):
                        runpy.run_path(str(SOURCE))["orca"]("snapshot")
            self.assertFalse((root / "called").exists(), "GUI call started after its deadline")

    def test_killed_process_owner_is_archived_before_recovery(self):
        bundle = self.bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = """
import sys,time
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from browser_preflight import gui_bundle
root=Path(sys.argv[2])
with gui_bundle('repair','killed',time.time()+10,lock=root/'gui.lock'):
    (root/'entered').touch()
    sys.stdin.read()
"""
            child = subprocess.Popen([sys.executable, "-c", code, str(SOURCE.parent), directory],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True)
            try:
                self.wait_for(root / "entered", child)
                previous = json.loads((root / "gui.lock/owner.json").read_text())
                child.kill(); child.communicate(timeout=3)
                with bundle("repair", "recovered", time.time() + 2, lock=root / "gui.lock") as current:
                    self.assertNotEqual(current["owner_token"], previous["owner_token"])
                    archived = [json.loads(p.read_text()) for p in root.glob("*.terminated-*/owner.json")]
                    self.assertIn(previous, archived, "Dead owner evidence was discarded")
            finally:
                if child.poll() is None:
                    child.kill(); child.communicate()

    def test_running_ui_child_keeps_guard_after_owner_dies(self):
        bundle = self.bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli = root / "orca"
            cli.write_text("#!" + sys.executable + "\n" + """
import os,time
from pathlib import Path
root=Path(__file__).parent
(root/'ui-running').write_text(str(os.getpid()))
while not (root/'ui-finish').exists(): time.sleep(0.02)
print('{"ok":true,"result":{}}')
""")
            cli.chmod(0o700)
            code = """
import sys,time
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from browser_preflight import gui_bundle,orca
with gui_bundle('repair','parent',time.time()+10,lock=Path(sys.argv[2])/'gui.lock'):
    orca('snapshot')
"""
            environment = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"]}
            child = subprocess.Popen([sys.executable, "-c", code, str(SOURCE.parent), directory],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     env=environment)
            try:
                self.wait_for(root / "ui-running", child)
                child.kill(); child.wait(timeout=3)
                with self.assertRaises(TimeoutError):
                    with bundle("repair", "too-early", time.time() + 0.15, lock=root / "gui.lock"):
                        self.fail("A still-running UI command lost its guard")
                (root / "ui-finish").touch()
                with bundle("repair", "after-ui", time.time() + 2, lock=root / "gui.lock"):
                    self.assertTrue(lock_is_ours := json.loads((root / "gui.lock/owner.json").read_text())["pid"] == os.getpid())
            finally:
                (root / "ui-finish").touch()
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=3)


if __name__ == "__main__":
    unittest.main()
