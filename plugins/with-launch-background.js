const { withMod, withAndroidStyles } = require('expo/config-plugins');

// Register before expo-splash-screen. SDK 57 skips the storyboard color when
// image is omitted, leaving the template's white/black system background.
module.exports = config => withAndroidStyles(withMod(config, {
  platform: 'ios',
  mod: 'splashScreenStoryboard',
  action: config => {
    const doc = config.modResults.document;
    const view = doc.scenes[0].scene[0].objects[0].viewController[0].view[0];
    view.color = [{ $: { key: 'backgroundColor', name: 'SplashScreenBackground' } }];
    view.constraints = [{ constraint: [] }];
    doc.resources[0].image = [];
    doc.resources[0].namedColor = [{
      $: { name: 'SplashScreenBackground' },
      color: [{ $: { red: 250 / 255, green: 249 / 255, blue: 245 / 255, alpha: 1, colorSpace: 'custom', customColorSpace: 'sRGB' } }],
    }];
    return config;
  },
}), config => {
  // SDK 57 references splashscreen_logo even when no image is generated.
  const splash = config.modResults.resources.style.find(style => style.$.name === 'Theme.App.SplashScreen');
  splash.item.find(item => item.$.name === 'windowSplashScreenAnimatedIcon')._ = '@android:color/transparent';
  return config;
});
