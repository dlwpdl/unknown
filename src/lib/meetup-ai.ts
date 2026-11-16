import { ticketmasterReference } from '../../supabase/functions/_shared/ticketmaster.ts';
import { splitPlaceMeetupBody } from './meetup-destination.ts';
import { splitMeetupInfoCells } from './meetup-info-cells.ts';

export function splitEventMeetupBody(body: string) {
  const legacyDetailsAt = body.indexOf('\n\n장소:');
  const detailsAt = legacyDetailsAt >= 0 ? legacyDetailsAt : body.indexOf('\n\n행사 ID:');
  return detailsAt < 0
    ? { intro: body, details: '' }
    : { intro: body.slice(0, detailsAt), details: body.slice(detailsAt) };
}

const meetupIntro = (body: string) => ticketmasterReference(body) ? splitEventMeetupBody(body).intro : splitPlaceMeetupBody(body)?.intro ?? body;

// keepInfoCells is for the inline text editor, which saves the intro back as written.
export function visibleMeetupBody(body: string, keepInfoCells = false) {
  return keepInfoCells ? meetupIntro(body) : splitMeetupInfoCells(meetupIntro(body)).body;
}

export const meetupInfoCells = (body: string) => splitMeetupInfoCells(meetupIntro(body)).cells;
