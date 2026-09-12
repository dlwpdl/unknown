import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ageOnDate, validatePersonalInfo } from '@/lib/personal-info';

export type PersonalInfoDraft = { fullName: string; dateOfBirth: string; accepted: boolean };

export function PersonalInfoFields({ value, onChange, disabled = false }: {
  value: PersonalInfoDraft; onChange: (value: PersonalInfoDraft) => void; disabled?: boolean;
}) {
  const theme = useTheme();
  const [touched, setTouched] = useState(false);
  const error = validatePersonalInfo(value.fullName, value.dateOfBirth);
  const age = !error && value.dateOfBirth ? ageOnDate(value.dateOfBirth) : null;
  const toggleConsent = () => { if (!disabled) onChange({ ...value, accepted: !value.accepted }); };
  return <View style={styles.section}>
    <ThemedText type="smallBold" accessibilityRole="header" aria-level={2}>비공개 계정 정보 · 선택</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">이름과 생년월일은 공개 닉네임과 분리돼요. 입력하지 않아도 가입하고 이용할 수 있어요.</ThemedText>
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
      {age != null && <ThemedText type="small" themeColor="textSecondary">만 {age}세 · 생년월일을 기준으로 계산해요.</ThemedText>}
    </View>
    {touched && error && <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.accent }}>{error}</ThemedText>}
    <ThemedText type="small" themeColor="textSecondary">제공한 이름·생년월일은 계정 확인과 안전사건 대응에 사용하며, 본인과 권한 있는 관리자만 볼 수 있어요. 앱 설정에서 삭제하거나 탈퇴할 때까지 보관해요. 직접 입력한 정보이며 실명인증 결과는 아니에요.</ThemedText>
    <Pressable disabled={disabled} onPress={toggleConsent} accessibilityRole="checkbox" aria-checked={value.accepted} accessibilityState={{ checked: value.accepted, disabled }}
      {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault: () => void }) => { if (event.key === ' ') { event.preventDefault(); toggleConsent(); } } } : {})}
      style={({ pressed }) => [styles.consent, { borderColor: value.accepted ? theme.accent : theme.line, backgroundColor: theme.card, opacity: disabled ? 0.55 : pressed ? 0.7 : 1 }]}>
      <View aria-hidden accessibilityElementsHidden style={[styles.checkbox, { borderColor: value.accepted ? theme.accent : theme.line, backgroundColor: value.accepted ? theme.accent : theme.card }]}>
        {value.accepted && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}
      </View>
      <ThemedText type="small" style={styles.consentText}>[선택] 이름·생년월일 수집·이용에 동의합니다.</ThemedText>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three }, field: { gap: Spacing.two },
  input: { minHeight: 48, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8, fontSize: 16 },
  consent: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  consentText: { flex: 1 },
});
