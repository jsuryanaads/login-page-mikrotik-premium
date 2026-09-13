import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mikrotik-hotspot-payment-backend' });
});

app.get('/api/packages', (_req, res) => {
  // Temporary source. Move packages to the database before production.
  res.json({
    data: [
      { id: '1h', name: '1 Jam', duration_minutes: 60, price: 5000 },
      { id: '6h', name: '6 Jam', duration_minutes: 360, price: 10000 },
      { id: '24h', name: '24 Jam', duration_minutes: 1440, price: 15000 }
    ]
  });
});

app.post('/api/orders', (_req, res) => {
  res.status(501).json({ ok: false, error: 'Order service not implemented yet.' });
});

app.post('/api/payments/create', (_req, res) => {
  res.status(501).json({ ok: false, error: 'Payment gateway service not implemented yet.' });
});

app.post('/api/payments/webhook/midtrans', (_req, res) => {
  // Production implementation must verify Midtrans signature and transaction state.
  res.status(501).json({ ok: false, error: 'Webhook handler not implemented yet.' });
});

app.post('/api/hotspot/activate', (_req, res) => {
  res.status(501).json({ ok: false, error: 'MikroTik provisioning service not implemented yet.' });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
