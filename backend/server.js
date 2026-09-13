import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { createSnapTransaction, isSuccessfulNotification, verifyNotificationSignature } from './services/midtrans.js';
import { createHotspotUser } from './services/mikrotik.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const orders = new Map();
const packages = [
  { id: '1h', name: '1 Jam', duration_minutes: 60, price: 5000, limit_uptime: '1h' },
  { id: '6h', name: '6 Jam', duration_minutes: 360, price: 10000, limit_uptime: '6h' },
  { id: '24h', name: '24 Jam', duration_minutes: 1440, price: 15000, limit_uptime: '24h' }
];

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'mikrotik-hotspot-payment-backend' }));
app.get('/api/packages', (_req, res) => res.json({ data: packages }));

app.post('/api/orders', (req, res) => {
  const selected = packages.find((item) => item.id === req.body?.package_id);
  if (!selected) return res.status(400).json({ ok: false, error: 'Paket tidak ditemukan.' });
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
  orders.set(orderId, order);
  res.status(201).json({ ok: true, data: { order_id: orderId, package: selected, amount: selected.price, status: order.payment_status } });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: 'Order tidak ditemukan.' });
  res.json({ ok: true, data: order });
});

app.post('/api/payments/create', async (req, res) => {
  const order = orders.get(req.body?.order_id);
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
    orders.set(order.order_id, order);
    res.json({ ok: true, data: { order_id: order.order_id, token: result.token, redirect_url: result.redirect_url } });
  } catch (error) {
    res.status(502).json({ ok: false, error: 'Gagal membuat transaksi Midtrans.', detail: error.details || undefined });
  }
});

async function provisionPaidOrder(order) {
  if (order.payment_status !== 'paid' || order.provisioning_status === 'provisioned') return order;
  order.provisioning_status = 'processing';
  orders.set(order.order_id, order);
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
    orders.set(order.order_id, order);
    return order;
  } catch (error) {
    order.provisioning_status = 'failed';
    order.provisioning_error = error.message;
    orders.set(order.order_id, order);
    throw error;
  }
}

app.post('/api/payments/webhook/midtrans', async (req, res) => {
  const body = req.body || {};
  if (!process.env.MIDTRANS_SERVER_KEY) return res.status(503).json({ ok: false, error: 'Payment gateway belum dikonfigurasi.' });
  if (!verifyNotificationSignature(body, process.env.MIDTRANS_SERVER_KEY)) return res.status(403).json({ ok: false, error: 'Signature tidak valid.' });
  const order = orders.get(body.order_id);
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
  orders.set(order.order_id, order);

  if (order.payment_status === 'paid') {
    try {
      await provisionPaidOrder(order);
    } catch (error) {
      return res.status(202).json({ ok: true, payment_status: 'paid', provisioning_status: 'failed', error: error.message });
    }
  }
  res.json({ ok: true, payment_status: order.payment_status, provisioning_status: order.provisioning_status });
});

app.post('/api/hotspot/activate', async (req, res) => {
  const order = orders.get(req.body?.order_id);
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
app.listen(port, () => console.log(`Backend listening on port ${port}`));
