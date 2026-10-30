const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Sources keep explicit ".ts" imports for Node tests; on web, prefer a sibling ".web.ts" the way extensionless imports do.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName.startsWith('.') && /\.tsx?$/.test(moduleName)) {
    const web = path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.(tsx?)$/, '.web.$1'));
    if (fs.existsSync(web)) return { type: 'sourceFile', filePath: web };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
