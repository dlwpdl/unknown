import { useState } from 'react';
import { View } from 'react-native';
import { ChatRoom } from '@/components/chat-room';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import type { ConversationPreview } from '@/lib/community-data';
const direct = { id: '9f200000-0000-4000-8000-000000000001', kind: 'direct', status: 'active', title: '예시 대화', otherUser: { id: '9f000000-0000-4000-8000-000000000002', nickname: '지우', verificationLevel: 2 } } as ConversationPreview;
const changed = async () => {};
export default function ChatQA() {
 const auth=useAuth(); const [group,setGroup]=useState(false);
 return <View style={{flex:1,backgroundColor:'#0B0B12'}}><Pressable analyticsId="chat-qa.switch" accessibilityRole="button" accessibilityLabel="대화 종류 변경" onPress={()=>setGroup(value=>!value)} style={{minHeight:44,padding:12}}><ThemedText>{group?'모임 대화':'1:1 대화'}</ThemedText></Pressable>{auth.isAuthed ? <ChatRoom key={String(group)} conversation={{...direct,kind:group?'group':'direct'}} currentUserId={auth.me.id} onClose={()=>{}} onChanged={changed} /> : <ThemedText>검사 계정 준비 중</ThemedText>}</View>;
}
