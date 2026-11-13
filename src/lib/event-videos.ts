import { tr } from '../i18n/index.ts';

// Play only a video URL supplied with this event's Ticketmaster data.
export function eventVideo(event: { videoYoutubeId?: string | null }) {
  return event.videoYoutubeId ? { youtubeId: event.videoYoutubeId, label: tr('행사 관련 영상') } : null;
}

// Ticketmaster's info field often carries the seller's purchase terms instead of an introduction (QA C22-2); those fall back to the ticket-page line.
// shortcut: a short list of English seller phrases, add one when another purchase notice shows up as an introduction.
const SELLER_NOTICE = /thank you for (?:your )?purchas|ticket sales data|by purchasing|all sales (?:are )?final|ticket limits?\b|no refunds/i;
export function eventIntro(description?: string | null) {
  const text = description?.trim();
  return text && !SELLER_NOTICE.test(text) ? text : null;
}
