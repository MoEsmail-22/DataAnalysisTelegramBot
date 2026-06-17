"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : undefined,
});

function unique(values) {
  return [...new Set(values.flat().filter(Boolean))];
}

function makeHash(profile) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex");
}

async function ensureAccessTable() {
  await pool.query(`
    create table if not exists bot_access_users (
      telegram_id text primary key,
      role text not null check (role in ('user', 'admin')),
      added_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

async function testConnection() {
  await pool.query("select 1");
  await ensureAccessTable();
}

async function upsertCustomerProfiles(profiles) {
  if (!profiles.length) return;

  const groupedProfiles = new Map();
  let nullKeyCounter = 0;

  for (const profile of profiles) {
    const key = profile.primaryPhone || `__NULL__${nullKeyCounter++}`;
    const existing = groupedProfiles.get(key);

    if (!existing) {
      groupedProfiles.set(key, { ...profile });
      continue;
    }

    existing.customerName = existing.customerName || profile.customerName;
    existing.duplicateCheckPhone =
      existing.duplicateCheckPhone || profile.duplicateCheckPhone;

    // OPTIMIZATION: Mutate arrays in-place to cut down Garbage Collection memory spikes
    if (profile.phones?.length) {
      existing.phones.push(...profile.phones);
      existing.phones = unique(existing.phones);
    }

    existing.governorate = existing.governorate || profile.governorate;
    existing.zone = existing.zone || profile.zone;
    existing.area = existing.area || profile.area;

    if (profile.addresses?.length) {
      existing.addresses.push(...profile.addresses);
      existing.addresses = unique(existing.addresses);
    }

    existing.notes = existing.notes || profile.notes;

    // Only merge raw data if explicitly turned on to conserve memory overhead
    if (String(process.env.STORE_RAW_DATA || "").toLowerCase() === "true") {
      existing.rawData = { ...existing.rawData, ...profile.rawData };
    }

    existing.sourceHash = makeHash(existing);
  }

  const normalizedProfiles = Array.from(groupedProfiles.values());
  const chunkSize = Math.max(
    1,
    Number.parseInt(process.env.DB_UPSERT_CHUNK_SIZE || "250", 10),
  );

  for (let index = 0; index < normalizedProfiles.length; index += chunkSize) {
    await upsertCustomerProfilesChunk(
      normalizedProfiles.slice(index, index + chunkSize),
    );
  }
}

async function upsertCustomerProfilesChunk(profiles) {
  const values = [];
  const placeholders = [];

  profiles.forEach((profile, index) => {
    const base = index * 11;

    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5},
        $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, now())`,
    );

    values.push(
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
      profile.rawData || {},
    );
  });

  const query = `
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
    values ${placeholders.join(",")}
    on conflict (primary_phone)
    do update set
      source_hash = excluded.source_hash,
      customer_name = excluded.customer_name,
      duplicate_check_phone = excluded.duplicate_check_phone,
      phones = excluded.phones,
      governorate = excluded.governorate,
      zone = excluded.zone,
      area = excluded.area,
      addresses = excluded.addresses,
      notes = excluded.notes,
      raw_data = excluded.raw_data,
      updated_at = now();
  `;

  await pool.query(query, values);
}

async function findCustomerProfile(query) {
  const value = query.trim();

  const result = await pool.query(
    `
      select *
      from customer_profiles
      where phones @> array[$1]::text[]
        or primary_phone = $1
        or duplicate_check_phone = $1
        or customer_name ilike $2
      order by updated_at desc
      limit 1
    `,
    [value, `${value}%`],
  );

  return result.rows[0] || null;
}

async function deleteCustomerProfilesNotInHashes(sourceHashes) {
  if (!Array.isArray(sourceHashes) || sourceHashes.length === 0) {
    return 0;
  }

  const result = await pool.query(
    `
      delete from customer_profiles
      where not (source_hash = any($1::text[]))
    `,
    [sourceHashes],
  );

  return result.rowCount || 0;
}

async function countCustomerProfiles() {
  const result = await pool.query(`
    select
      count(*)::int as total_customers,
      coalesce(sum(cardinality(phones)), 0)::int as total_phone_numbers,
      coalesce(sum(cardinality(addresses)), 0)::int as total_addresses
    from customer_profiles
  `);

  return result.rows[0];
}

async function getAllCustomerProfiles() {
  const result = await pool.query(`
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
    order by updated_at desc, customer_name asc
  `);

  return result.rows;
}

async function getBotAccessUser(telegramId) {
  await ensureAccessTable();

  const result = await pool.query(
    `
      select telegram_id, role, added_by, created_at, updated_at
      from bot_access_users
      where telegram_id = $1
      limit 1
    `,
    [String(telegramId)],
  );

  return result.rows[0] || null;
}

async function upsertBotAccessUser(telegramId, role, addedBy) {
  await ensureAccessTable();

  const result = await pool.query(
    `
      insert into bot_access_users (telegram_id, role, added_by, updated_at)
      values ($1, $2, $3, now())
      on conflict (telegram_id)
      do update set
        role = excluded.role,
        added_by = excluded.added_by,
        updated_at = now()
      returning telegram_id, role
    `,
    [String(telegramId), role, addedBy ? String(addedBy) : null],
  );

  return result.rows[0];
}

async function removeBotAccessUser(telegramId, role = null) {
  await ensureAccessTable();

  const result = await pool.query(
    `
      delete from bot_access_users
      where telegram_id = $1
        and ($2::text is null or role = $2)
      returning telegram_id, role
    `,
    [String(telegramId), role],
  );

  return result.rows[0] || null;
}

async function listBotAccessUsers() {
  await ensureAccessTable();

  const result = await pool.query(
    `
      select telegram_id, role, added_by, created_at, updated_at
      from bot_access_users
      order by role asc, created_at desc
    `,
  );

  return result.rows;
}

module.exports = {
  pool,
  testConnection,
  upsertCustomerProfiles,
  findCustomerProfile,
  deleteCustomerProfilesNotInHashes,
  countCustomerProfiles,
  getAllCustomerProfiles,
  getBotAccessUser,
  upsertBotAccessUser,
  removeBotAccessUser,
  listBotAccessUsers,
};
