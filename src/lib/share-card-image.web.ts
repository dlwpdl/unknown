import type { ShareCardImageModules } from './share-card.ts';

/** The web shares the card's text and map link; view-shot's web capture needs html2canvas-pro, which the app does not ship. */
export function shareCardImageModules(): ShareCardImageModules | null {
  return null;
}
