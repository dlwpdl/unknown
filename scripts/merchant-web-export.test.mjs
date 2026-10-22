import test from 'node:test';
import { checkMerchantWeb } from './check-merchant-web.mjs';

const directory = process.env.GLING_MERCHANT_WEB_EXPORT_DIR;
test('merchant export contains own login routes and no private administrator workspace code', { skip: !directory }, () => {
  checkMerchantWeb(directory, process.env.GLING_WEB_BASE_URL ?? '');
});
