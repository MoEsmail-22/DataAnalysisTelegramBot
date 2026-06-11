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

async function insertSalesRecord(record) {
  const result = await pool.query(
    `
      insert into sales_records (
        source_hash,
        external_id,
        customer_name,
        phone,
        address,
        purchase_name,
        purchase_date,
        transaction_count,
        quantity,
        amount,
        raw_data
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (source_hash) do nothing
      returning id
    `,
    [
      record.sourceHash,
      record.externalId,
      record.customerName,
      record.phone,
      record.address,
      record.purchaseName,
      record.purchaseDate,
      record.transactionCount,
      record.quantity,
      record.amount,
      record.rawData,
    ],
  );

  return Boolean(result.rows[0]);
}

async function findCustomerSummary(query) {
  const value = query.trim();

  const result = await pool.query(
    `
      select
        coalesce(max(customer_name), 'Unknown') as customer_name,
        max(phone) as phone,
        max(address) as address,
        max(external_id) as external_id,
        count(*)::int as rows_found,
        coalesce(sum(transaction_count), 0)::int as total_transactions,
        coalesce(sum(quantity), 0)::numeric as total_quantity,
        coalesce(sum(amount), 0)::numeric as total_amount,
        min(purchase_date)::text as first_purchase_date,
        max(purchase_date)::text as last_purchase_date,
        jsonb_agg(
          jsonb_build_object(
            'purchase_name', purchase_name,
            'purchase_date', purchase_date::text,
            'transaction_count', transaction_count,
            'quantity', quantity,
            'amount', amount
          )
          order by purchase_date desc nulls last, id desc
        ) as purchases
      from sales_records
      where phone = $1
        or external_id = $1
        or customer_name ilike $2
      group by coalesce(phone, external_id, customer_name)
      order by count(*) desc
      limit 1
    `,
    [value, `%${value}%`],
  );

  return result.rows[0] || null;
}

async function countSalesRecords() {
  const result = await pool.query(
    `
      select
        count(*)::int as total_records,
        count(distinct coalesce(phone, external_id, customer_name))::int as total_customers,
        coalesce(sum(amount), 0)::numeric as total_amount
      from sales_records
    `,
  );
  return result.rows[0];
}

module.exports = {
  pool,
  testConnection,
  insertSalesRecord,
  findCustomerSummary,
  countSalesRecords,
};
