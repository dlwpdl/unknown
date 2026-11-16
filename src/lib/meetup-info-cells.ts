// The three info cells a meetup can carry (수준·준비물·1인 비용 …) live at the end of the intro as headed text,
// like the intro sections: older apps and the web read them as plain lines, screens lift them back out.
export type MeetupInfoCell = { label: string; value: string };

const HEAD = '모임 정보', LINE = /^([^:\n]{1,20}): ([^\n]{1,80})$/, MAX_CELLS = 6;

/** The text appended to an intro; empty cells drop out, and no cell means no block. */
export function infoCellsTail(cells: readonly MeetupInfoCell[]): string {
  const lines = cells.map(cell => ({ label: cell.label.trim().replace(/[:\n]/g, ' '), value: cell.value.trim().replace(/\s*\n\s*/g, ' ') }))
    .filter(cell => cell.label && cell.value).map(cell => `${cell.label.slice(0, 20)}: ${cell.value.slice(0, 80)}`);
  return lines.length ? `\n\n${HEAD}\n${lines.slice(0, MAX_CELLS).join('\n')}` : '';
}

/** Lifts the cells block (up to the next blank line) off an intro and keeps what follows it, e.g. a decided place line; anything that is not exactly that block stays text. */
export function splitMeetupInfoCells(intro: string): { body: string; cells: MeetupInfoCell[] } {
  const at = intro.lastIndexOf(`\n\n${HEAD}\n`);
  if (at < 0) return { body: intro, cells: [] };
  const start = at + HEAD.length + 3, next = intro.indexOf('\n\n', start), end = next < 0 ? intro.length : next;
  const lines = intro.slice(start, end).split('\n').map(line => line.replace(/\r$/, ''));
  const cells = lines.map(line => LINE.exec(line));
  if (!lines.length || lines.length > MAX_CELLS || cells.some(match => !match)) return { body: intro, cells: [] };
  return { body: intro.slice(0, at) + intro.slice(end), cells: cells.map(match => ({ label: match![1], value: match![2] })) };
}
