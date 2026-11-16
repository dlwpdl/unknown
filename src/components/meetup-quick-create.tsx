import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { PopIn } from '@/components/state-card';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { Disclosure } from '@/components/disclosure';
import { InitialAvatar, ListCard, ListRow } from '@/components/list-card';
import { SegmentSwitch } from '@/components/meetup-kind-switch';
import { InfoNote } from '@/components/notice-blocks';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import type { MeetupAccess } from '@/lib/chilling-data';
import type { ChillingKind } from '@/lib/chilling';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { QuickWhen } from '@/lib/meetup-quick';

/** The first thing a new host sees: one card per kind, so a one-time meetup opens on one screen and a regular one in three steps. */
export function MeetupEntryCards({ onChoose }: { onChoose: (kind: ChillingKind) => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const cards: { kind: ChillingKind; title: string; text: string; how: string }[] = [
    { kind: 'once', title: tr('칠링'), text: tr('이번 한 번, 가볍게 만나요.'), how: tr('한 화면으로 열어요') },
    { kind: 'group', title: tr('정기모임'), text: tr('취향이 맞는 사람들과 정기적으로 만나요.'), how: tr('세 단계로 열어요') },
  ];
  return <View style={styles.group}>
    <ThemedText accessibilityRole="header" style={styles.heading}>{tr('어떤 모임이에요?')}</ThemedText>
    {cards.map(card => <Pressable key={card.kind} analyticsId={card.kind === 'once' ? 'meetup.create.entry.once' : 'meetup.create.entry.group'} accessibilityRole="button" accessibilityLabel={`${card.title}, ${card.text}, ${card.how}`}
      onPress={() => { play('selection'); onChoose(card.kind); }} style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
      <ThemedText type="smallBold" style={styles.cardTitle}>{card.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{card.text}</ThemedText>
      <ThemedText type="smallBold" themeColor="accent">{card.how}</ThemedText>
    </Pressable>)}
  </View>;
}

export type QuickFieldsProps = {
  saving: boolean;
  title: string; titleMax: number; onTitle: (value: string) => void; titleError?: string;
  when: QuickWhen; whenChoices: QuickWhen[]; onWhen: (when: QuickWhen) => void; startsAt: string; zone: string; onStart: (iso: string) => void; whenText: string; scheduleError?: string;
  seatControl: ReactNode; seatNote: string; seatError?: string;
  access: MeetupAccess; onAccess: (access: MeetupAccess) => void; question: string; onQuestion: (value: string) => void; intro: string; cityName: string;
  profile: { name: string; consent: boolean; onConsent: () => void; onShow: () => void; onEdit: () => void; error?: string } | null; onProfileSetup: () => void;
  onFull: () => void;
};

/** One-time meetup on one screen: title, when and how many. Everything else is set for the host and shown in one folded line. */
export function MeetupQuickFields(props: QuickFieldsProps) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const { saving, profile } = props;
  const whenLabel: Record<QuickWhen, string> = { tonight: tr('오늘 저녁'), tomorrow: tr('내일 저녁'), weekend: tr('이번 주말'), pick: tr('직접 고르기') };
  const error = (message?: string) => !!message && <ThemedText accessibilityRole="alert" themeColor="danger" style={styles.body}>{tr(message)}</ThemedText>;
  const input = [styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }];
  return <View style={styles.group}>
    <View style={styles.field}>
      <ThemedText type="smallBold" style={styles.label}>{tr('모임 제목')}</ThemedText>
      <TextInput accessibilityLabel={tr('모임 제목')} value={props.title} onChangeText={props.onTitle} editable={!saving} maxLength={props.titleMax} placeholder={tr('예: 퇴근하고 노을 보러 갈래요?')} placeholderTextColor={theme.textSecondary} style={input} />
      {error(props.titleError)}
    </View>
    <View style={styles.field}>
      <ThemedText type="smallBold" style={styles.label}>{tr('언제')}</ThemedText>
      <View accessibilityRole="radiogroup" accessibilityLabel={tr('언제')} style={styles.chips}>{props.whenChoices.map(choice => <SelectionChip key={choice} analyticsId="meetup.create.quick.when" selected={props.when === choice} disabled={saving}
        accessibilityRole="radio" accessibilityState={{ checked: props.when === choice, disabled: saving }} label={whenLabel[choice]} onPress={() => { play('selection'); props.onWhen(choice); }} />)}</View>
      {props.when === 'pick' && <ChillingDateInput label={tr('시작')} value={props.startsAt} zone={props.zone} minimumDate={new Date()} onChange={props.onStart} disabled={saving} />}
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{props.whenText}</ThemedText>
      {error(props.scheduleError)}
    </View>
    <View style={styles.field}>
      <ThemedText type="smallBold" style={styles.label}>{tr('정원 (호스트 포함)')}</ThemedText>
      {props.seatControl}
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{props.seatNote}</ThemedText>
      {error(props.seatError)}
    </View>
    <Disclosure analyticsId="meetup.create.quick.rest" title={tr('나머지는 이렇게 정해 뒀어요')} value={tr('{0} · 신청 질문 1개 · 승인은 내가 해요', props.access === 'invite' ? tr('초대용') : tr('공개'))}>
      <View style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr('누가 신청할 수 있나요?')}</ThemedText>
        <SegmentSwitch analyticsId="meetup.create.access" accessibilityLabel={tr('누가 신청할 수 있나요?')} disabled={saving} value={props.access} onSelect={props.onAccess}
          choices={[{ value: 'public', label: tr('공개') }, { value: 'invite', label: tr('초대용') }]} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{props.access === 'invite' ? tr('초대받았거나 링크가 있는 사람만 신청할 수 있어요. 모임 탭과 피드에 안 나오고, 멤버도 밖에서는 안 보여요.') : tr('모임 탭에 올라가요. 신청하려는 사람도 승인된 멤버의 이름, 한 줄 소개, 관심사를 볼 수 있어요.')}</ThemedText>
      </View>
      <View style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr('신청할 때 물어볼 질문')}</ThemedText>
        <TextInput accessibilityLabel={tr('신청할 때 물어볼 질문')} value={props.question} onChangeText={props.onQuestion} editable={!saving} maxLength={300} placeholderTextColor={theme.textSecondary} style={input} />
        <InfoNote>{tr('공개 범위와 신청 질문은 모임을 연 뒤에는 바꿀 수 없어요.')}</InfoNote>
      </View>
      <View style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr('모임 소개')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{props.intro}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('소개는 제목과 시간으로 만들어 둬요. 연 뒤에 모임 정보 수정에서 바꿀 수 있어요.')}</ThemedText>
      </View>
      <View style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr('신청 승인')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('내가 보고 승인해요. 자동 승인은 모임 도구에서 켜요.')}</ThemedText>
      </View>
      <View style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr('활동 지역')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr(props.cityName)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('정확한 집결 장소는 승인된 멤버에게 모임 대화에서 알려 주세요.')}</ThemedText>
      </View>
    </Disclosure>
    <View style={styles.field}>
      {profile ? <ListCard>
        <ListRow analyticsId="meetup-create.profile-preview" title={profile.name || tr('모임 멤버')} detail={tr('공개할 호스트 소개')} leading={<InitialAvatar name={profile.name || tr('모임 멤버')} />} onPress={profile.onShow} />
        <ListRow analyticsId="meetup-create.profile-edit" title={tr('모임 프로필 수정')} onPress={saving ? undefined : profile.onEdit} />
        <View style={styles.consentBlock}>
          <Pressable analyticsId="meetup-create.host-consent" accessibilityRole="checkbox" accessibilityState={{ checked: profile.consent, disabled: saving }} aria-checked={profile.consent} disabled={saving}
            style={({ pressed }) => [styles.consent, { opacity: saving ? 0.45 : pressed ? 0.82 : 1 }]} onPress={() => { play('selection'); profile.onConsent(); }}>
            <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.checkbox, profile.consent ? { borderColor: theme.accent, backgroundColor: theme.accent } : { borderColor: profile.error ? theme.danger : theme.textSecondary }]}>
              {profile.consent && <PopIn><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={13} tintColor={theme.accentInk} /></PopIn>}
            </View>
            <ThemedText type="smallBold" style={[styles.label, styles.flex]}>{tr('이 모임에서 소개와 선택한 사진을 공개하는 데 동의해요.')}</ThemedText>
          </Pressable>
          {error(profile.error)}
        </View>
      </ListCard> : <RaisedActionButton analyticsId="meetup-create.profile-edit" tone="secondary" disabled={saving} label={tr('내 모임 프로필 확인')} onPress={() => { play('selection'); props.onProfileSetup(); }} />}
    </View>
    <Pressable analyticsId="meetup.create.quick.full" accessibilityRole="button" disabled={saving} onPress={() => { play('selection'); props.onFull(); }} style={({ pressed }) => [styles.link, { opacity: saving ? 0.45 : pressed ? 0.82 : 1 }]}>
      <ThemedText type="smallBold" themeColor="accent">{tr('장소·사진·나이까지 정할래요 ›')}</ThemedText>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: Spacing.three }, field: { gap: Spacing.two }, heading: { ...Typography.section },
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.one, minHeight: 88, justifyContent: 'center' }, cardTitle: { ...Typography.menu },
  label: { ...Typography.menu }, helper: { ...Typography.supporting }, body: { ...Typography.body }, flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 },
  consentBlock: { padding: Spacing.three, gap: Spacing.two }, consent: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  link: { minHeight: 44, justifyContent: 'center' },
});
