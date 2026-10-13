-- Conversational inbox/push copy; preserve recipients, privacy, throttles and jobs.
-- Patch only exact current fragments, keeping intervening schema/security corrections.
do $copy$
declare change record; definition text;
begin
  for change in
    select * from (values
      ('private.notify_message()', '''메시지가 도착했습니다''', '''메시지가 도착했어요.'''),
      ('public.claim_push_notifications(text,integer)', '''메시지가 도착했습니다''', '''메시지가 도착했어요.'''),
      ('public.claim_push_notifications(text,integer)', '''사진을 보냈습니다''', '''사진을 보냈어요.'''),
      ('public.claim_push_notifications(text,integer)', '''위치를 보냈습니다''', '''위치를 보냈어요.'''),
      ('public.moderate_report(uuid,text,text)', '''커뮤니티 운영 정책에 따라 경고를 받았습니다.''', '''커뮤니티 이용 규칙에 따른 경고예요. 이용 규칙을 확인해 주세요.'''),
      ('public.moderate_report(uuid,text,text)', '''커뮤니티 운영 정책에 따라 계정 이용이 제한됐습니다.''', '''커뮤니티 이용 규칙에 따라 계정 이용이 제한됐어요. 계정 설정에서 확인해 주세요.'''),
      ('private.create_merchant_operation_event(uuid,uuid,text)', '''외부 서비스 연결을 다시 확인해 주세요.''', '''외부 서비스 연결을 확인해 주세요. 비즈니스 관리에서 상태를 볼 수 있어요.'''),
      ('private.create_merchant_operation_event(uuid,uuid,text)', '''게시 결과를 확인해야 합니다. 다시 게시하기 전에 확인해 주세요.''', '''게시 결과가 아직 확실하지 않아요. 다시 게시하기 전에 비즈니스 관리에서 확인해 주세요.'''),
      ('private.create_merchant_operation_event(uuid,uuid,text)', '''게시를 완료하지 못했습니다. 업체 작업에서 확인해 주세요.''', '''게시를 마치지 못했어요. 비즈니스 관리에서 확인해 주세요.'''),
      ('private.notify_saved_merchant_post(uuid,boolean)', '''저장한 업체에 새 소식이 올라왔습니다.''', '''저장한 비즈니스에 새 소식이 있어요. 한번 살펴보세요.'''),
      ('private.notify_merchant_review_received()', '''업체에 새 이용 후기가 도착했습니다.''', '''내 비즈니스에 새 이용 후기가 올라왔어요. 확인해 보세요.'''),
      ('private.notify_merchant_review_reply()', '''이용 후기에 업체 답변이 도착했습니다.''', '''내 후기에 비즈니스에서 답변을 남겼어요.'''),
      ('private.notify_merchant_review_result()', '''후기 증빙 인증이 승인되었습니다.''', '''후기 증빙을 확인했어요. 이제 인증된 후기로 표시돼요.'''),
      ('private.notify_merchant_review_result()', '''후기 증빙 인증이 반려되었습니다. 본인 후기에서 사유를 확인해 주세요.''', '''후기 인증이 승인되지 않았어요. 내 후기에서 이유를 확인해 주세요.'''),
      ('private.enqueue_trust_safety_review()', '''후기·참석 확인 검토가 필요합니다.''', '''후기나 참석 확인을 살펴봐야 해요. 관리자 화면에서 검토해 주세요.'''),
      ('public.appeal_manner_review(uuid,text)', '''매너 평가 이의제기를 검토해주세요.''', '''매너 평가에 이의제기가 들어왔어요. 한번 검토해 주세요.'''),
      ('private.notify_profile_signup()', '''새 회원 가입 · '' || new.nickname::text || '' · '' || city_name', 'new.nickname::text || ''님이 '' || city_name || ''에 새로 가입했어요.'''),
      ('private.notify_report()', '''사용자 차단이 접수됐어요. 신고함에서 확인해 주세요.''', '''새 차단 내역이 있어요. 신고함에서 확인해 주세요.'''),
      ('private.notify_report()', '''콘텐츠 신고가 접수됐어요. 신고함에서 원본을 확인해 주세요.''', '''새 신고가 들어왔어요. 신고함에서 원본을 확인해 주세요.'''),
      ('private.process_discovery_posts(integer)', '''관심 있는 주제의 새 글이 올라왔어요.''', '''관심 있는 주제에 새 글이 올라왔어요. 한번 읽어볼까요?'''),
      ('private.process_discovery_posts(integer)', '''내 지역에 새로운 모임이 올라왔어요.''', '''우리 동네에 새 모임이 생겼어요. 어떤 모임인지 볼까요?'''),
      ('private.request_meetup_join(uuid,text)', '''님이 모임 참여를 요청했어요.''', '''님이 모임 참여를 신청했어요. 한번 확인해 주세요.'''),
      ('public.respond_meetup_request(uuid,text)', '''모임 참여 요청이 승인됐어요. 모임 대화에서 함께 이야기해요.''', '''모임에 함께할 수 있게 됐어요. 모임 채팅에서 인사해 볼까요?'''),
      ('public.respond_meetup_request(uuid,text)', '''이번 모임 참여 요청은 승인되지 않았어요.''', '''이번에는 모임에 함께하기 어려워요. 다른 모임도 둘러보세요.'''),
      ('private.scan_watch_terms()', '''감시어(긴급)가 포함된 콘텐츠가 올라왔어요. 즉시 확인이 필요합니다.''', '''긴급하게 확인할 감시어가 포함돼 있어요. 지금 바로 검토해 주세요.'''),
      ('private.scan_watch_terms()', '''감시어가 포함된 콘텐츠가 올라왔어요. 확인해 주세요.''', '''감시어가 포함된 글이나 대화가 있어요. 관리자 화면에서 확인해 주세요.'''),
      ('public.raise_safety_alert(bigint)', '''긴급 위험 콘텐츠가 감지됐어요. 즉시 검토가 필요합니다.''', '''긴급한 위험 신호를 발견했어요. 지금 바로 검토해 주세요.'''),
      ('public.raise_safety_alert(bigint)', '''고위험 콘텐츠가 감지됐어요. 관리자 검토가 필요합니다.''', '''위험도가 높게 나온 콘텐츠가 있어요. 관리자 화면에서 검토해 주세요.'''),
      ('private.send_city_recommendations(timestamptz)', '''새로 올라온 맛집·레스토랑 · ''', '''새 맛집 이야기가 올라왔어요. '''),
      ('private.send_city_recommendations(timestamptz)', '''요즘 관심이 높아진 맛집·레스토랑 · ''', '''요즘 이 맛집 이야기에 관심이 모이고 있어요. '''),
      ('private.send_city_recommendations(timestamptz)', '''지금 반응이 빠르게 오르는 글 · ''', '''이 글에 요즘 관심이 모이고 있어요. '''),
      ('private.send_city_recommendations(timestamptz)', '''새로 올라온 페스티벌 소식 · ''', '''새 페스티벌 소식이 올라왔어요. '''),
      ('private.send_city_recommendations(timestamptz)', '''새로 올라온 가볼 만한 곳 · ''', '''새로 소개된 곳이에요. 한번 둘러볼까요? '''),
      ('private.send_city_recommendations(timestamptz)', '''요새 글링인들이 많이 찾는 페스티벌 · ''', '''이 페스티벌에 요즘 관심이 모이고 있어요. '''),
      ('private.send_city_recommendations(timestamptz)', '''새로 발견한 페스티벌 · ''', '''새로 찾은 페스티벌이에요. '''),
      ('private.send_city_recommendations(timestamptz)', '''새로 발견한 행사 · ''', '''이런 행사도 있네요! '''),
      ('private.send_city_recommendations(timestamptz)', '''가볼 만한 페스티벌 · ''', '''가볼 만한 페스티벌이 있어요. '''),
      ('private.send_city_recommendations(timestamptz)', '''다가오는 행사 추천 · ''', '''다가오는 행사, 한번 둘러볼까요? '''),
      ('private.send_city_recommendations(timestamptz)', '''오늘 ''||city.name||'' 맛집·레스토랑 · ''', '''오늘 ''||city.name||''에서 뭐 먹을지 고민이라면 한번 보세요. '''),
      ('private.send_city_recommendations(timestamptz)', '''오늘 ''||city.name||'' 추천 · ''', '''오늘 ''||city.name||'' 이야기, 같이 볼까요? '''),
      ('private.send_daily_city_digest(timestamptz)', '''오늘 ''||city.name||'' 소식 · ''', '''오늘 ''||city.name||'' 소식, 같이 읽어볼까요? '''),
      ('private.send_trending_notifications()', '''지금 뜨는 글 · ''', '''요즘 관심이 모이는 글이에요. '''),
      ('public.send_trending_topic_notifications()', '''요즘 뜨는 해시태그 · #''', '''요즘 관심이 모이는 주제예요. #'''),
      ('public.send_trending_topic_notifications()', '''요즘 뜨는 모임 · ''', '''요즘 관심이 모이는 모임이에요. '''),
      ('private.publish_weekly_ranking()', '''이번 주 인기 글이 나왔어요 · 1위 ''', '''이번 주 인기 글 1위예요. 한번 읽어볼까요? '''),
      ('private.publish_weekly_ranking()', '''/ranking?city='' || city.city_id', '''/post/'' || first.post_id::text'),
      ('private.notify_meetup_event_change()', ''' 모임이 종료·취소되었어요.''', ''' 모임이 마감되거나 취소됐어요. 모임 글에서 확인해 주세요.'''),
      ('private.notify_meetup_event_change()', ''' 모임의 시간·장소가 변경되었어요. 모임에서 확인해 주세요.''', ''' 모임의 시간이나 장소가 바뀌었어요. 바뀐 내용을 확인해 주세요.'''),
      ('private.send_meetup_reminders(timestamptz)', ''' 모임이 24시간 뒤 시작해요. (''', ''' 모임이 24시간 뒤에 시작해요. ('''),
      ('private.send_meetup_reminders(timestamptz)', ''' · 모임 현지 시간)''', ''' · 모임 장소 기준)'''),
      ('private.send_meetup_reminders(timestamptz)', ''' 모임이 오늘 ''', ''' 모임은 오늘 '''),
      ('private.send_meetup_reminders(timestamptz)', '''에 시작해요. (모임 현지 시간)''', '''에 시작해요. (모임 장소 기준)'''),
      ('private.send_meetup_reminders(timestamptz)', ''' 모임이 1시간 뒤 시작해요.''', ''' 모임이 1시간 뒤에 시작해요.'''),
      ('private.send_meetup_review_requests(timestamptz)', '''모임은 어땠나요? 참석 확인 후 경험과 매너 평가를 남겨주세요.''', '''모임은 어땠어요? 참석을 확인하고 함께한 경험과 매너를 남겨 주세요.'''),
      ('public.run_admin_alert_checks()', '''같은 IP에서 '' || rec.users || ''개 계정이 확인됐어요 · '' || rec.ip', '''같은 IP로 '' || rec.users || ''개 계정이 접속했어요. 관리자 화면에서 확인해 주세요.'''),
      ('public.run_admin_alert_checks()', '''새 앱 오류가 보고됐어요 · '' || left(rec.message, 120)', '''앱에서 새 오류가 생겼어요. 관리자 화면에서 자세히 확인해 주세요.'''),
      ('public.run_admin_alert_checks()', '''짧은 시간에 요청이 몰렸어요 · 10분에 '' || rec.hits || ''건''', '''최근 10분 동안 요청이 '' || rec.hits || ''건 들어왔어요. 관리자 화면에서 확인해 주세요.''')
    ) edits(signature,old_text,new_text)
  loop
    definition:=pg_get_functiondef(change.signature::regprocedure);
    if array_length(string_to_array(definition,change.old_text),1)<>2 then
      raise exception 'NOTIFICATION_COPY_CHANGED: %',change.signature;
    end if;
    execute replace(definition,change.old_text,change.new_text);
  end loop;
end;
$copy$;
notify pgrst,'reload schema';
