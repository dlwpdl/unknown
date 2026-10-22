"""Read-only Orca routing/input check. Caller must own the shared GUI lock."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import math
import os
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

WORKSPACE = "folder:e88d505b-f6bb-47d6-ba41-904ef2a72a8b"
BRAND_PROFILE = "08a4dd8b-db5a-4255-b587-9da0b94df934"
LOCK = Path("/Users/ash/Library/Application Support/gling/operations/threads-replies/browser-pane.lock")
ADMISSION = LOCK.parent.parent / "automation-manager/pending-triage-20261008T214638Z/triage-actions.json"
TARGETS = {
    "threads": ("default", {"www.threads.com", "threads.com"}),
    "instagram": (BRAND_PROFILE, {"www.instagram.com", "instagram.com"}),
    "meta": (BRAND_PROFILE, {"business.facebook.com"}),
}


def _gui_admitted(lock):
    if lock != LOCK:
        return True
    try:
        policy = json.loads(ADMISSION.read_text()).get("gui_admission", {"state": "open"})
        if policy["state"] == "open":
            return True
        if policy["state"] != "reserved" or not isinstance(policy.get("owner_terminal"), str) or not policy["owner_terminal"]:
            raise ValueError("Invalid GUI reservation")
        return os.environ.get("ORCA_TERMINAL_HANDLE") == policy["owner_terminal"]
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise ValueError("GUI_ADMISSION_UNVERIFIED") from error


@contextmanager
def gui_bundle(role, run_id, deadline, *, lock=LOCK):
    """Wait for one bounded GUI tool call; never hold this across model turns."""
    deadline = float(deadline)
    if not math.isfinite(deadline):
        raise ValueError("A finite UTC deadline is required")
    deadline = min(deadline, time.time() + 300)
    guard_path = Path(str(lock) + ".guard")
    owner = None
    previous_fd = os.environ.get("GLING_GUI_GUARD_FD")
    previous_deadline = os.environ.get("GLING_GUI_DEADLINE")
    with guard_path.open("a+") as guard:
        os.chmod(guard_path, 0o600)
        waiting = False
        try:
            while owner is None:
                if time.time() >= deadline:
                    raise TimeoutError("GUI_QUEUE_TIMEOUT")
                acquired = False
                admitted = _gui_admitted(lock)
                try:
                    if admitted:
                        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        # Recheck after waiting: the coordinator may have changed admission.
                        acquired = _gui_admitted(lock)
                        if not acquired:
                            fcntl.flock(guard, fcntl.LOCK_UN)
                except BlockingIOError:
                    pass
                if acquired:
                    if lock.exists():
                        # OS ownership must be free AND the recorded process dead.
                        # Old mkdir-only locks never qualify for automatic recovery.
                        try:
                            old = json.loads((lock / "owner.json").read_text())
                            recoverable = (old.get("lock_protocol") == "process-bundle-v1"
                                           and old.get("guard_path") == str(guard_path.resolve())
                                           and isinstance(old.get("pid"), int) and old["pid"] > 0)
                            if recoverable:
                                try:
                                    os.kill(old["pid"], 0)
                                    recoverable = False
                                except ProcessLookupError:
                                    pass
                                except PermissionError:
                                    recoverable = False
                        except (OSError, ValueError, TypeError):
                            recoverable = False
                        if recoverable:
                            archived = lock.with_name(lock.name + ".terminated-" + uuid.uuid4().hex)
                            lock.rename(archived)
                            print(json.dumps({"status": "GUI_RECOVERED_TERMINATED_OWNER",
                                              "archive": str(archived)}), flush=True)
                    try:
                        lock.mkdir(mode=0o700)
                    except FileExistsError:
                        fcntl.flock(guard, fcntl.LOCK_UN)
                    else:
                        owner = {"run_id": run_id, "role": role, "owner_token": uuid.uuid4().hex,
                                 "terminal": os.environ.get("ORCA_TERMINAL_HANDLE"),
                                 "pid": os.getpid(), "started_at": time.time(),
                                 "lock_protocol": "process-bundle-v1",
                                 "guard_path": str(guard_path.resolve())}
                        (lock / "owner.json").write_text(json.dumps(owner) + "\n")
                        (lock / "owner.json").chmod(0o600)
                        os.environ["GLING_GUI_GUARD_FD"] = str(guard.fileno())
                        os.environ["GLING_GUI_DEADLINE"] = str(min(deadline, time.time() + 55))
                        if waiting:
                            print(json.dumps({"status": "GUI_QUEUE_RESUMED", "role": role}), flush=True)
                        break
                if not waiting:
                    print(json.dumps({"status": "GUI_QUEUED" if admitted else "GUI_PRIORITY_QUEUED", "role": role,
                                      "deadline": deadline}), flush=True)
                    waiting = True
                time.sleep(min(0.2, max(0, deadline - time.time())))
            yield owner
        finally:
            try:
                if owner is not None:
                    current = json.loads((lock / "owner.json").read_text())
                    if current.get("owner_token") == owner["owner_token"]:
                        (lock / "owner.json").unlink()
                        lock.rmdir()
            finally:
                if previous_fd is None:
                    os.environ.pop("GLING_GUI_GUARD_FD", None)
                else:
                    os.environ["GLING_GUI_GUARD_FD"] = previous_fd
                if previous_deadline is None:
                    os.environ.pop("GLING_GUI_DEADLINE", None)
                else:
                    os.environ["GLING_GUI_DEADLINE"] = previous_deadline
                # Closing also releases flock on process death; do not unlink its file.
                fcntl.flock(guard, fcntl.LOCK_UN)


PROBE = """(() => ({
  url: location.href,
  dialogOpen: [...document.querySelectorAll('[role="dialog"]')]
    .some(e => e.getClientRects().length > 0),
  editables: [...document.querySelectorAll('input,textarea,[contenteditable="true"]')]
    .filter(e => e.getClientRects().length > 0 && !e.disabled && !e.readOnly
      && !['button','submit','reset','checkbox','radio','file','hidden','range','color'].includes(e.type))
    .map(e => ({
      isSearch: e.type === 'search' || e.getAttribute('role') === 'searchbox'
        || Boolean(e.closest('[role="search"]')),
      nonEmpty: Boolean((e.value || e.innerText || '').trim())
    }))
}))()"""


def checked_tab(tabs, page_id, role):
    matches = [t for t in tabs if t.get("browserPageId") == page_id]
    if len(matches) != 1:
        raise ValueError("MISSING_OR_AMBIGUOUS_TARGET")
    tab = matches[0]
    profile, hosts = TARGETS[role]
    url = urlsplit(tab.get("url", ""))
    if (tab.get("worktreeId") != WORKSPACE or tab.get("profileId") != profile
            or url.scheme != "https" or url.hostname not in hosts
            or url.username or url.password or url.port not in (None, 443)):
        raise ValueError("WRONG_WORKSPACE_PROFILE_OR_HOST")
    # active=False describes visibility, not ownership or read access.
    return tab


def blocked_input(probe):
    return bool(probe.get("dialogOpen", True)) or any(
        item.get("nonEmpty", True) and not item.get("isSearch", False)
        for item in probe.get("editables", [{}])
    )


def orca(*args):
    fd = os.environ.get("GLING_GUI_GUARD_FD")
    deadline = os.environ.get("GLING_GUI_DEADLINE")
    if args and args[0] in {"type", "inserttext", "keypress"}:
        if not fd or "--worktree" not in args or "--page" not in args:
            raise ValueError("GUI_INPUT_REQUIRES_GUARD_AND_PAGE")
        scope = ("--worktree", args[args.index("--worktree") + 1],
                 "--page", args[args.index("--page") + 1])
        focused = orca("eval", *scope, "--expression",
                       "JSON.stringify({hasFocus: document.hasFocus()})")
        if json.loads(focused.get("result", "{}")).get("hasFocus") is not True:
            raise ValueError("GUI_INPUT_PAGE_NOT_FOCUSED")
        # DOM focus can point at the editor while native input goes to a terminal.
        state = orca("computer", "get-app-state", "--worktree", "all",
                     "--app", "com.stablyai.orca", "--no-screenshot")["snapshot"]
        receiver = next((line.strip() for line in state["treeText"].splitlines()
                         if line.strip().startswith(str(state.get("focusedElementId")) + " ")), "")
        if not receiver or "Terminal input" in receiver:
            raise ValueError("GUI_INPUT_WRONG_RECEIVER")
    timeout = min(20, float(deadline) - time.time()) if deadline else 20
    if timeout <= 0:
        raise TimeoutError("GUI_BUNDLE_DEADLINE")
    call = subprocess.run(["orca", *args, "--json"], capture_output=True,
                          text=True, timeout=timeout, pass_fds=(int(fd),) if fd else ())
    data = json.loads(call.stdout)
    if call.returncode or not data.get("ok"):
        raise ValueError("ORCA_" + str(data.get("error", {}).get("code", "FAILED")))
    return data["result"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=TARGETS)
    parser.add_argument("--page", required=True)
    parser.add_argument("--owner-token", required=True)
    args = parser.parse_args()
    try:
        owner = json.loads((LOCK / "owner.json").read_text())
        if not args.owner_token or owner.get("owner_token") != args.owner_token:
            raise ValueError("GUI_LOCK_NOT_OWNED")
        tabs = orca("tab", "list", "--worktree", "all")["tabs"]
        tab = checked_tab(tabs, args.page, args.role)
        result = orca("eval", "--worktree", "all", "--page", args.page,
                      "--expression", PROBE)
        probe = result["result"]
        if isinstance(probe, str):
            probe = json.loads(probe)
        if probe.get("url") != tab["url"]:
            raise ValueError("PAGE_CHANGED_DURING_CHECK")
        latest = checked_tab(orca("tab", "list", "--worktree", "all")["tabs"], args.page, args.role)
        if latest["url"] != probe["url"]:
            raise ValueError("PAGE_CHANGED_DURING_CHECK")
        blocked = blocked_input(probe)
        print(json.dumps({"status": "SKIPPED_USER_DRAFT" if blocked else "READY_READ_ONLY",
                          "role": args.role, "page_id": args.page,
                          "workspace": tab["worktreeId"], "profile": tab["profileId"],
                          "active": tab.get("active"), "user_work_present": blocked,
                          "search_inputs": sum(e.get("isSearch", False) for e in probe["editables"]),
                          "performs_writes": False}))
        return 2 if blocked else 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else type(error).__name__
        print(json.dumps({"status": "BLOCKED_PREFLIGHT", "reason": reason,
                          "performs_writes": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
