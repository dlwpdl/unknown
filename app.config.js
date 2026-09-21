module.exports = ({ config }) => {
  const localAdmin = process.env.GLING_LOCAL_ADMIN === '1';
  if (localAdmin && process.env.CI) throw new Error('The local admin must never be built in CI.');
  const publicWeb = process.env.GLING_PUBLIC_WEB === '1';
  return {
    ...config,
    ...(localAdmin || publicWeb ? { plugins: config.plugins.map((plugin) => plugin === 'expo-router'
      ? ['expo-router', { root: localAdmin ? './src/admin' : './src/web' }] : plugin) } : {}),
    experiments: {
      ...config.experiments,
      ...(localAdmin ? { typedRoutes: false, baseUrl: '' }
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
