import { readFileSync, mkdirSync, writeFileSync, renameSync, lstatSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { merchantReportHtml } from '../src/lib/admin-merchants.ts';

let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 8_000_000) throw new Error('REPORT_TOO_LARGE'); }
const report = JSON.parse(input);
if (!/^[0-9a-f-]{36}$/i.test(report.id)) throw new Error('INVALID_REPORT_ID');
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = join(root, 'output/merchant-reports');
mkdirSync(dir, { recursive: true });
if (lstatSync(dir).isSymbolicLink()) throw new Error('REPORT_DIRECTORY_UNSAFE');
const path = join(dir, `${report.id}.html`);
if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('REPORT_PATH_UNSAFE');
const logo = `data:image/png;base64,${readFileSync(join(root, 'assets/brand/gling-night-wordmark.png')).toString('base64')}`;
const temporary = join(dir, `.${randomUUID()}.tmp`);
writeFileSync(temporary, merchantReportHtml(report, logo), { mode: 0o600, flag: 'wx' });
renameSync(temporary, path);
process.stdout.write(JSON.stringify({ path, format: 'html', pdf: '브라우저에서 열고 PDF로 저장·인쇄', metrics_as_of: report.generated_at }));
