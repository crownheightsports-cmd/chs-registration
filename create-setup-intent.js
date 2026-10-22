// Waitlist ("opt-out spot pending"): saves the family's card WITHOUT charging it.
// Creates (or reuses) a Stripe Customer and a SetupIntent for future off-session
// charges. The dashboard charges the saved card later, only when an admin
// accepts the family off the waitlist.
//
// POST { email, name, metadata } -> { clientSecret, customerId }

const Stripe = require('stripe');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { email, name, metadata } = body;
  if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'email is required' }) };

  try {
    const stripe = Stripe(key);
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data.length ? existing.data[0] : await stripe.customers.create({ email, name });

    const safeMetadata = { waitlist: 'yes' };
    if (metadata && typeof metadata === 'object') {
      for (const [k, v] of Object.entries(metadata)) {
        if (v === null || v === undefined) continue;
        safeMetadata[k] = String(v).slice(0, 500);
      }
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: safeMetadata,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ clientSecret: setupIntent.client_secret, customerId: customer.id }) };
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: err.message || 'Failed to save card' }) };
  }
};
