// Sends a fully branded Crown Heights Sports confirmation email via Resend —
// separate from Stripe's generic receipt, since Stripe's template can't
// include a WhatsApp join button or full CHS branding.
//
// Called fire-and-forget from the registration site right after a successful
// payment. A failure here should never block or break the registration itself.

const https = require('https');

function resendRequest(payload) {
  return new Promise((resolve, reject) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return reject(new Error('RESEND_API_KEY not set'));
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    let body = '';
    const req = https.request(options, res => {
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 400) return reject(new Error(parsed.message || 'Resend request failed'));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildEmailHtml({ childName, parentName, program, sessionLabel, amountLabel, planLabel, busOn, waLinks }) {
  const waButtons = (waLinks || []).map(w =>
    `<a href="${w.link}" style="display:inline-block;margin:8px 6px 0;padding:12px 22px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-family:sans-serif;font-size:14px">${escapeHtml(w.label)}</a>`
  ).join('');

  const busNote = busOn
    ? `<p style="font-family:sans-serif;font-size:13px;color:#6b6b60;margin-top:16px">🚌 Bus route details will be posted in the WhatsApp group before each game.</p>`
    : '';

  return `
  <div style="max-width:520px;margin:0 auto;font-family:sans-serif;background:#f7f5f0;padding:32px 24px">
    <div style="background:#10203C;color:#fff;padding:24px;border-radius:10px 10px 0 0;text-align:center">
      <div style="font-size:20px;font-weight:700;letter-spacing:.02em">CROWN HEIGHTS SPORTS</div>
    </div>
    <div style="background:#fff;padding:28px 24px;border-radius:0 0 10px 10px">
      <h2 style="color:#1a8f4a;margin-top:0">You're registered! 🎉</h2>
      <p style="font-size:15px;color:#1a1a18">Welcome, <strong>${escapeHtml(childName)}</strong>!</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b6b60">Program</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(program)}${sessionLabel ? ' · ' + escapeHtml(sessionLabel) : ''}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b60">Payment</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(amountLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b60">Plan</td><td style="padding:6px 0;text-align:right">${escapeHtml(planLabel)}</td></tr>
      </table>
      ${waButtons ? `<div style="margin-top:12px">${waButtons}</div>` : ''}
      ${busNote}
      <p style="font-size:13px;color:#6b6b60;margin-top:24px">Questions? WhatsApp us at <a href="https://wa.me/15166303422" style="color:#10203C">(516) 630-3422</a> or email <a href="mailto:crownheightsports@gmail.com" style="color:#10203C">crownheightsports@gmail.com</a>.</p>
      <p style="font-size:13px;color:#6b6b60">— Crown Heights Sports</p>
    </div>
  </div>`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { to, childName, program, sessionLabel, amountLabel, planLabel, busOn, waLinks } = body;
  if (!to || !childName || !program) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'to, childName, and program are required' }) };
  }

  try {
    const html = buildEmailHtml({ childName, program, sessionLabel, amountLabel, planLabel, busOn, waLinks });
    const result = await resendRequest({
      from: 'Crown Heights Sports <noreply@crownheightsports.com>',
      to: [to],
      subject: `You're registered for ${program}! 🎉`,
      html,
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch (err) {
    // A failed email should never surface as a broken registration to the
    // family — log-worthy on our end, but not something the frontend blocks on.
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
