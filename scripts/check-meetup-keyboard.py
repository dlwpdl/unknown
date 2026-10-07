"""Check an Orca iOS AX capture with keyboardTop measured from the same native Keyboard event."""
import json
import sys
from pathlib import Path


def flatten(nodes):
    for node in nodes:
        yield node
        yield from flatten(node.get('children', []))


capture = json.loads(Path(sys.argv[1]).read_text())
nodes = list(flatten(capture['result'] if isinstance(capture, dict) else capture))
field = next(n for n in nodes if n.get('label', '').startswith(sys.argv[2]) and n.get('type') in ['TextArea', 'TextField'])
button = next(n for n in nodes if n.get('label') == sys.argv[3] and n.get('type') == 'Button')
title = next(n for n in nodes if n.get('type') == 'Heading')
keyboard_top = json.loads(Path(sys.argv[4]).read_text())['keyboardTop']
assert isinstance(keyboard_top, (int, float)) and 0 < keyboard_top < 1, 'Capture with the software keyboard open.'
top = field['frame']['y']
bottom = top + field['frame']['height']
assert button['frame']['y'] + button['frame']['height'] <= keyboard_top, 'Primary action is hidden behind the keyboard.'
assert top >= title['frame']['y'] + title['frame']['height'], 'Input is hidden behind the header.'
assert bottom <= button['frame']['y'], f'Input is hidden behind the footer: {bottom:.3f} > {button["frame"]["y"]:.3f}'
print('PASS: input and primary action are visible above the keyboard.')
