-- Popular post alerts show the actual title, including posts that are also new discoveries.
-- Preserve live selection, delivery guards, routes, owners and grants.
DO $copy$
declare change record; definition text;
begin
  for change in select * from (values
      ('private.publish_weekly_ranking()', '''이번 주 인기 글 1위예요. 한번 읽어볼까요? '' || left(first.title, 60)', 'left(first.title, 60)'),
      ('private.send_trending_notifications()', '''요즘 관심이 모이는 글이에요. '' || left(pick.title, 80)', 'left(pick.title, 80)'),
      ('private.send_city_recommendations(timestamp with time zone)', '(case when recommendation_category=''city_food'' then
          case when fresh_discovery then ''새 맛집 이야기가 올라왔어요. ''
            when rising then ''요즘 이 맛집 이야기에 관심이 모이고 있어요. ''
            else ''오늘 ''||city.name||''에서 뭐 먹을지 고민이라면 한번 보세요. '' end
          when rising then ''이 글에 요즘 관심이 모이고 있어요. ''
          when fresh_discovery and slug=''festival'' then ''새 페스티벌 소식이 올라왔어요. ''
          when fresh_discovery then ''새로 소개된 곳이에요. 한번 둘러볼까요? ''
          else ''오늘 ''||city.name||'' 이야기, 같이 볼까요? '' end)||left(p.title,65)', '(case when rising then ''''
          when recommendation_category=''city_food'' then
            case when fresh_discovery then ''새 맛집 이야기가 올라왔어요. ''
              else ''오늘 ''||city.name||''에서 뭐 먹을지 고민이라면 한번 보세요. '' end
          when fresh_discovery and slug=''festival'' then ''새 페스티벌 소식이 올라왔어요. ''
          when fresh_discovery then ''새로 소개된 곳이에요. 한번 둘러볼까요? ''
          else ''오늘 ''||city.name||'' 이야기, 같이 볼까요? '' end)||left(p.title,65)'),
      ('send_trending_topic_notifications()', '''요즘 관심이 모이는 모임이에요. '' || left(coalesce(meetup.title, ''''), 80)', 'left(coalesce(meetup.title, ''''), 80)')
  ) edits(signature,old_text,new_text)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if array_length(string_to_array(definition,change.old_text),1) <> 2 then
      raise exception 'POPULAR_NOTIFICATION_COPY_CHANGED: %',change.signature;
    end if;
    execute replace(definition,change.old_text,change.new_text);
  end loop;
end;
$copy$;
notify pgrst,'reload schema';
