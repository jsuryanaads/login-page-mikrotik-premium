# Payment Backend

Backend skeleton for the MikroTik HotSpot payment flow.

## Security boundary

- `hotspot/` is the captive-portal frontend and may be copied to MikroTik.
- `backend/` runs on a server and owns payment secrets, database access, and MikroTik credentials.
- Never put `MIDTRANS_SERVER_KEY`, MikroTik passwords, or database credentials in HTML/CSS/JS.

## Planned flow

`HotSpot -> POST /api/orders -> POST /api/payments/create -> Midtrans -> webhook -> verify -> MikroTik provisioning`

The current endpoints are intentionally stubs. No payment is treated as successful and no MikroTik user is provisioned yet.
