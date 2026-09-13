const form = document.getElementById('loginForm');
const message = document.getElementById('message');
const packages = document.getElementById('packages');
const showPackages = document.getElementById('showPackages');
const apiBase = (window.HOTSPOT_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');

showPackages.addEventListener('click', () => {
  packages.hidden = !packages.hidden;
  showPackages.textContent = packages.hidden ? 'BELI PAKET INTERNET' : 'SEMBUNYIKAN PAKET';
});

async function startPayment(packageId) {
  if (!apiBase) {
    message.textContent = 'Payment backend belum dikonfigurasi.';
    return;
  }
  message.textContent = 'Menyiapkan pembayaran...';
  try {
    const orderResponse = await fetch(`${apiBase}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_id: packageId })
    });
    const order = await orderResponse.json();
    if (!orderResponse.ok || !order.ok) throw new Error(order.error || 'Order gagal dibuat.');

    const paymentResponse = await fetch(`${apiBase}/api/payments/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.data.order_id })
    });
    const payment = await paymentResponse.json();
    if (!paymentResponse.ok || !payment.ok) throw new Error(payment.error || 'Pembayaran gagal dibuat.');
    window.location.href = payment.data.redirect_url;
  } catch (error) {
    message.textContent = error.message || 'Tidak dapat memulai pembayaran.';
  }
}

document.querySelectorAll('[data-package]').forEach((btn) => {
  btn.addEventListener('click', () => startPayment(btn.dataset.packageId));
});
