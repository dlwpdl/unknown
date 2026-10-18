-- Keep dates readable by the shared YYYY-MM-DD form and API contract.
alter table private.creator_deals add constraint creator_deals_collaboration_date_range check(collaboration_on<='9999-12-31');
