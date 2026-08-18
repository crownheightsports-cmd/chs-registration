// Creates a Stripe PaymentIntent for the registration site's checkout flow.
// Rebuilt from scratch by inspecting exactly how index.html calls this function
// and uses the response — the original source was lost, so this matches the
// confirmed contract rather than guessing at unused functionality.
//
// Contract (confirmed from 4 call sites in index.html):
//   POST body: { amount: <integer cents>, description: <string>, metadata: <flat string map> }
//   Success response: { clientSecret: "<Stripe PaymentIntent client_secret>" }
//   Error response:   { error: "<message>" }
//   Special case: amount === 0 (scholarship waitlist) is fire-and-forget on the
//   frontend — no real charge is possible below Stripe's minimum, so this skips
//   Stripe entirely and returns success without creating anything.

const Stripe = require('stripe');

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

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { amount, description, metadata, receipt_email } = body;

  if (typeof amount !== 'number' || amount < 0 || !Number.isInteger(amount)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'amount must be an integer number of cents' }) };
  }

  // Scholarship waitlist sends amount:0 as a fire-and-forget metadata log —
  // the frontend never reads this response, and Stripe won't accept a $0
  // charge anyway, so skip Stripe entirely rather than erroring pointlessly.
  if (amount === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'zero-amount request, no charge created' }) };
  }

  // Stripe's minimum charge is $0.50 (50 cents) for USD.
  if (amount < 50) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount must be at least $0.50' }) };
  }

  try {
    const stripe = Stripe(key);

    // Flatten metadata to strings — Stripe metadata values must be strings,
    // and rejects null/undefined. Also caps at Stripe's 500-char value limit.
    const safeMetadata = {};
    if (metadata && typeof metadata === 'object') {
      for (const [k, v] of Object.entries(metadata)) {
        if (v === null || v === undefined) continue;
        safeMetadata[k] = String(v).slice(0, 500);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      description: description ? String(description).slice(0, 1000) : undefined,
      metadata: safeMetadata,
      automatic_payment_methods: { enabled: true },
      // Without this, Stripe never sends a receipt for API-created payments —
      // the "Successful payments" toggle in Stripe settings only applies to
      // Stripe-hosted Checkout/Payment Links, not custom integrations like this one.
      receipt_email: receipt_email ? String(receipt_email).slice(0, 512) : undefined,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: err.message || 'Failed to create payment intent' }),
    };
  }
};
