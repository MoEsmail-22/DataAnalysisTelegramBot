const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : undefined,
});

async function testConnection() {
  await pool.query("select 1");
}

async function upsertCustomerProfile(profile) {
  const result = await pool.query(
    `
      insert into customer_profiles (
        source_hash,
        customer_name,
        primary_phone,
        duplicate_check_phone,
        phones,
        governorate,
        zone,
        area,
        addresses,
        notes,
        raw_data,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (primary_phone)
      do update set
        source_hash = excluded.source_hash,
        customer_name = coalesce(excluded.customer_name, customer_profiles.customer_name),
        duplicate_check_phone = excluded.duplicate_check_phone,
        phones = excluded.phones,
        governorate = excluded.governorate,
        zone = excluded.zone,
        area = excluded.area,
        addresses = excluded.addresses,
        notes = excluded.notes,
        raw_data = excluded.raw_data,
        updated_at = now()
      returning (xmax = 0) as inserted
    `,
    [
      profile.sourceHash,
      profile.customerName,
      profile.primaryPhone,
      profile.duplicateCheckPhone,
      profile.phones,
      profile.governorate,
      profile.zone,
      profile.area,
      profile.addresses,
      profile.notes,
      profile.rawData,
    ],
  );

  return result.rows[0]?.inserted ? "inserted" : "updated";
}

async function findCustomerProfile(query) {
  const value = query.trim();

  const result = await pool.query(
    `
      select
        customer_name,
        primary_phone,
        duplicate_check_phone,
        phones,
        governorate,
        zone,
        area,
        addresses,
        notes,
        updated_at
      from customer_profiles
      where $1 = any(phones)
        or primary_phone = $1
        or duplicate_check_phone = $1
        or customer_name ilike $2
      order by
        case
          when primary_phone = $1 then 0
          when $1 = any(phones) then 1
          else 2
        end,
        updated_at desc
      limit 1
    `,
    [value, `%${value}%`],
  );

  return result.rows[0] || null;
}

async function countCustomerProfiles() {
  const result = await pool.query(
    `
      select
        count(*)::int as total_customers,
        coalesce(sum(cardinality(phones)), 0)::int as total_phone_numbers,
        coalesce(sum(cardinality(addresses)), 0)::int as total_addresses
      from customer_profiles
    `,
  );

  return result.rows[0];
}

module.exports = {
  pool,
  testConnection,
  upsertCustomerProfile,
  findCustomerProfile,
  countCustomerProfiles,
};
