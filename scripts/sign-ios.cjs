const fs = require('node:fs');
const project = require('xcode').project(process.argv[2]);
project.parseSync();
let configured = 0;
for (const row of Object.values(project.pbxXCBuildConfigurationSection())) {
  const settings = row.buildSettings;
  if (settings?.PRODUCT_BUNDLE_IDENTIFIER?.replaceAll('"', '') !== 'com.dlwpdl.gling') continue;
  Object.assign(settings, { CODE_SIGN_STYLE: 'Manual', DEVELOPMENT_TEAM: process.env.GLING_TEAM,
    PROVISIONING_PROFILE_SPECIFIER: process.env.GLING_PROFILE_UUID, CODE_SIGN_IDENTITY: '"Apple Distribution"' });
  configured++;
}
if (!configured) throw new Error('The Gling application target was not found; signing stopped.');
fs.writeFileSync(process.argv[2], project.writeSync());
