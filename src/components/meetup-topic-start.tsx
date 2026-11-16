import { StyleSheet, View } from 'react-native';

import { InfoNote } from '@/components/notice-blocks';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { MEETUP_TOPICS, type MeetupTopic } from '@/lib/meetup-topics';

/** Topic chips for the start template. `ask` is the topic waiting for the host to say whether their own text may be replaced. */
export function MeetupTopicStart({ topic, ask, onPick, onReplace, onKeep, disabled = false }: {
  topic: MeetupTopic | null; ask: MeetupTopic | null; onPick: (topic: MeetupTopic) => void; onReplace: () => void; onKeep: () => void; disabled?: boolean;
}) {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  return <View style={styles.field}>
    <ThemedText type="smallBold" style={styles.label}>{tr('주제')}</ThemedText>
    <View accessibilityRole="radiogroup" accessibilityLabel={tr('주제')} style={styles.chips}>{MEETUP_TOPICS.map(item => {
      const selected = (ask ?? topic)?.id === item.id;
      return <SelectionChip key={item.id} analyticsId="meetup.create.topic_start" selected={selected} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }}
        label={tr(item.label)} onPress={() => { play('selection'); onPick(item); }} />;
    })}</View>
    <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('주제를 고르면 제목과 소개 예시를 넣어 드려요. 안 골라도 돼요.')}</ThemedText>
    {!!ask && <View style={styles.field} accessibilityLiveRegion="polite">
      <InfoNote>{tr('이미 적은 글이 있어요. ‘{0}’ 예시로 바꿀까요?', tr(ask.label))}</InfoNote>
      <View style={styles.chips}>
        <RaisedActionButton compact analyticsId="meetup.create.topic_start.replace" disabled={disabled} label={tr('예시로 바꾸기')} onPress={() => { play('selection'); onReplace(); }} />
        <RaisedActionButton compact tone="secondary" analyticsId="meetup.create.topic_start.keep" disabled={disabled} label={tr('내 글 그대로')} onPress={() => { play('selection'); onKeep(); }} />
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two }, label: { ...Typography.menu }, helper: { ...Typography.supporting }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
