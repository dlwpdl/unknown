import { ticketmasterReference } from '../../supabase/functions/_shared/ticketmaster.ts';

export function splitEventMeetupBody(body: string) {
  const legacyDetailsAt = body.indexOf('\n\n장소:');
  const detailsAt = legacyDetailsAt >= 0 ? legacyDetailsAt : body.indexOf('\n\n행사 ID:');
  return detailsAt < 0
    ? { intro: body, details: '' }
    : { intro: body.slice(0, detailsAt), details: body.slice(detailsAt) };
}

export function visibleMeetupBody(body: string) {
  return ticketmasterReference(body) ? splitEventMeetupBody(body).intro : body;
}
