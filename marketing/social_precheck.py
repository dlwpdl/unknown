"""Existing three native jobs: bounded API checks; AI only at drafting checkpoints."""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def check(role, now=None):
    now = (now or datetime.now(ZoneInfo('America/Vancouver'))).astimezone(ZoneInfo('America/Vancouver'))
    if role == 'city':
        queue = Path.home() / 'Library/Application Support/gling/city-posts/payload' / (str(now.date()) + '.json')
        return {'status': 'existing_city_queue_preserved' if queue.exists() else 'city_preparation',
                'ai_preparation_continue': 2 <= now.hour < 8 and not queue.exists(),
                'ai_publish_or_retry_allowed': False}
    platform = 'instagram' if role == 'instagram' else 'threads'
    account = 'chalkakandupload' if role == 'personal' else 'gling.app'
    minute = {'instagram': 20, 'brand': 5, 'personal': 10}[role]
    preparation = now.minute == minute and (2 <= now.hour < 8 or role == 'personal' and now.hour in (10, 14, 18, 22))
    out = Path.home() / 'Library/Application Support/gling/operations/meta-api' / (role + '-due-latest.json')
    started = time.monotonic()
    try:
        run = subprocess.run([sys.executable, str(Path(__file__).with_name('meta_api.py')),
            'due', platform, '--account', account, '--out', str(out)],
            capture_output=True, text=True, timeout=45)
        result = json.loads(run.stdout)
        state = result.get('status', 'public_readback_saved' if result.get('public_id') else 'unobserved')
    except (subprocess.TimeoutExpired, OSError, ValueError):
        state = 'bounded_api_step_blocked'
    result = {'status': state, 'result': str(out), 'role': role,
              'ai_preparation_continue': preparation, 'ai_publish_or_retry_allowed': False}
    if role == 'instagram':
        remaining = 50 - (time.monotonic() - started)
        result['youtube'] = {'status': 'youtube_waits_for_next_original_tick'}
        if remaining >= 8:
            budget = min(30, remaining)
            try:
                run = subprocess.run([sys.executable, str(Path(__file__).with_name('youtube_api.py')),
                    'due', '--budget-seconds', str(budget - 1)],
                    capture_output=True, text=True, timeout=budget)
                youtube = json.loads(run.stdout)
                if not isinstance(youtube, dict):
                    raise ValueError('invalid_youtube_result')
                result['youtube'] = youtube
            except (subprocess.TimeoutExpired, OSError, ValueError):
                result['youtube'] = {'status': 'bounded_youtube_step_blocked'}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=['instagram', 'brand', 'personal', 'city'])
    result = check(parser.parse_args().role)
    print(json.dumps(result))
    sys.exit(0 if result['ai_preparation_continue'] else 3)
