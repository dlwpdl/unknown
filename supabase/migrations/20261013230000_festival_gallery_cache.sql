-- Apply after deploying the broadened ticketmaster-events function; preserve payloads and owner assignments.
update public.ticketmaster_event_cache set expires_at=least(expires_at,now()),refresh_started_at=null
where cache_key in ('tm-festival:vancouver','tm-festival:toronto','tm-festival:montreal','tm-festival:calgary','tm-festival:edmonton');
