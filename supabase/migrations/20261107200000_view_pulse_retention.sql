-- Restore the view-pulse cleanup (owner 2026-11-07 "조회 기록 정리: 되살리기"). Safe to rerun: cron.schedule upserts by name.
-- The delete lives in send_trending_notifications, which no job has called since the city recommendations replaced it,
-- so the table kept every bucket. Same window as that delete. Readers look back 7 days at most; posts.view_count is stored apart.
select cron.schedule('gling-view-pulse-retention','53 8 * * *',$job$ delete from private.post_view_pulse where bucket<now()-make_interval(hours=>greatest((select window_hours*2 from private.trending_config where id),168)) $job$);

-- The buckets this job would have removed already.
delete from private.post_view_pulse where bucket<now()-make_interval(hours=>greatest((select window_hours*2 from private.trending_config where id),168));
