-- The number log only grows (20261103040000): a wrong number is taken out by a withdrawal row through
-- add_admin_campaign_ledger, which the admin panel now uses. The old hard delete would erase history and could not
-- remove a row that another row corrects, so it goes. Earlier 'campaign_metric_deleted' events stay as they are.
drop function public.delete_admin_campaign_metric(uuid);
notify pgrst,'reload schema';
