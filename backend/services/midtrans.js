import crypto from 'node:crypto';

export function midtransBaseUrl(environment = process.env.MIDTRANS_ENVIRONMENT) {
  return environment === 'production'
    ? 'https://app.midtrans.com'
    : 'https://app.sandbox.midtrans.com';
}

function authHeader(serverKey) {
  return `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;
}

export function verifyNotificationSignature(body, serverKey) {
  const raw = `${body.order_id}${body.status_code}${body.gross_amount}${serverKey}`;
  const expected = crypto.createHash('sha512').update(raw).digest('hex');
  const received = String(body.signature_key || '').toLowerCase();
  if (!received || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function isSuccessfulNotification(body) {
  return body.status_code === '200' &&
    ['settlement', 'capture'].includes(body.transaction_status) &&
    (!body.fraud_status || body.fraud_status === 'accept');
}

export async function createSnapTransaction({ serverKey, environment, orderId, amount, packageName, customerName, customerPhone, finishUrl }) {
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY is not configured');
  const payload = {
    transaction_details: { order_id: orderId, gross_amount: amount },
    customer_details: {
      first_name: customerName || 'Hotspot Customer',
      ...(customerPhone ? { phone: customerPhone } : {})
    },
    item_details: [{ id: orderId, price: amount, quantity: 1, name: `Hotspot ${packageName}` }],
    ...(finishUrl ? { callbacks: { finish: finishUrl } } : {})
  };

  const response = await fetch(`${midtransBaseUrl(environment)}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(serverKey),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Midtrans transaction creation failed');
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}
