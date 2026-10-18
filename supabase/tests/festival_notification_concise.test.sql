begin;
set local search_path=public,extensions;
select no_plan();

select is(private.festival_notification_body('{
  "name":"EARLY FUTURE CLUB: OCTOBER SOULS","segment":"Miscellaneous",
  "description":"EARLY FUTURE CLUB SESSION 7 -- OCTOBER SOULS Calling all goons, goblins, and glorious goddesses. The EFC Halloween Session is here -- and we are taking over VILLAGE STUDIOS to kick off the season.",
  "venue":"Village Studios ","startsAt":"2026-10-25T02:00:00Z"
}','vancouver'),
 '할로윈 행사예요. 10월 24일, Village Studios에서 열려요.',
 'Halloween alerts explain the event briefly without repeating the English promotion');

select is(private.festival_notification_body('{
  "name":"Independent Trucks Vancouver Trip","segment":"Miscellaneous",
  "description":"Legal Age 19+ (Valid Photo I.D. Required)Independent Trucks Vancouver Trip video featuring Pedro Delfino, Jhankcarlos González, Kieran Wooley, Greyson Fletcher, Roman Pabich, Ryan Decenzo, Spencer Hamilton, Sasha Daley, Ethan Loy and Tj Rogers.",
  "venue":"The Pearl","startsAt":"2026-10-18T02:00:00Z"
}','vancouver'),
 '영상 소개 행사예요. 10월 17일, The Pearl에서 열려요.',
 'admission abbreviations cannot leave Required) fragments or a long participant list');

select is(private.festival_notification_body('{
  "description":"야외 무대에서 밴드 공연과 공개 잼 세션이 열려요. 자세한 출연진과 시간표는 행사 페이지를 확인해 주세요. No refunds or exchanges permitted.",
  "segment":"Music","genre":"Rock"
}','vancouver'),
 '야외 무대에서 밴드 공연과 공개 잼 세션이 열려요.',
 'one useful Korean sentence is enough for the notification');

select ok(char_length(private.festival_notification_body(jsonb_build_object(
 'description',repeat('상세한 공연 설명 ',60)||'.','segment','Music','genre','Jazz',
 'venue',repeat('Very Long Venue ',30),'startsAt','2026-10-18T02:00:00Z'),'vancouver'))<=90,
 'long introductions and venue names keep a concise readable notification');

select ok(private.festival_notification_body('{
 "description":"Refunds are unavailable. Valid photo I.D. Required)","segment":"Music","genre":"Jazz",
 "venue":"Fixture Park","startsAt":"2026-11-01T04:30:00Z"
}','vancouver') like '재즈 공연이에요. 10월 31일,%',
 'the concise date remains local instead of using the UTC day');

select ok(not has_function_privilege('anon','private.festival_notification_body(jsonb,text)','execute')
 and not has_function_privilege('authenticated','private.festival_notification_body(jsonb,text)','execute')
 and not has_function_privilege('service_role','private.festival_notification_body(jsonb,text)','execute'),
 'formatting remains behind the existing trusted insertion and claim boundaries');
select * from finish();
rollback;
