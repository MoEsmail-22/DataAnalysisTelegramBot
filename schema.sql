create table if not exists sales_records (
  id bigserial primary key,
  source_hash text unique not null,
  external_id text,
  customer_name text,
  phone text,
  address text,
  purchase_name text,
  purchase_date date,
  transaction_count integer not null default 1,
  quantity numeric,
  amount numeric,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sales_records_phone_idx on sales_records (phone);
create index if not exists sales_records_external_id_idx on sales_records (external_id);
create index if not exists sales_records_customer_name_idx on sales_records (customer_name);
create index if not exists sales_records_purchase_date_idx on sales_records (purchase_date);
