-- Supabase security advisor: functions should not have a role-mutable search_path.
alter function public.captures_before_update() set search_path = '';
