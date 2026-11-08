// app.json이 기준 설정이다. WALF_FREE_SIGNING=1 일 때만 무료 Apple ID(개인 팀) 설치용으로 바꾼다.
// 개인 팀은 푸시(aps-environment)를 쓸 수 없고, 번들 ID도 TestFlight용(app.walf.beta)과 겹치지 않게 따로 쓴다.
module.exports = ({ config }) => {
  if (process.env.WALF_FREE_SIGNING !== '1') return { ...config, extra: { ...config.extra, walfRemotePush: true } };
  const plugins = config.plugins.map(p =>
    (Array.isArray(p) ? p[0] : p) === 'expo-notifications'
      ? ['expo-notifications', { ...(Array.isArray(p) ? p[1] : {}), enableRemoteNotifications: false }]
      : p);
  return {
    ...config,
    name: 'WALF (테스트)',
    ios: {
      ...config.ios,
      bundleIdentifier: process.env.WALF_IOS_BUNDLE_ID || 'app.walf.local',
      ...(process.env.WALF_APPLE_TEAM_ID ? { appleTeamId: process.env.WALF_APPLE_TEAM_ID } : {}),
    },
    plugins,
    extra: { ...config.extra, walfRemotePush: false },
  };
};
