module.exports = ({ config }) => {
  const localAdmin = process.env.GLING_LOCAL_ADMIN === '1';
  if (localAdmin && process.env.CI) throw new Error('The local admin must never be built in CI.');
  const publicWeb = process.env.GLING_PUBLIC_WEB === '1';
  const merchantWeb = process.env.GLING_MERCHANT_WEB === '1';
  if ([localAdmin, publicWeb, merchantWeb].filter(Boolean).length > 1) throw new Error('Only one web workspace can be built at a time.');
  return {
    ...config,
    ...(localAdmin || publicWeb || merchantWeb ? { plugins: config.plugins.map((plugin) => plugin === 'expo-router'
      ? ['expo-router', { root: localAdmin ? './src/admin' : merchantWeb ? './src/merchant-web' : './src/web' }] : plugin) } : {}),
    experiments: {
      ...config.experiments,
      ...(localAdmin ? { typedRoutes: false, baseUrl: '' }
        : merchantWeb ? { typedRoutes: false, baseUrl: process.env.GLING_WEB_BASE_URL ?? '' }
        : process.env.GLING_WEB_BASE_URL ? { baseUrl: process.env.GLING_WEB_BASE_URL } : {}),
    },
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? {
      extra: { ...config.extra, eas: { ...config.extra?.eas, projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } },
    } : {}),
    android: {
      ...config.android,
      ...(process.env.GLING_GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GLING_GOOGLE_SERVICES_FILE } : {}),
    },
  };
};
