import { Pressable } from '@/components/analytics-controls';
import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ageOnDate, PERSONAL_INFO_NOTICE, validatePersonalInfo } from '@/lib/personal-info';

export type PersonalInfoDraft = { fullName: string; dateOfBirth: string; accepted: boolean };

export function PersonalInfoFields({ value, onChange, disabled = false, showConsent = true }: {
  value: PersonalInfoDraft; onChange: (value: PersonalInfoDraft) => void; disabled?: boolean; showConsent?: boolean;
}) {
  const theme = useTheme();
  const [touched, setTouched] = useState(false);
  const error = validatePersonalInfo(value.fullName, value.dateOfBirth);
  const age = !error && value.dateOfBirth ? ageOnDate(value.dateOfBirth) : null;
  const toggleConsent = () => { if (!disabled) onChange({ ...value, accepted: !value.accepted }); };
  return <View style={styles.section}>
    <ThemedText type="smallBold" accessibilityRole="header" aria-level={2}>비공개 계정 정보 · 선택</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">생년월일은 모임의 권장 연령대 안내에 사용해요. 이름은 비공개 계정 확인용이에요. 입력하지 않아도 가입하거나 모임에 신청할 수 있어요.</ThemedText>
    <View style={styles.field}>
      <ThemedText type="smallBold">이름</ThemedText>
      <TextInput value={value.fullName} onChangeText={(fullName) => onChange({ ...value, fullName })} onBlur={() => setTouched(true)}
        editable={!disabled} accessibilityLabel="비공개 이름" placeholder="이름 입력" placeholderTextColor={theme.textSecondary}
        autoComplete="off" autoCorrect={false} maxLength={200}
        style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
    </View>
    <View style={styles.field}>
      <ThemedText type="smallBold">생년월일</ThemedText>
      <TextInput value={value.dateOfBirth} onChangeText={(dateOfBirth) => onChange({ ...value, dateOfBirth })} onBlur={() => setTouched(true)}
        editable={!disabled} accessibilityLabel="비공개 생년월일, 연도 네 자리-월 두 자리-일 두 자리" placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary}
        keyboardType="numbers-and-punctuation" autoComplete="off" autoCorrect={false} autoCapitalize="none" maxLength={10}
        style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
      {age != null && <ThemedText type="small" themeColor="textSecondary">만 {age}세 · 본인 입력 · 생년월일 미인증</ThemedText>}
    </View>
    {touched && error && <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.accent }}>{error}</ThemedText>}
    {showConsent && <>
    <ThemedText type="small" themeColor="textSecondary">{PERSONAL_INFO_NOTICE}</ThemedText>
    <Pressable analyticsId="components_personal-info-fields.pressable.1" disabled={disabled} onPress={toggleConsent} accessibilityRole="checkbox" aria-checked={value.accepted} accessibilityState={{ checked: value.accepted, disabled }}
      {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault: () => void }) => { if (event.key === ' ') { event.preventDefault(); toggleConsent(); } } } : {})}
      style={({ pressed }) => [styles.consent, { borderColor: value.accepted ? theme.accent : theme.line, backgroundColor: theme.card, opacity: disabled ? 0.55 : pressed ? 0.7 : 1 }]}>
      <View aria-hidden accessibilityElementsHidden style={[styles.checkbox, { borderColor: value.accepted ? theme.accent : theme.line, backgroundColor: value.accepted ? theme.accent : theme.card }]}>
        {value.accepted && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}
      </View>
      <ThemedText type="small" style={styles.consentText}>[선택] 이름·생년월일 수집·이용에 동의합니다.</ThemedText>
    </Pressable>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three }, field: { gap: Spacing.two },
  input: { minHeight: 48, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8, fontSize: 16 },
  consent: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  consentText: { flex: 1 },
});
