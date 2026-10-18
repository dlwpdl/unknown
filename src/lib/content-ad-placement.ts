// Keep ads between complete organic cards, including across appended pages.
export function contentAdPosition(index: number, total: number): boolean {
  return Number.isSafeInteger(index) && Number.isSafeInteger(total) && index >= 3 && index < total - 1 && (index + 1) % 4 === 0;
}
