import pg from 'pg';

const { Pool } = pg;
let pool;

export function dbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  return pool;
}

export async function initDb() {
  if (!dbEnabled()) return false;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS hotspot_orders (
      order_id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      package_json JSONB NOT NULL,
      username TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      amount INTEGER NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      provisioning_status TEXT NOT NULL DEFAULT 'pending',
      generated_password TEXT,
      midtrans_transaction_status TEXT,
      payment_type TEXT,
      midtrans_transaction_id TEXT,
      mikrotik_id TEXT,
      provisioning_error TEXT,
      midtrans_token TEXT,
      payment_url TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      paid_at TIMESTAMPTZ,
      provisioned_at TIMESTAMPTZ
    )
  `);
  return true;
}

export async function saveOrder(order) {
  await getPool().query(`
    INSERT INTO hotspot_orders (
      order_id, package_id, package_json, username, customer_name, customer_phone,
      amount, payment_status, provisioning_status, generated_password,
      midtrans_transaction_status, payment_type, midtrans_transaction_id, mikrotik_id,
      provisioning_error, midtrans_token, payment_url, created_at, paid_at, provisioned_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    ON CONFLICT (order_id) DO UPDATE SET
      package_id=EXCLUDED.package_id, package_json=EXCLUDED.package_json, username=EXCLUDED.username,
      customer_name=EXCLUDED.customer_name, customer_phone=EXCLUDED.customer_phone, amount=EXCLUDED.amount,
      payment_status=EXCLUDED.payment_status, provisioning_status=EXCLUDED.provisioning_status,
      generated_password=EXCLUDED.generated_password, midtrans_transaction_status=EXCLUDED.midtrans_transaction_status,
      payment_type=EXCLUDED.payment_type, midtrans_transaction_id=EXCLUDED.midtrans_transaction_id,
      mikrotik_id=EXCLUDED.mikrotik_id, provisioning_error=EXCLUDED.provisioning_error,
      midtrans_token=EXCLUDED.midtrans_token, payment_url=EXCLUDED.payment_url,
      paid_at=EXCLUDED.paid_at, provisioned_at=EXCLUDED.provisioned_at
  `, [
    order.order_id, order.package_id, JSON.stringify(order.package), order.username || null,
    order.customer_name || null, order.customer_phone || null, order.amount,
    order.payment_status, order.provisioning_status, order.generated_password || null,
    order.midtrans_transaction_status || null, order.payment_type || null,
    order.midtrans_transaction_id || null, order.mikrotik_id || null,
    order.provisioning_error || null, order.midtrans_token || null, order.payment_url || null,
    order.created_at, order.paid_at || null, order.provisioned_at || null
  ]);
}

export async function findOrder(orderId) {
  const { rows } = await getPool().query('SELECT * FROM hotspot_orders WHERE order_id = $1', [orderId]);
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    order_id: row.order_id,
    package_id: row.package_id,
    package: row.package_json,
    username: row.username || '',
    customer_name: row.customer_name || '',
    customer_phone: row.customer_phone || '',
    amount: row.amount,
    payment_status: row.payment_status,
    provisioning_status: row.provisioning_status,
    generated_password: row.generated_password || null,
    midtrans_transaction_status: row.midtrans_transaction_status || null,
    payment_type: row.payment_type || null,
    midtrans_transaction_id: row.midtrans_transaction_id || null,
    mikrotik_id: row.mikrotik_id || null,
    provisioning_error: row.provisioning_error || null,
    midtrans_token: row.midtrans_token || null,
    payment_url: row.payment_url || null,
    created_at: row.created_at,
    paid_at: row.paid_at,
    provisioned_at: row.provisioned_at
  };
}
