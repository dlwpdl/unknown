import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  loadAdminConversation, loadAdminConversations, mergeConversationMessages, saveAdminConversationReview,
  type ConversationDetail, type ConversationFilters, type ConversationPage, type ConversationReviewStatus,
} from '@/lib/admin-conversations';
import { supabase } from '@/lib/supabase';

export function useAdminConversations(filters: ConversationFilters, refreshSignal: number) {
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const listKey = JSON.stringify([filters, refreshSignal, listRevision]);
  const [page, setPage] = useState<{ key: string; data: ConversationPage } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailKey = JSON.stringify([selectedId, filters, refreshSignal, listRevision, detailRevision]);
  const [response, setResponse] = useState<{ key: string; data: ConversationDetail } | null>(null);
  const [listFailure, setListFailure] = useState<{ key: string; message: string } | null>(null);
  const [detailFailure, setDetailFailure] = useState<{ key: string; message: string } | null>(null);
  const [saveFailure, setSaveFailure] = useState<{ key: string; message: string } | null>(null);
  const [savedNotice, setSavedNotice] = useState<{ id: string; message: string } | null>(null);
  const [moreRequest, setMoreRequest] = useState<string | null>(null);
  const [messagesRequest, setMessagesRequest] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const listVersion = useRef(0), detailVersion = useRef(0);
  const moreBusy = useRef(false), messagesBusy = useRef(false), saveBusy = useRef(false);
  const alive = useRef(true);
  const selection = useRef(selectedId);
  const activeListKey = useRef(listKey);
  const activeDetailKey = useRef(detailKey);
  useLayoutEffect(() => {
    selection.current = selectedId;
    activeListKey.current = listKey;
    activeDetailKey.current = detailKey;
  }, [selectedId, listKey, detailKey]);
  const currentPage = page?.key === listKey ? page.data : null;
  const detail = currentPage && response?.key === detailKey ? response.data : null;
  const listError = listFailure?.key === listKey ? listFailure.message : '';
  const detailError = detailFailure?.key === detailKey ? detailFailure.message : '';
  const saveError = saveFailure?.key === detailKey ? saveFailure.message : '';
  const notice = savedNotice?.id === selectedId ? savedNotice.message : '';
  const loadingMore = moreRequest === listKey;
  const loadingMessages = messagesRequest === detailKey;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; listVersion.current += 1; detailVersion.current += 1; };
  }, []);

  useEffect(() => {
    let active = true;
    const version = ++listVersion.current;
    moreBusy.current = false;
    void loadAdminConversations(supabase, filters).then((data) => {
      if (!active || version !== listVersion.current || activeListKey.current !== listKey) return;
      setPage({ key: listKey, data });
      setSelectedId((id) => data.rows.some((room) => room.id === id) ? id : data.rows[0]?.id ?? null);
    }).catch(() => {
      if (active && version === listVersion.current && activeListKey.current === listKey) {
        setListFailure({ key: listKey, message: '대화 목록을 불러오지 못했어요. 관리자 권한과 연결 상태를 확인해 주세요.' });
      }
    });
    return () => { active = false; };
  }, [filters, listKey]);

  useEffect(() => {
    let active = true;
    const version = ++detailVersion.current;
    messagesBusy.current = false;
    if (!selectedId) return;
    void loadAdminConversation(supabase, selectedId).then((data) => {
      if (active && version === detailVersion.current && activeDetailKey.current === detailKey) {
        setResponse({ key: detailKey, data: { ...data, messages: mergeConversationMessages([], data.messages) } });
      }
    }).catch(() => {
      if (active && version === detailVersion.current && activeDetailKey.current === detailKey) {
        setDetailFailure({ key: detailKey, message: '대화를 불러오지 못했어요. 다시 시도해 주세요.' });
      }
    });
    return () => { active = false; };
  }, [detailKey, selectedId]);

  const loadMore = async () => {
    if (!currentPage || currentPage.nextOffset == null || moreBusy.current) return;
    moreBusy.current = true;
    setMoreRequest(listKey);
    setListFailure(null);
    const version = listVersion.current;
    try {
      const data = await loadAdminConversations(supabase, filters, currentPage.nextOffset);
      if (!alive.current || version !== listVersion.current || activeListKey.current !== listKey) return;
      setPage((current) => current?.key === listKey ? { key: listKey, data: { ...data,
        rows: [...new Map([...current.data.rows, ...data.rows].map((room) => [room.id, room])).values()],
      } } : current);
    } catch {
      if (alive.current && version === listVersion.current && activeListKey.current === listKey) {
        setListFailure({ key: listKey, message: '다음 대화를 불러오지 못했어요. 다시 시도해 주세요.' });
      }
    } finally {
      if (version === listVersion.current) { moreBusy.current = false; if (alive.current) setMoreRequest(null); }
    }
  };

  const loadMessages = async (focusMessageId: string | null = null, latest = false) => {
    if (!detail || !selectedId || messagesBusy.current || (!latest && !focusMessageId && !detail.nextCursor)) return false;
    const id = selectedId;
    const version = ++detailVersion.current;
    messagesBusy.current = true;
    setMessagesRequest(detailKey);
    setDetailFailure(null);
    try {
      const next = await loadAdminConversation(supabase, id, latest || focusMessageId ? null : detail.nextCursor, focusMessageId);
      if (!alive.current || version !== detailVersion.current || activeDetailKey.current !== detailKey || selection.current !== id) return false;
      setResponse({ key: detailKey, data: { ...next,
        messages: mergeConversationMessages(latest || focusMessageId ? [] : detail.messages, next.messages),
        signals: latest || focusMessageId ? next.signals : [...new Map([...detail.signals, ...next.signals].map((signal) => [signal.id, signal])).values()],
        hasNewer: latest || focusMessageId ? next.hasNewer : detail.hasNewer,
      } });
      return true;
    } catch {
      if (alive.current && version === detailVersion.current && activeDetailKey.current === detailKey) {
        setDetailFailure({ key: detailKey, message: focusMessageId ? '신호 앞뒤의 대화를 불러오지 못했어요. 보존된 신호 문구는 검토 기록에서 확인할 수 있어요.' : '메시지를 불러오지 못했어요. 다시 시도해 주세요.' });
      }
      return false;
    } finally {
      if (version === detailVersion.current) { messagesBusy.current = false; if (alive.current) setMessagesRequest(null); }
    }
  };

  const saveReview = async (status: ConversationReviewStatus, note: string) => {
    if (!detail || !selectedId || saveBusy.current) return false;
    const id = selectedId;
    const expected = detail.conversation;
    saveBusy.current = true;
    setSaving(true);
    setSaveFailure(null);
    setSavedNotice(null);
    try {
      const review = await saveAdminConversationReview(supabase, id, status, note, expected.review?.id ?? null, expected.latest_signal_at);
      if (!alive.current) return true;
      setResponse((current) => current?.key === detailKey && current.data.conversation.review?.id === expected.review?.id && current.data.conversation.latest_signal_at === expected.latest_signal_at ? { ...current, data: { ...current.data,
        conversation: { ...current.data.conversation, review, status: review.status, reopened: false },
        review_history: [review, ...current.data.review_history.filter((entry) => entry.id !== review.id)],
      } } : current);
      if (selection.current === id) setSavedNotice({ id, message: '검토 기록을 저장했어요.' });
      setListRevision((value) => value + 1);
      return true;
    } catch (error) {
      if (alive.current && selection.current === id) {
        const code = error instanceof Error ? error.message : '';
        setSaveFailure({ key: detailKey, message: /CONFLICT|STALE|CONVERSATION_(REVIEW|SIGNALS)_CHANGED/i.test(code)
          ? '새 신호나 다른 운영자의 검토 기록이 있어요. 메모는 유지했으니 최신 대화를 불러온 뒤 다시 확인해 주세요.'
          : '저장 결과를 확인하지 못했어요. 메모는 유지했으니 최신 기록을 확인해 주세요. 자동으로 다시 저장하지 않아요.' });
      }
      return false;
    } finally {
      saveBusy.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const reloadList = useCallback(() => setListRevision((value) => value + 1), []);
  const reloadDetail = useCallback(() => setDetailRevision((value) => value + 1), []);
  return { page: currentPage, selectedId, setSelectedId, detail, listError, detailError, saveError, notice,
    loading: !currentPage && !listError, detailLoading: !!selectedId && !detail && !detailError,
    loadingMore, loadingMessages, saving, loadMore, loadMessages, saveReview, reloadList, reloadDetail };
}
