from pathlib import Path
import os,subprocess
ROOT=Path(__file__).resolve().parents[3]
os.chdir(ROOT)
layout=Path('src/app/_layout.web.tsx');original=layout.read_text();route=Path('src/app/chat-controls-qa.tsx')
assert not route.exists()
try:
 layout.write_text(original.replace("['/terms',", "['/chat-controls-qa', '/terms',"))
 route.write_text(Path('output/qa/chat-controls-2026-10-12/runtime-fixture.tsx').read_text())
 env=os.environ.copy();env.update(GLING_LOCAL_ADMIN='0',GLING_PUBLIC_WEB='0',GLING_MERCHANT_WEB='0',EXPO_PUBLIC_SUPABASE_URL='https://gling-chat-qa.invalid',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='offline-chat-qa-key',EXPO_PUBLIC_GOOGLE_MAPS_API_KEY='offline-chat-qa-map-key')
 with open('/tmp/gling-chat-export.log','w') as log:
  result=subprocess.run(['npx','--no-install','expo','export','--platform','web','--output-dir','output/qa/chat-controls-2026-10-12/app-runtime'],env=env,stdout=log,stderr=subprocess.STDOUT)
 raise SystemExit(result.returncode)
finally:
 layout.write_text(original);route.unlink(missing_ok=True)
