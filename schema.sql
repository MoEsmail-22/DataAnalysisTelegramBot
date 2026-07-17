create table if not exists customer_profiles (
  id bigserial primary key,
  source_hash text not null,
  customer_name text,
  primary_phone text,
  duplicate_check_phone text,
  phones text[] not null default '{}',
  governorate text,
  zone text,
  area text,
  addresses text[] not null default '{}',
  notes text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep the first row for each duplicate primary phone, then enforce uniqueness.
-- Rows without primary_phone are not treated as duplicates.
delete from customer_profiles cp
using customer_profiles older
where cp.primary_phone is not null
  and older.primary_phone = cp.primary_phone
  and older.id < cp.id;

create unique index if not exists customer_profiles_primary_phone_key
  on customer_profiles (primary_phone);

create index if not exists customer_profiles_phones_gin_idx
  on customer_profiles using gin (phones);

create index if not exists customer_profiles_addresses_gin_idx
  on customer_profiles using gin (addresses);

create index if not exists customer_profiles_customer_name_idx
  on customer_profiles (customer_name);

create index if not exists customer_profiles_zone_idx
  on customer_profiles (zone);

create index if not exists customer_profiles_area_idx
  on customer_profiles (area);
