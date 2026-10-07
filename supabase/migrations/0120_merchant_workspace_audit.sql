-- PostgREST treats STABLE RPCs as read-only, but admin lists must record access.
alter function public.get_my_merchants() volatile;
notify pgrst,'reload schema';
