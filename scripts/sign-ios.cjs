const fs = require('node:fs');
const project = require('xcode').project(process.argv[2]);
project.parseSync();
const profiles = {
  'com.dlwpdl.gling': process.env.GLING_PROFILE_UUID,
  'com.dlwpdl.gling.share-extension': process.env.GLING_SHARE_PROFILE_UUID,
};
const configured = new Set();
for (const row of Object.values(project.pbxXCBuildConfigurationSection())) {
  const settings = row.buildSettings;
  const bundle = settings?.PRODUCT_BUNDLE_IDENTIFIER?.replaceAll('"', '');
  if (!profiles[bundle]) continue;
  Object.assign(settings, { CODE_SIGN_STYLE: 'Manual', DEVELOPMENT_TEAM: process.env.GLING_TEAM,
    PROVISIONING_PROFILE_SPECIFIER: profiles[bundle], CODE_SIGN_IDENTITY: '"Apple Distribution"' });
  configured.add(bundle);
}
if (configured.size !== Object.keys(profiles).length) throw new Error('A Gling signing target was not found; signing stopped.');
fs.writeFileSync(process.argv[2], project.writeSync());
