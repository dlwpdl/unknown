(() => {
  const userId = '49999999-9999-9999-9999-999999999999', postId = '41111111-1111-1111-1111-111111111111', rootId = '42222222-2222-2222-2222-222222222222';
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'isolated-qa@example.invalid', app_metadata: {}, user_metadata: { nickname: '차분한수달' } };
  const payload = { sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now()/1000)+86400 };
  const token = btoa('{}')+'.'+btoa(JSON.stringify(payload))+'.isolated-test-only';
  const session = { access_token: token, refresh_token: 'isolated-test-only', expires_at: payload.exp, expires_in:86400, token_type:'bearer', user };
  const originalGet = Storage.prototype.getItem;
  Storage.prototype.getItem = function(key) { return /^sb-.*-auth-token$/.test(key) ? JSON.stringify(session) : originalGet.call(this,key); };
  const profile = { id: userId, nickname: '차분한수달', city_id:'vancouver', avatar_path:null, verification_level:2, account_status:'active', ai_safety_consent_at:'2026-09-01T00:00:00Z' };
  const post = { id: postId, city_id:'vancouver', author_id:'48888888-8888-8888-8888-888888888888', author_nickname:'밴쿠버산책모임', author_verification_level:3, author_neighborhood:'키칠라노', tag_id:1, tag_slug:'life', tag_label:'생활', tag_kind:'post', title:'주말에 함께 걸어요', body:'토요일 아침, 바닷가 산책을 함께할 이웃을 찾고 있어요. 처음 오시는 분도 편하게 이야기 나눠요.', hashtags:['산책'], created_at:'2026-09-12T18:00:00Z', like_count:8, view_count:30, comment_count:4, save_count:2, share_count:0, liked_by_me:false, saved_by_me:false, image_paths:[], room_preview:null };
  const common={post_id:postId,author_id:'48888888-8888-8888-8888-888888888888',like_count:3,liked_by_me:false,created_at:'2026-09-12T19:00:00.123456Z',author_verification_level:3,parent_id:null,reply_to_id:null,reply_to_nickname:null,reply_count:0};
  const root={...common,id:rootId,author_nickname:'밴쿠버에서온작은참새',body:'혹시 유모차도 함께 갈 수 있는 길인가요? 처음 가보는 곳이라 조금 궁금해요.',reply_count:3};
  const reply={...common,id:'43333333-3333-3333-3333-333333333333',parent_id:rootId,reply_to_id:rootId,reply_to_nickname:root.author_nickname,author_nickname:'토론토에서온느긋한곰',body:'네, 평평한 길이라 괜찮아요. 도착하면 같이 천천히 걸어요!',created_at:'2026-09-12T19:10:00.123456Z'};
  const target={...common,id:'44444444-4444-4444-4444-444444444444',parent_id:rootId,reply_to_id:reply.id,reply_to_nickname:reply.author_nickname,author_nickname:'차분한수달',author_id:userId,author_verification_level:2,body:'좋아요! 따뜻한 커피도 함께 마시면 좋겠어요. 저는 열 시에 도착할게요.',created_at:'2026-09-12T18:20:00.123456Z'};
  const last={...reply,id:'45555555-5555-5555-5555-555555555555',author_nickname:'동네산책친구',body:'저도 함께할게요. 만나는 위치를 알려 주세요!',created_at:'2026-09-12T19:20:00.123456Z'};
  const prefs={post_likes:true,comment_likes:true,replies:true,direct_requests:true,messages:true,meetups:true,interests:false,nearby:false,push_enabled:false,interest_tag_ids:[1],interest_hashtags:[]};
  window.__commentQA={requests:[],failSend:false,prefs};
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin) return nativeFetch(input,options);
    const body=options.body?JSON.parse(options.body):{};
    window.__commentQA.requests.push({path:url.pathname,method:options.method??'GET',body});
    let data=[]; let status=200;
    if(url.pathname.endsWith('/get_public_post')) data=url.searchParams.get('select')==='view_count'?{view_count:31}:[post];
    else if(url.pathname.endsWith('/get_public_comments_page')) data=[root];
    else if(url.pathname.endsWith('/get_comment_thread_context')) data=body.p_comment_id===target.id?[root,target]:body.p_comment_id===root.id?[root]:[];
    else if(url.pathname.endsWith('/get_comment_thread_page')) data=body.p_parent_id?[last,reply,target]:[root];
    else if(url.pathname.endsWith('/create_thread_comment')) { if(window.__commentQA.failSend){status=503;data={message:'isolated offline simulation'};}else data='46666666-6666-6666-6666-666666666666'; }
    else if(url.pathname.endsWith('/record_post_view')) data=31;
    else if(url.pathname.endsWith('/get_notification_preferences')) data=prefs;
    else if(url.pathname.endsWith('/update_notification_preferences')) data=Object.assign(prefs,body.p_preferences);
    else if(url.pathname.endsWith('/profiles')) data=profile;
    else if(url.pathname.endsWith('/auth/v1/user')) data=user;
    else if(url.pathname.endsWith('/auth/v1/token')) data=session;
    else if(url.pathname.includes('/get_membership')) data={tier:'free',relationship_limit:1};
    return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  };
})();
