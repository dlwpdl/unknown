import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { applyMeetupTemplate, deleteMeetupTemplate, loadMeetupTemplates, saveMeetupTemplate, type MeetupTemplate, type MeetupTemplateDraft } from '@/lib/meetup-host-tools';

export type MeetupTemplatePickerProps = {
  draft: MeetupTemplateDraft;
  onApply: (draft: MeetupTemplateDraft) => boolean | void;
  disabled?: boolean;
};

export function MeetupTemplatePicker(props: MeetupTemplatePickerProps) {
  const { isAuthed, me } = useAuth();
  return isAuthed ? <TemplatePicker key={me.id} {...props} /> : null;
}

function TemplatePicker({ draft, onApply, disabled = false }: MeetupTemplatePickerProps) {
  const theme = useTheme(), { language, tr } = useLanguage(), { play } = useInteractionFeedback();
  const say = (ko: string, en: string) => tr(language === 'ko' ? ko : en);
  const [templates, setTemplates] = useState<MeetupTemplate[]>([]), [canUse, setCanUse] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [name, setName] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef(false), mounted = useRef(true), currentDraft = useRef(draft);
  useLayoutEffect(() => { currentDraft.current = draft; }, [draft]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void loadMeetupTemplates(supabase).then(result => {
      if (active) { setTemplates(result.templates); setCanUse(result.canUse); setError(''); }
    }).catch(() => { if (active) setError('load'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  async function save() {
    if (pending.current || disabled || !canUse) return;
    const content = { ...draft };
    pending.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try {
      await saveMeetupTemplate(supabase, name, content);
      if (mounted.current) { setName(''); setNotice('saved'); setLoading(true); setRetry(value => value + 1); play('success'); }
    } catch { if (mounted.current) { setError('save'); play('warning'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function remove(id: string) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try {
      await deleteMeetupTemplate(supabase, id);
      if (mounted.current) { setSelected(null); setLoading(true); setRetry(value => value + 1); play('success'); }
    } catch { if (mounted.current) { setError('delete'); play('warning'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function apply(id: string) {
    if (pending.current || disabled) return;
    const before = JSON.stringify(currentDraft.current);
    pending.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try {
      const result = await loadMeetupTemplates(supabase);
      if (!mounted.current) return;
      setCanUse(result.canUse); setTemplates(result.templates);
      const saved = result.templates.find(template => template.id === id);
      if (!result.canUse || !saved) throw new Error('TEMPLATE_UNAVAILABLE');
      if (before !== JSON.stringify(currentDraft.current)) { setNotice('changed'); return; }
      if (onApply(applyMeetupTemplate(currentDraft.current, saved.draft)) === false) { setNotice('declined'); play('warning'); return; }
      setNotice('applied'); play('success');
    } catch { if (mounted.current) { setError('apply'); play('warning'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const locked = disabled || busy || loading;
  const button = [styles.button, { borderColor: theme.line, opacity: locked ? 0.5 : 1 }];
  const preview = templates.find(template => template.id === selected);
  return <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="smallBold">{say('내 모임 템플릿 · Plus', 'My meetup templates · Plus')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{say('제목과 소개, 신청 질문을 저장해두고 다시 쓸 수 있어요. 날짜·장소·정원·결제 정보는 직접 확인해주세요.', 'Save a title, description and application question to reuse. Confirm dates, venue, capacity and payment separately.')}</ThemedText>
    {loading && <ThemedText type="small" accessibilityLiveRegion="polite">{say('템플릿 불러오는 중…', 'Loading templates…')}</ThemedText>}
    {!loading && !canUse && <ThemedText type="small" themeColor="textSecondary">{say('새 템플릿 저장·적용은 Plus부터 이용해요. 기존에 저장한 내용은 계속 볼 수 있어요.', 'Saving and applying templates requires Plus. Your saved content stays available to read.')}</ThemedText>}
    {!loading && templates.length === 0 && !error && <ThemedText type="small" themeColor="textSecondary">{say('아직 저장한 템플릿이 없어요.', 'You have no saved templates yet.')}</ThemedText>}
    {templates.map(template => <Pressable analyticsId="meetup_template_picker.control.1" key={template.id} accessibilityRole="button" accessibilityState={{ expanded: selected === template.id, disabled: locked }} disabled={locked}
      accessibilityLabel={say(`${template.name} 미리보기`, `Preview ${template.name}`)} style={[button, selected === template.id && { borderColor: theme.accent }]}
      onPress={() => { play('selection'); setSelected(selected === template.id ? null : template.id); }}>
      <ThemedText type="smallBold">{template.name}</ThemedText>
    </Pressable>)}
    {preview && <View style={[styles.preview, { borderColor: theme.line }]}>
      <ThemedText type="smallBold">{say('적용 전 미리보기', 'Preview before applying')}</ThemedText>
      {!!preview.draft.title && <ThemedText type="smallBold">{preview.draft.title}</ThemedText>}
      {!!preview.draft.body && <ThemedText type="small">{preview.draft.body}</ThemedText>}
      {!!preview.draft.applicationQuestion && <ThemedText type="small">{say('신청 질문: ', 'Application question: ')}{preview.draft.applicationQuestion}</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">{say('저장한 문구만 바뀌어요. 질문만 저장했다면 작성 중인 제목과 소개는 유지돼요.', 'Only saved text is applied. A question-only template keeps your current title and description.')}</ThemedText>
      <Pressable analyticsId="meetup_template_picker.control.2" accessibilityRole="button" disabled={locked || !canUse} accessibilityState={{ disabled: locked || !canUse }} style={[button, { backgroundColor: theme.backgroundSelected }, !canUse && styles.disabled]}
        onPress={() => void apply(preview.id)}>
        <ThemedText type="smallBold">{say('이 초안 적용', 'Apply this draft')}</ThemedText>
      </Pressable>
      <Pressable analyticsId="meetup_template_picker.control.3" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); Alert.alert(say('템플릿 삭제', 'Delete template'), say('이 템플릿을 삭제할까요?', 'Delete this saved template?'), [
        { text: say('취소', 'Cancel'), style: 'cancel' }, { text: say('삭제', 'Delete'), style: 'destructive', onPress: () => void remove(preview.id) },
      ]); }}>
        <ThemedText type="small" themeColor="danger">{say('이 템플릿 삭제', 'Delete this template')}</ThemedText>
      </Pressable>
    </View>}
    {canUse && <>
      <ThemedText type="smallBold">{say('현재 초안 저장', 'Save the current draft')}</ThemedText>
      <TextInput accessibilityLabel={say('템플릿 이름', 'Template name')} placeholder={say('예: 주말 산책', 'e.g. Weekend walks')} placeholderTextColor={theme.textSecondary}
        value={name} onChangeText={setName} onFocus={() => play('selection')} editable={!locked} maxLength={60} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      <Pressable analyticsId="meetup_template_picker.control.4" accessibilityRole="button" disabled={locked || !name.trim() || ![draft.title, draft.body, draft.applicationQuestion].some(value => value.trim())}
        accessibilityState={{ disabled: locked || !name.trim() || ![draft.title, draft.body, draft.applicationQuestion].some(value => value.trim()) }} style={[button, (!name.trim() || ![draft.title, draft.body, draft.applicationQuestion].some(value => value.trim())) && styles.disabled]} onPress={() => void save()}>
        <ThemedText type="smallBold">{busy ? say('저장 확인 중…', 'Checking save…') : say('템플릿 저장', 'Save template')}</ThemedText>
      </Pressable>
    </>}
    {!!error && <>
      <ThemedText type="small" accessibilityRole="alert">{error === 'load' ? say('템플릿을 불러오지 못했어요.', 'Templates could not be loaded.') : say('변경을 확인하지 못했어요. 연결과 멤버십 상태를 확인해주세요.', 'The change could not be verified. Check your connection and membership.')}</ThemedText>
      <Pressable analyticsId="meetup_template_picker.control.5" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); setLoading(true); setRetry(value => value + 1); }}><ThemedText type="small">{say('다시 불러오기', 'Reload')}</ThemedText></Pressable>
    </>}
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice === 'saved' ? say('템플릿을 저장했어요.', 'Template saved.') : notice === 'changed' ? say('작성 중인 내용이 바뀌었어요. 템플릿을 다시 확인한 뒤 적용해주세요.', 'Your draft changed. Review the template again before applying.') : notice === 'declined' ? say('적용하지 않았어요. 작성 화면의 안내를 확인해주세요.', 'The template was not applied. Check the note in your form.') : say('초안에 적용했어요. 게시 전에 내용을 확인해주세요.', 'Applied to your draft. Review it before publishing.')}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 16 },
  preview: { gap: 12, borderTopWidth: 1, paddingTop: 12 },
  button: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderRadius: 8, justifyContent: 'center' },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderRadius: 8, fontSize: 15 },
  disabled: { opacity: 0.5 },
});
