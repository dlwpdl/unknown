import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Menu paths checked 2026-10-25: support.claude.com 11175166, developers.openai.com custom-mcp-server, code.claude.com/docs/en/mcp, learn.chatgpt.com/docs/extend/mcp.
type Step = { title: string; detail: string; copy?: string; link?: { label: string; url: string } };
type Client = { key: string; name: string; steps: Step[]; note?: string };

function clients(endpoint: string): Client[] {
  return [
    { key: 'claude', name: 'Claude', note: '무료 요금제는 커넥터를 1개까지 추가할 수 있어요. 팀·엔터프라이즈 요금제는 조직 관리자가 먼저 추가해야 해요.', steps: [
      { title: '커넥터 추가 화면 열기', detail: 'claude.ai 또는 Claude 데스크톱 앱에서 Customize(맞춤 설정) → Connectors(커넥터) → + → Add custom connector를 눌러요.', link: { label: 'Claude 열기', url: 'https://claude.ai' } },
      { title: '연결 주소 붙여 넣기', detail: '이름에 "글링"을 쓰고, 서버 주소 칸에 아래 주소를 붙여 넣은 뒤 Continue → Add를 눌러요.', copy: endpoint },
      { title: '글링으로 로그인', detail: 'Connect를 누르면 글링 로그인 창이 떠요. 연결할 비즈니스와 권한을 고르면 끝이에요. 대화창의 + → Connectors에서 글링을 켜고 써요.' },
    ] },
    { key: 'chatgpt', name: 'ChatGPT', note: 'ChatGPT는 요금제에 따라 이 메뉴가 보이지 않을 수 있어요.', steps: [
      { title: '플러그인 화면 열기', detail: '웹 브라우저에서 ChatGPT 플러그인 화면을 열고 + → Add custom MCP server를 눌러요.', link: { label: 'ChatGPT 플러그인 화면 열기', url: 'https://chatgpt.com/plugins' } },
      { title: '연결 주소 붙여 넣기', detail: '이름에 "글링"을 쓰고 Server URL에 아래 주소를 붙여 넣어요. 인증 칸은 비워 두고 Create as a plugin을 눌러요.', copy: endpoint },
      { title: '글링으로 로그인', detail: '설치한 뒤 대화창에서 @글링을 부르면 로그인 창이 떠요. 연결할 비즈니스와 권한을 고르면 끝이에요.' },
    ] },
    { key: 'claude-code', name: 'Claude Code', steps: [
      { title: '터미널에 붙여 넣기', detail: 'Claude Code가 설치된 컴퓨터의 터미널에서 실행해요.', copy: `claude mcp add --transport http --scope user gling ${endpoint}` },
      { title: '로그인', detail: 'Claude Code를 열고 /mcp를 입력한 뒤 gling을 골라 로그인해요.' },
      { title: '비즈니스 고르기', detail: '브라우저에 뜬 글링 화면에서 연결할 비즈니스와 권한을 고르면 끝이에요.' },
    ] },
    { key: 'codex', name: 'Codex', steps: [
      { title: '터미널에 붙여 넣기', detail: 'Codex가 설치된 컴퓨터의 터미널에서 실행해요.', copy: `codex mcp add gling --url ${endpoint}` },
      { title: '로그인', detail: '이어서 아래 명령을 실행해요.', copy: 'codex mcp login gling' },
      { title: '비즈니스 고르기', detail: '브라우저에 뜬 글링 화면에서 연결할 비즈니스와 권한을 고르면 끝이에요.' },
    ] },
  ];
}
const prompts = ['글링에 주말 알바 구인글 초안 써줘', '우리 가게 최근 글링 글 보여줘', '다음 주 휴무 안내 글 초안 만들어줘'];

export function MerchantMcpGuide({ endpoint }: { endpoint: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [selected, setSelected] = useState('claude'), [copied, setCopied] = useState('');
  const list = clients(endpoint), client = list.find(item => item.key === selected) ?? list[0];
  async function copy(text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(text); setCopied(text); play('success');
    } catch { setCopied(''); play('warning'); }
  }
  const button = (label: string, onPress: () => void, primary = false) => <Pressable analyticsId="merchant.ai.action" accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [styles.button, primary ? { backgroundColor: theme.accent, borderColor: theme.accent } : { borderColor: theme.line }, { opacity: pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={primary ? { color: theme.accentInk } : undefined}>{label}</ThemedText>
  </Pressable>;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{tr('쓰는 AI에 글링 연결하기')}</ThemedText>
    <ThemedText themeColor="textSecondary">{tr('쓰고 있는 AI를 고르고 아래 3단계를 따라 하세요. AI가 만든 초안은 여기서 확인한 뒤 게시해요.')}</ThemedText>
    <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]} accessibilityRole="tablist">
      {list.map(item => {
        const active = item.key === client.key;
        return <Pressable key={item.key} analyticsId="merchant.ai.action" accessibilityRole="tab" accessibilityLabel={item.name} accessibilityState={{ selected: active }} aria-selected={active}
          onPress={() => { play('selection'); setSelected(item.key); setCopied(''); }}
          style={({ pressed }) => [styles.tab, active && { backgroundColor: theme.card }, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" themeColor={active ? 'text' : 'textSecondary'}>{item.name}</ThemedText>
        </Pressable>;
      })}
    </View>
    {client.steps.map((step, index) => <View key={`${client.key}:${index}`} style={[styles.step, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.line }]}>
      <View style={[styles.number, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{index + 1}</ThemedText></View>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{tr(step.title)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr(step.detail)}</ThemedText>
        {step.copy && <View style={[styles.code, { borderColor: theme.line, backgroundColor: theme.background }]}>
          <ThemedText type="small" selectable style={styles.codeText}>{step.copy}</ThemedText>
          {button(copied === step.copy ? tr('복사했어요') : tr('복사'), () => { void copy(step.copy!); }, true)}
        </View>}
        {step.link && <View style={styles.row}>{button(tr(step.link.label), () => { play('selection'); void Linking.openURL(step.link!.url); })}</View>}
      </View>
    </View>)}
    {client.note && <ThemedText type="small" themeColor="textSecondary">{tr(client.note)}</ThemedText>}
    <View style={[styles.examples, { borderColor: theme.line }]}>
      <ThemedText type="smallBold">{tr('연결한 뒤 이렇게 말해 보세요')}</ThemedText>
      <View style={styles.row}>{prompts.map(prompt => <Pressable key={prompt} analyticsId="merchant.ai.action" accessibilityRole="button" accessibilityLabel={tr('{0} 복사', tr(prompt))}
        onPress={() => { void copy(tr(prompt)); }} style={({ pressed }) => [styles.prompt, { borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}>
        <ThemedText type="small">{copied === tr(prompt) ? tr('복사했어요') : `“${tr(prompt)}”`}</ThemedText>
      </Pressable>)}</View>
      <ThemedText type="small" themeColor="textSecondary">{tr('AI는 초안만 저장할 수 있어요. 공개 게시는 사장님이 여기서 확인한 글만 돼요.')}</ThemedText>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 16, padding: 24, borderRadius: 20, borderWidth: 1 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 14 },
  tab: { flexGrow: 1, minHeight: 44, minWidth: 120, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', gap: 14, paddingTop: 16 },
  number: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 6 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 6, paddingVertical: 6, marginTop: 4 },
  codeText: { flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, monospace' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  examples: { gap: 10, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  prompt: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14 },
});
