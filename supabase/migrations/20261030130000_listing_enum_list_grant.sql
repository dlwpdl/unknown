-- guard_listing_details runs as the posting user, so its helper needs the same grant; without it every listing whose
-- details carry jobTypes/apply/includes failed the best-effort save and the card fields never landed.
grant execute on function private.listing_enum_list(jsonb, text[]) to authenticated;
