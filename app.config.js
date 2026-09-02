module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.GLING_WEB_BASE_URL ? { baseUrl: process.env.GLING_WEB_BASE_URL } : {}),
  },
});
