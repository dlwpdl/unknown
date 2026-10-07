export function selected(values: readonly string[], value: string) { return values.length === 0 || values.includes(value); }

export function matches(query: string, ...values: (string | null | undefined)[]) {
  return !query || values.some((value) => value?.toLocaleLowerCase('ko-KR').includes(query));
}

