import { useLanguage } from '@/hooks/use-language';
import { StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { STORY_POLL, type PollDraft } from '@/lib/post-polls';

export function PollDraftFields({ poll, onChange, disabled = false }: { poll: PollDraft | null; onChange: (value: PollDraft | null) => void; disabled?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const field = [styles.field, { color: theme.text, borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  return <View style={styles.wrap}>
    <Pressable analyticsId="compose.poll.toggle" accessibilityRole="checkbox" accessibilityLabel={tr("투표 추가")} accessibilityState={{ checked: !!poll, disabled }} disabled={disabled}
      onPress={() => { play('selection'); onChange(poll ? null : { ...STORY_POLL, options: [...STORY_POLL.options] }); }} style={styles.toggle}>
      <ThemedText>{poll ? '▣' : '□'}  {"  " + tr("투표 추가")}</ThemedText>
    </Pressable>
    {poll && <>
      <TextInput accessibilityLabel={tr("투표 질문")} placeholder={tr("무엇이 궁금한가요?")} placeholderTextColor={theme.textSecondary}
        value={poll.question} maxLength={120} editable={!disabled} onFocus={() => play('selection')} onChangeText={question => onChange({ ...poll, question })} style={field} />
      {poll.options.map((value, index) => <TextInput key={index} accessibilityLabel={tr("투표 보기 {0}", (index + 1))} value={value}
        maxLength={80} editable={!disabled} onFocus={() => play('selection')} onChangeText={label => onChange({ ...poll, options: poll.options.map((old, n) => n === index ? label : old) })} style={field} />)}
      <ThemedText type="small" themeColor="textSecondary">{tr("한 사람이 한 개만 고를 수 있어요. 등록한 보기는 바꿀 수 없어요.")}</ThemedText>
    </>}
  </View>;
}
const styles = StyleSheet.create({ wrap: { gap: 8 }, toggle: { minHeight: 44, justifyContent: 'center' }, field: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 } });
