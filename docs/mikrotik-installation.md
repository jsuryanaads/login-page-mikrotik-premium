# MikroTik Installation

## Portal files
Upload the contents of `hotspot/` to the MikroTik Hotspot HTML directory (commonly `hotspot/`).

## Required pages
- `login.html`
- `status.html`
- `logout.html`
- `error.html`
- `css/style.css`
- `js/app.js`

## Important
The current prototype uses MikroTik Hotspot template variables in the HTML. CHAP/password handling must be validated against the target RouterOS version before production use. Payment processing must remain outside the captive portal and use a backend with verified webhooks.
