-- Partner-wide white-label settings used by every client portal and CRM.

alter table public.partner_branding
  add column if not exists product_name text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'partner-branding',
  'partner-branding',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
