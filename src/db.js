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
  return crypto.createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

async function ensureAccessTable() {
  await pool.query(`
    create table if not exists bot_access_users (
      telegram_id text primary key,
      role text not null check (role in ('user', 'data-entry', 'super_admin')),
      display_name text,
      added_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table bot_access_users
    add column if not exists display_name text
  `);
  await pool.query(`
    alter table bot_access_users
    drop constraint if exists bot_access_users_role_check
  `);
  await pool.query(`
    alter table bot_access_users
    add constraint bot_access_users_role_check
    check (role in ('user', 'data-entry', 'super_admin'))
  `);
}

async function ensureAccessRequestsTable() {
  await pool.query(`
    create table if not exists access_requests (
      telegram_id text primary key,
      phone text,
      display_name text,
      status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
      granted_role text check (granted_role is null or granted_role in ('user', 'data-entry', 'super_admin')),
      requested_at timestamptz not null default now(),
      reviewed_by text,
      reviewed_at timestamptz
    )
  `);
  await pool.query(`
    create index if not exists access_requests_status_idx
      on access_requests (status)
  `);
}

async function testConnection() {
  await pool.query("select 1");
  await ensureAccessTable();
  await ensureAccessRequestsTable();
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
    existing.phones = unique([...existing.phones, ...profile.phones]);
    existing.governorate = existing.governorate || profile.governorate;
    existing.zone = existing.zone || profile.zone;
    existing.area = existing.area || profile.area;
    existing.addresses = unique([...existing.addresses, ...profile.addresses]);
    existing.notes = existing.notes || profile.notes;
    existing.rawData = { ...existing.rawData, ...profile.rawData };
    existing.sourceHash = makeHash(existing);
  }

  const normalizedProfiles = Array.from(groupedProfiles.values());
  const chunkSize = Math.max(
    1,
    Number.parseInt(process.env.DB_UPSERT_CHUNK_SIZE || "250", 10),
  );

  for (let index = 0; index < normalizedProfiles.length; index += chunkSize) {
    await upsertCustomerProfilesChunk(normalizedProfiles.slice(index, index + chunkSize));
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
      profile.rawData,
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
        or duplicate_check_phone = $1
        or customer_name ilike $2
      order by updated_at desc
      limit 1
    `,
    [value, `%${value}%`],
  );

  return result.rows[0] || null;
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
      select telegram_id, role, display_name, added_by, created_at, updated_at
      from bot_access_users
      where telegram_id = $1
      limit 1
    `,
    [String(telegramId)],
  );

  return result.rows[0] || null;
}

async function upsertBotAccessUser(telegramId, role, addedBy, displayName = null) {
  await ensureAccessTable();

  const result = await pool.query(
    `
      insert into bot_access_users (telegram_id, role, display_name, added_by, updated_at)
      values ($1, $2, $3, $4, now())
      on conflict (telegram_id)
      do update set
        role = excluded.role,
        display_name = coalesce(excluded.display_name, bot_access_users.display_name),
        added_by = excluded.added_by,
        updated_at = now()
      returning telegram_id, role, display_name
    `,
    [String(telegramId), role, displayName, addedBy ? String(addedBy) : null],
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
      select telegram_id, role, display_name, added_by, updated_at
      from bot_access_users
      order by role, telegram_id
    `,
  );

  return result.rows;
}

async function findBotAccessUsersByName(name) {
  await ensureAccessTable();
  const value = String(name || "").trim().replace(/\s+/g, " ");
  if (!value) return [];

  const result = await pool.query(
    `
      select telegram_id, role, display_name, added_by, created_at, updated_at
      from bot_access_users
      where lower(trim(coalesce(display_name, ''))) = lower($1)
      order by role, telegram_id
      limit 20
    `,
    [value],
  );

  return result.rows;
}

async function findBotAccessUserByPhone(phone) {
  await ensureAccessTable();
  await ensureAccessRequestsTable();

  const result = await pool.query(
    `
      select ba.telegram_id, ba.role, ba.display_name, ba.added_by, ba.created_at, ba.updated_at
      from bot_access_users ba
      join access_requests ar on ba.telegram_id = ar.telegram_id
      where ar.phone = $1
      limit 1
    `,
    [String(phone)],
  );

  return result.rows[0] || null;
}

async function getAccessRequest(telegramId) {
  await ensureAccessRequestsTable();
  const result = await pool.query(
    `select * from access_requests where telegram_id = $1`,
    [String(telegramId)],
  );
  return result.rows[0] || null;
}

async function upsertAccessRequest(telegramId, phone, displayName) {
  await ensureAccessRequestsTable();
  const existing = await getAccessRequest(telegramId);

  if (existing && existing.status === "pending") {
    return { request: existing, isNew: false };
  }
  if (existing && existing.status === "approved") {
    return { request: existing, isNew: false };
  }

  const result = await pool.query(
    `
      insert into access_requests (telegram_id, phone, display_name, status, requested_at)
      values ($1, $2, $3, 'pending', now())
      on conflict (telegram_id)
      do update set
        phone = excluded.phone,
        display_name = excluded.display_name,
        status = 'pending',
        granted_role = null,
        reviewed_by = null,
        reviewed_at = null,
        requested_at = now()
      returning *
    `,
    [String(telegramId), phone, displayName],
  );
  return { request: result.rows[0], isNew: true };
}

async function listPendingAccessRequests() {
  await ensureAccessRequestsTable();
  const result = await pool.query(
    `
      select telegram_id, phone, display_name, requested_at
      from access_requests
      where status = 'pending'
      order by requested_at asc
    `,
  );
  return result.rows;
}

async function approveAndGrantAccess(telegramId, role, reviewedBy) {
  await ensureAccessRequestsTable();
  await ensureAccessTable();

  const client = await pool.connect();
  try {
    await client.query("begin");

    const reqResult = await client.query(
      `
        update access_requests
        set status = 'approved', granted_role = $2, reviewed_by = $3, reviewed_at = now()
        where telegram_id = $1 and status = 'pending'
        returning telegram_id, phone, display_name, granted_role
      `,
      [String(telegramId), role, String(reviewedBy)],
    );

    if (reqResult.rows.length === 0) {
      await client.query("rollback");
      return null;
    }

    const req = reqResult.rows[0];

    await client.query(
      `
        insert into bot_access_users (telegram_id, role, display_name, added_by, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (telegram_id)
        do update set
          role = excluded.role,
          display_name = coalesce(excluded.display_name, bot_access_users.display_name),
          added_by = excluded.added_by,
          updated_at = now()
      `,
      [String(telegramId), role, req.display_name, String(reviewedBy)],
    );

    await client.query("commit");
    return req;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectAccessRequest(telegramId, reviewedBy) {
  await ensureAccessRequestsTable();
  const result = await pool.query(
    `
      update access_requests
      set status = 'rejected', reviewed_by = $2, reviewed_at = now()
      where telegram_id = $1 and status = 'pending'
      returning telegram_id, phone, display_name
    `,
    [String(telegramId), String(reviewedBy)],
  );
  return result.rows[0] || null;
}

module.exports = {
  pool,
  testConnection,
  upsertCustomerProfiles,
  findCustomerProfile,
  countCustomerProfiles,
  getAllCustomerProfiles,
  getBotAccessUser,
  upsertBotAccessUser,
  removeBotAccessUser,
  listBotAccessUsers,
  findBotAccessUsersByName,
  findBotAccessUserByPhone,
  getAccessRequest,
  upsertAccessRequest,
  listPendingAccessRequests,
  approveAndGrantAccess,
  rejectAccessRequest,
};
