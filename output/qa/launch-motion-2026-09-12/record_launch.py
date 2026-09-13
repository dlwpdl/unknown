"""Record a cold launch on the existing QA device without changing app data."""
import datetime
import json
from pathlib import Path
import signal
import subprocess
import sys
import time

DEVICE = '583E7BFD-5CB4-42EC-B15C-1D4D5986FA39'
BUNDLE = 'com.dlwpdl.gling'
folder = Path(__file__).resolve().parent
name = sys.argv[1]
assert name in ['light', 'dark', 'reduced', 'deep-link']
subprocess.run(['xcrun', 'simctl', 'terminate', DEVICE, BUNDLE], capture_output=True)
log = folder / f'{name}-recording.log'
with log.open('w') as stream:
    recorder = subprocess.Popen(['xcrun', 'simctl', 'io', DEVICE, 'recordVideo', '--codec=h264', '--force', str(folder / f'{name}.mp4')], stderr=stream, stdout=stream)
    try:
        for _ in range(100):
            if 'Recording started' in log.read_text():
                break
            if recorder.poll() is not None:
                raise RuntimeError(log.read_text())
            time.sleep(.05)
        else:
            raise TimeoutError('Simulator recorder did not start')
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        command = ['xcrun', 'simctl', 'openurl', DEVICE, 'gling://profile/notifications'] if name == 'deep-link' else ['xcrun', 'simctl', 'launch', DEVICE, BUNDLE]
        launch = subprocess.run(command, text=True, capture_output=True, check=True)
        time.sleep(5)
    finally:
        recorder.send_signal(signal.SIGINT)
        recorder.wait(timeout=15)
(folder / f'{name}-launch.json').write_text(json.dumps({'launchAt': stamp, 'device': DEVICE, 'command': command, 'result': launch.stdout.strip()}, indent=2))
print(folder / f'{name}.mp4')
