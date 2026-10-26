// Meetup intros keep their sections as headed text (AI drafts and templates write them that way, and old apps
// and the web read the plain text). These helpers lift the headings back out so screens can show real sections.
const LABELS = {
  ko: ['모임 목적', '함께할 활동', '이런 분과 맞아요', '준비할 것'],
  en: ['Purpose', 'Activities', 'Who it suits', 'Preparation'],
} as const;

export type MeetupSections = { language: 'ko' | 'en'; intro: string; purpose: string; activities: string[]; fit: string; preparation: string[] };

export function parseMeetupSections(body: string): MeetupSections | null {
  const lines = body.split(/\r?\n/);
  for (const language of ['ko', 'en'] as const) {
    const heads = LABELS[language].map((label, key) => ({ key, at: lines.findIndex(line => line.trim() === label) })).filter(head => head.at >= 0);
    // Two headings in their written order, so a lone "준비할 것" line in free text stays text.
    if (heads.length < 2 || heads.some((head, index) => index > 0 && head.at <= heads[index - 1].at)) continue;
    const block = (key: number) => {
      const index = heads.findIndex(head => head.key === key);
      return index < 0 ? [] : lines.slice(heads[index].at + 1, heads[index + 1]?.at ?? lines.length).map(line => line.trim()).filter(Boolean);
    };
    return {
      language,
      intro: lines.slice(0, heads[0].at).join('\n').trim(),
      purpose: block(0).join('\n'),
      activities: block(1).map(line => line.replace(/^\d+[.)]\s*/, '')),
      fit: block(2).join('\n'),
      preparation: block(3).map(line => line.replace(/^[•·\-]\s*/, '')),
    };
  }
  return null;
}

export function joinMeetupSections(sections: MeetupSections): string {
  const [purpose, activities, fit, preparation] = LABELS[sections.language];
  const steps = sections.activities.map(item => item.trim()).filter(Boolean), items = sections.preparation.map(item => item.trim()).filter(Boolean);
  return [
    sections.intro.trim(),
    sections.purpose.trim() && `${purpose}\n${sections.purpose.trim()}`,
    steps.length && `${activities}\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    sections.fit.trim() && `${fit}\n${sections.fit.trim()}`,
    items.length && `${preparation}\n${items.map(item => `• ${item}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}
