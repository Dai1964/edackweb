const path = require('path');
const fs = require('fs');
const express = require('express');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// DATA_DIR defaults to a local folder for dev; on Railway it's pointed at
// the mounted volume so enquiries survive a redeploy (the container's own
// disk is wiped on every deploy, the volume isn't).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ENQUIRIES_FILE = path.join(DATA_DIR, 'enquiries.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ENQUIRIES_FILE)) {
  fs.writeFileSync(ENQUIRIES_FILE, '[]');
}

// Only set if RESEND_API_KEY is configured — lets the form keep working
// (saving to enquiries.json) even before the key is added on Railway.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendEnquiryNotification(entry) {
  if (!resend) {
    console.warn('[Resend] RESEND_API_KEY not set — skipping email notification.');
    return;
  }
  const text = `New business enquiry received:

Name: ${entry.name}
Business name: ${entry.business}
Trade/Industry: ${entry.trade}
Phone: ${entry.phone}
Email: ${entry.email}
Message: ${entry.message}
Time: ${entry.timestamp}`;

  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: 'edack.david@gmail.com',
    subject: 'New EdackWeb Business Enquiry',
    text: text
  });
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.post('/api/enquiry', async (req, res) => {
  const { name, business, trade, phone, email, message } = req.body || {};

  if (!name || !business || !trade || !phone || !email) {
    return res.status(400).json({ ok: false, error: 'Please fill in all required fields.' });
  }

  const entry = {
    name: String(name).trim(),
    business: String(business).trim(),
    trade: String(trade).trim(),
    phone: String(phone).trim(),
    email: String(email).trim(),
    message: String(message || '').trim(),
    timestamp: new Date().toISOString()
  };

  let enquiries = [];
  try {
    enquiries = JSON.parse(fs.readFileSync(ENQUIRIES_FILE, 'utf8'));
  } catch (err) {
    enquiries = [];
  }
  enquiries.push(entry);

  try {
    fs.writeFileSync(ENQUIRIES_FILE, JSON.stringify(enquiries, null, 2));
  } catch (err) {
    console.error('Failed to save enquiry:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong saving your details. Please try again.' });
  }

  console.log('[Business enquiry]', entry);

  // The enquiry is already safely on disk at this point — an email hiccup
  // (bad key, Resend outage, etc.) must never turn into a failed submission
  // for the person filling in the form.
  try {
    await sendEnquiryNotification(entry);
  } catch (err) {
    console.error('[Resend] Failed to send notification email:', err);
  }

  res.status(201).json({ ok: true, name: entry.name });
});

// No catch-all here on purpose: express.static already serves
// public/index.html for "/" by default, and this site has no other pages
// or client-side routes to fall back for. A blanket app.get('*', ...) would
// return 200-with-index.html for *any* path — including /server.js and
// /package.json — which defeats the point of restricting static serving
// to public/ in the first place.

app.listen(PORT, () => {
  console.log(`EdackWeb landing page running on port ${PORT}`);
});
