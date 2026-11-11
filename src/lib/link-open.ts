import { DeviceEventEmitter } from 'react-native';

// An outside link or a tapped push is about to change the screen. Sheets close first so the new screen
// does not open hidden behind them (QA Q08). Sent from the two places links arrive, heard by the sheets.
const LINK_OPEN_EVENT = 'gling.link.open';

export const announceLinkOpen = () => DeviceEventEmitter.emit(LINK_OPEN_EVENT);

export function onLinkOpen(close: () => void) {
  const subscription = DeviceEventEmitter.addListener(LINK_OPEN_EVENT, close);
  return () => subscription.remove();
}
