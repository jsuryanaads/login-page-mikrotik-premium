import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { createSnapTransaction, isSuccessfulNotification, verifyNotificationSignature } from './services/midtrans.js';
import { createHotspotUser } from './services/mikrotik.js';
import { dbEnabled, findOrder, initDb, saveOrder } from './services/db.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const memoryOrders = new Map();
const packages = [
  { id: '1h', name: '1 Jam', duration_minutes: 60, price: 5000, limit_uptime: '1h' },
  { id: '6h', name: '6 Jam', duration_minutes: 360, price: 10000, limit_uptime: '6h' },
  { id: '24h', name: '24 Jam', duration_minutes: 1440, price: 15000, limit_uptime: '24h' }
];

async function getOrder(orderId) {
  if (dbEnabled()) return findOrder(orderId);
  return memoryOrders.get(orderId) || null;
}

async function putOrder(order) {
  if (dbEnabled()) return saveOrder(order);
  memoryOrders.set(order.order_id, order);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'mikrotik-hotspot-payment-backend', persistence: dbEnabled() ? 'postgresql' : 'memory-development-only' }));
app.get('/api/packages', (_req, res) => res.json({ data: packages }));

function publicOrder(order) {
  return {
    order_id: order.order_id,
    package: order.package,
    amount: order.amount,
    payment_status: order.payment_status,
    provisioning_status: order.provisioning_status,
    username: order.provisioning_status === 'provisioned' ? order.username : null,
    created_at: order.created_at,
    paid_at: order.paid_at || null,
    provisioned_at: order.provisioned_at || null
  };
}

app.post('/api/orders', async (req, res) => {
  const selected = packages.find((item) => item.id === req.body?.package_id);
  if (!selected) return res.status(400).json({ ok: false, error: 'Paket tidak ditemukan.' });
  if (process.env.NODE_ENV === 'production' && !dbEnabled()) return res.status(503).json({ ok: false, error: 'Database produksi belum dikonfigurasi.' });
  const orderId = `HS-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const order = {
    order_id: orderId,
    package_id: selected.id,
    package: selected,
    username: String(req.body?.username || '').trim().slice(0, 64),
    customer_name: String(req.body?.customer_name || '').trim().slice(0, 100),
    customer_phone: String(req.body?.customer_phone || '').trim().slice(0, 32),
    amount: selected.price,
    payment_status: 'pending',
    provisioning_status: 'pending',
    created_at: new Date().toISOString()
  };
  await putOrder(order);
  res.status(201).json({ ok: true, data: publicOrder(order) });
});

app.get('/api/orders/:orderId', async (req, res) => {
  const order = await getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: 'Order tidak ditemukan.' });
  res.json({ ok: true, data: publicOrder(order) });
});

app.get('/payment/result', async (req, res) => {
  const order = await getOrder(String(req.query.order_id || ''));
  if (!order) return res.status(404).send('Order tidak ditemukan.');
  const state = order.provisioning_status === 'provisioned' ? 'AKUN HOTSPOT SIAP' : order.payment_status === 'paid' ? 'PEMBAYARAN BERHASIL' : 'MENUNGGU PEMBAYARAN';
  res.type('html').send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status Pembayaran</title><style>body{font-family:system-ui;margin:0;background:#0b1020;color:#fff;display:grid;place-items:center;min-height:100vh}.card{width:min(92%,420px);padding:28px;border:1px solid #ffffff20;border-radius:20px;background:#ffffff0d}h1{font-size:22px}code{word-break:break-all}</style></head><body><main class="card"><h1>${state}</h1><p>Order: <code>${order.order_id}</code></p><p>Status pembayaran: <strong>${order.payment_status}</strong></p><p>Status provisioning: <strong>${order.provisioning_status}</strong></p>${order.provisioning_status === 'provisioned' ? `<p>Username: <strong>${order.username}</strong></p><p>Kredensial lengkap diberikan melalui respons aktivasi yang sah.</p>` : '<p>Jika pembayaran sudah selesai, tunggu webhook payment gateway diproses.</p>'}</main></body></html>`);
});

app.post('/api/payments/create', async (req, res) => {
  const order = await getOrder(req.body?.order_id);
  if (!order) return res.status(404).json({ ok: false, error: 'Order tidak ditemukan.' });
  if (order.payment_status !== 'pending') return res.status(409).json({ ok: false, error: 'Order sudah diproses.' });
  if (!process.env.MIDTRANS_SERVER_KEY) return res.status(503).json({ ok: false, error: 'Payment gateway belum dikonfigurasi.' });
  try {
    const result = await createSnapTransaction({
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      environment: process.env.MIDTRANS_ENVIRONMENT,
      orderId: order.order_id,
      amount: order.amount,
      packageName: order.package.name,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      finishUrl: `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/payment/result?order_id=${encodeURIComponent(order.order_id)}`
    });
    order.midtrans_token = result.token;
    order.payment_url = result.redirect_url;
    await putOrder(order);
    res.json({ ok: true, data: { order_id: order.order_id, token: result.token, redirect_url: result.redirect_url } });
  } catch (error) {
    res.status(502).json({ ok: false, error: 'Gagal membuat transaksi Midtrans.', detail: error.details || undefined });
  }
});

async function provisionPaidOrder(order) {
  if (order.payment_status !== 'paid' || order.provisioning_status === 'provisioned') return order;
  if (order.provisioning_status === 'processing') return order;
  order.provisioning_status = 'processing';
  await putOrder(order);
  const username = order.username || `wifi-${crypto.randomBytes(3).toString('hex')}`;
  const password = crypto.randomBytes(6).toString('base64url').slice(0, 10);
  try {
    const result = await createHotspotUser({
      baseUrl: process.env.MIKROTIK_BASE_URL,
      routerUsername: process.env.MIKROTIK_USERNAME,
      routerPassword: process.env.MIKROTIK_PASSWORD,
      verifyTls: process.env.MIKROTIK_VERIFY_TLS !== 'false',
      username,
      password,
      profile: process.env.MIKROTIK_HOTSPOT_PROFILE || 'default',
      limitUptime: order.package.limit_uptime
    });
    order.username = username;
    order.generated_password = password;
    order.mikrotik_id = result?.['.id'] || result?.id || null;
    order.provisioning_status = 'provisioned';
    order.provisioned_at = new Date().toISOString();
    await putOrder(order);
    return order;
  } catch (error) {
    order.provisioning_status = 'failed';
    order.provisioning_error = error.message;
    await putOrder(order);
    throw error;
  }
}

app.post('/api/payments/webhook/midtrans', async (req, res) => {
  const body = req.body || {};
  if (!process.env.MIDTRANS_SERVER_KEY) return res.status(503).json({ ok: false, error: 'Payment gateway belum dikonfigurasi.' });
  if (!verifyNotificationSignature(body, process.env.MIDTRANS_SERVER_KEY)) return res.status(403).json({ ok: false, error: 'Signature tidak valid.' });
  const order = await getOrder(body.order_id);
  if (!order) return res.status(404).json({ ok: false, error: 'Order tidak ditemukan.' });
  if (Number(body.gross_amount) !== order.amount) return res.status(400).json({ ok: false, error: 'Nominal tidak cocok.' });

  order.midtrans_transaction_status = body.transaction_status;
  order.payment_type = body.payment_type || null;
  order.midtrans_transaction_id = body.transaction_id || null;
  if (isSuccessfulNotification(body)) {
    order.payment_status = 'paid';
    order.paid_at = order.paid_at || new Date().toISOString();
  } else if (['expire', 'cancel', 'deny', 'failure'].includes(body.transaction_status)) {
    order.payment_status = body.transaction_status;
  }
  await putOrder(order);

  if (order.payment_status === 'paid' && order.provisioning_status !== 'provisioned') {
    try {
      await provisionPaidOrder(order);
    } catch (error) {
      return res.status(202).json({ ok: true, payment_status: 'paid', provisioning_status: 'failed', error: error.message });
    }
  }
  res.json({ ok: true, payment_status: order.payment_status, provisioning_status: order.provisioning_status });
});

app.post('/api/hotspot/activate', async (req, res) => {
  const order = await getOrder(req.body?.order_id);
  if (!order) return res.status(404).json({ ok: false, error: 'Order tidak ditemukan.' });
  if (order.payment_status !== 'paid') return res.status(409).json({ ok: false, error: 'Pembayaran belum terverifikasi.' });
  if (order.provisioning_status === 'provisioned') return res.json({ ok: true, data: { username: order.username, password: order.generated_password } });
  try {
    const provisioned = await provisionPaidOrder(order);
    res.json({ ok: true, data: { username: provisioned.username, password: provisioned.generated_password } });
  } catch (error) {
    res.status(502).json({ ok: false, error: 'Gagal membuat akun HotSpot di MikroTik.', detail: error.message });
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

initDb().then(() => {
  app.listen(port, () => console.log(`Backend listening on port ${port}; persistence=${dbEnabled() ? 'postgresql' : 'memory-development-only'}`));
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});
