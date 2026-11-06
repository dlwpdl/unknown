-- Owner 2026-11-04 ('오늘 글 순서'): a place review with a photo gets a small lift in 인기순 only; 최신순 is untouched.
-- +10 is about ten views or three saves. On 11-04 the 7-day scores ran median 44-55 and top 107-141 (Vancouver,
-- Toronto, Montreal), so the lift moves a review a few places up the middle and never to the top on its own.
-- The score lives in the business-privacy base; the chilling and business wrappers above it read its result.
do $popular$
declare
  definition text;
  anchor constant text := 'post.view_count::bigint + post.like_count::bigint + post.comment_count::bigint * 2 + post.save_count::bigint * 3 as score';
begin
  definition := pg_get_functiondef('private.business_base_get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer)'::regprocedure);
  if array_length(string_to_array(definition, anchor), 1) <> 2 then raise exception 'POPULAR_FEED_SCORE_CHANGED'; end if;
  -- Same reference line the place-review composer writes (legacy body-only reviews included).
  execute replace(definition, anchor, replace(anchor, ' as score',
    ' + case when cardinality(post.image_paths) > 0 and post.body ~ ''(^|\n)장소 후기: https://www\.openstreetmap\.org/(node|way|relation)/[1-9][0-9]*\r?(\n|$)'' then 10 else 0 end as score'));
end $popular$;
notify pgrst, 'reload schema';
