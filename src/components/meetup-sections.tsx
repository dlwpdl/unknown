import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { joinMeetupSections, parseMeetupSections, type MeetupSections } from '@/lib/meetup-sections';

const MAX_ROWS = 8;

// Purpose card → numbered activities → who it suits → preparation checklist; the intro is rendered by the caller.
export function MeetupSectionsView({ sections }: { sections: MeetupSections }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const head = (title: string) => <ThemedText accessibilityRole="header" style={styles.head}>{tr(title)}</ThemedText>;
  return <View style={styles.view}>
    {!!sections.purpose && <View style={[styles.purpose, { backgroundColor: theme.card }]}>
      <SymbolView name={{ ios: 'scope', android: 'flag', web: 'flag' }} size={18} tintColor={theme.accent} />
      <View style={styles.flex}><ThemedText themeColor="textSecondary" style={Typography.label}>{tr('모임 목적')}</ThemedText><ThemedText style={styles.text}>{sections.purpose}</ThemedText></View>
    </View>}
    {sections.activities.length > 0 && <View style={styles.block}>{head('함께할 활동')}
      {sections.activities.map((step, index) => <View key={index} style={styles.row}>
        <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}><ThemedText style={[Typography.label, { color: theme.accent }]}>{index + 1}</ThemedText></View>
        <ThemedText style={[styles.text, styles.flex]}>{step}</ThemedText>
      </View>)}
    </View>}
    {!!sections.fit && <View style={styles.block}>{head('이런 분과 맞아요')}<View style={[styles.box, { backgroundColor: theme.card }]}><ThemedText style={styles.text}>{sections.fit}</ThemedText></View></View>}
    {sections.preparation.length > 0 && <View style={styles.block}>{head('준비할 것')}
      {sections.preparation.map((item, index) => <View key={index} style={[styles.row, styles.box, { backgroundColor: theme.card }]}>
        <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={15} tintColor={theme.accent} />
        <ThemedText style={[styles.text, styles.flex]}>{item}</ThemedText>
      </View>)}
    </View>}
  </View>;
}

// Headed intros get one field per section; plain intros keep the caller's single field (children).
// Rows live in local state so an empty "add" row survives until it's typed into; outside replacements (AI, templates) re-split.
export function MeetupSectionsEditor({ value, onChange, disabled, children, maxLength, heading = true }: { value: string; onChange: (body: string) => void; disabled?: boolean; children: ReactNode; maxLength: number; heading?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [sections, setSections] = useState(() => parseMeetupSections(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!sections || value !== joinMeetupSections(sections)) setSections(parseMeetupSections(value));
  }
  if (!sections) return <>{children}</>;

  const update = (next: MeetupSections) => { const body = joinMeetupSections(next); setSections(next); setSeen(body); onChange(body); };
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }];
  // Every text section wraps; only the intro starts tall.
  const field = (label: string, key: 'intro' | 'purpose' | 'fit', tall = false) => <View style={styles.field}>
    <ThemedText type="smallBold" style={Typography.menu}>{tr(label)}</ThemedText>
    <TextInput accessibilityLabel={tr(label)} value={sections[key]} onChangeText={text => update({ ...sections, [key]: text })} editable={!disabled} multiline maxLength={maxLength}
      placeholderTextColor={theme.textSecondary} style={[...inputStyle, styles.wrap, tall && styles.multiline]} />
  </View>;
  const list = (label: string, key: 'activities' | 'preparation', addLabel: string) => {
    const rows = sections[key].length ? sections[key] : [''];
    const set = (next: string[]) => update({ ...sections, [key]: next });
    return <View style={styles.field}>
      <ThemedText type="smallBold" style={Typography.menu}>{tr(label)}</ThemedText>
      {rows.map((row, index) => <View key={index} style={styles.row}>
        <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>{key === 'activities'
          ? <ThemedText style={[Typography.label, { color: theme.accent }]}>{index + 1}</ThemedText>
          : <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={13} tintColor={theme.accent} />}</View>
        <TextInput accessibilityLabel={`${tr(label)} ${index + 1}`} value={row} onChangeText={text => set(rows.map((item, at) => at === index ? text : item))} editable={!disabled} maxLength={120} style={[...inputStyle, styles.flex]} />
        <Pressable analyticsId={`meetup.sections.${key}.remove`} accessibilityRole="button" accessibilityLabel={tr('{0} {1} 지우기', tr(label), index + 1)} disabled={disabled}
          onPress={() => { play('selection'); set(rows.filter((_, at) => at !== index)); }}
          style={({ pressed }) => [styles.remove, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={15} tintColor={theme.textSecondary} />
        </Pressable>
      </View>)}
      {rows.length < MAX_ROWS && <Pressable analyticsId={`meetup.sections.${key}.add`} accessibilityRole="button" disabled={disabled}
        onPress={() => { play('selection'); setSections({ ...sections, [key]: [...rows, ''] }); }}
        style={({ pressed }) => [styles.add, { opacity: pressed ? 0.6 : 1 }]}>
        <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={15} tintColor={theme.accent} />
        <ThemedText type="smallBold" themeColor="accent">{tr(addLabel)}</ThemedText>
      </Pressable>}
    </View>;
  };
  return <>
    {field('짧은 소개', 'intro', true)}
    {heading && <ThemedText accessibilityRole="header" type="subtitle" style={styles.title}>{tr('모임 내용')}</ThemedText>}
    {field('모임 목적', 'purpose')}
    {list('함께할 활동', 'activities', '활동 추가')}
    {field('이런 분과 맞아요', 'fit')}
    {list('준비할 것', 'preparation', '준비물 추가')}
  </>;
}

const styles = StyleSheet.create({
  view: { gap: Spacing.three, marginTop: Spacing.two },
  block: { gap: Spacing.two },
  head: Typography.section,
  flex: { flex: 1 },
  text: { fontSize: 16, lineHeight: 24 },
  purpose: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 16, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  box: { borderRadius: 12, padding: 12 },
  title: { marginTop: Spacing.three },
  field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 },
  wrap: { textAlignVertical: 'top' },
  multiline: { minHeight: 96 },
  remove: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
});
