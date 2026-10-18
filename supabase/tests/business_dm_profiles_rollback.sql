-- STOP only the new lookup; preserve 041 and all business/safety data.
begin;
revoke execute on function public.get_my_business_chat_profiles() from authenticated;
notify pgrst,'reload schema';
commit;
