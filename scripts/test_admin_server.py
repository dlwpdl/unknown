import importlib.util
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('admin_server', Path(__file__).with_name('serve-admin.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
handler = module.AdminHandler.__new__(module.AdminHandler)
with tempfile.TemporaryDirectory() as folder:
    handler.directory = folder
    target = Path(folder) / 'auth/callback.html'
    target.parent.mkdir()
    target.write_text('callback')
    assert handler.translate_path('/auth/callback?code=test') == str(target)
    assert handler.translate_path('/missing') == str(Path(folder) / 'missing')
    assert handler.translate_path('/../../auth/callback') == str(target)
print('Clean callback routing and path containment passed')
