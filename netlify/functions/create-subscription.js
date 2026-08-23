// Creates a Stripe Subscription for monthly-plan registrations, so Stripe
// itself handles charging months 2 through N automatically (including
// retries on failed cards) — instead of relying on a single one-time
// PaymentIntent that only ever covers month 1.
//
// Lump-sum (pay-in-full) and trial-class payments do NOT use this function —
// those stay as simple one-time PaymentIntents via create-payment-intent.js,
// since there's nothing recurring about them.
//
// Flow: create/reuse a Stripe Customer → create a Subscription with
// payment_behavior:'default_incomplete' → return the first invoice's
// PaymentIntent client_secret, confirmed client-side exactly like a normal
// one-time payment. Stripe automatically saves the card for the following
// months' off-session charges once that first payment succeeds.

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

  const { email, name, monthlyAmount, description, metadata, totalPayments } = body;

  if (!email || typeof monthlyAmount !== 'number' || !Number.isInteger(monthlyAmount) || monthlyAmount < 50) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email and a valid monthlyAmount (integer cents, at least 50) are required' }) };
  }
  const totalCycles = Number.isInteger(totalPayments) && totalPayments > 0 ? totalPayments : 8;

  try {
    const stripe = Stripe(key);

    // Reuse an existing Customer for this email if one exists, so a family
    // registering for a second program doesn't end up with duplicate Customers.
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data.length
      ? existing.data[0]
      : await stripe.customers.create({ email, name });

    const safeMetadata = {};
    if (metadata && typeof metadata === 'object') {
      for (const [k, v] of Object.entries(metadata)) {
        if (v === null || v === undefined) continue;
        safeMetadata[k] = String(v).slice(0, 500);
      }
    }
    safeMetadata.total_payments = String(totalCycles);

    // Stop billing right after the Nth payment — one now, plus (N-1) more
    // monthly renewals — rather than continuing indefinitely.
    const now = new Date();
    const cancelAt = new Date(now);
    cancelAt.setMonth(cancelAt.getMonth() + totalCycles);
    const cancelAtUnix = Math.floor(cancelAt.getTime() / 1000);

    // Stripe's Subscriptions API doesn't support creating a Product inline via
    // price_data.product_data the way Checkout Sessions do — it needs a real
    // Product created first, then referenced by ID.
    const product = await stripe.products.create({
      name: description || 'Crown Heights Sports — Monthly Plan',
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{
        price_data: {
          currency: 'usd',
          product: product.id,
          unit_amount: monthlyAmount,
          recurring: { interval: 'month' },
        },
      }],
      cancel_at: cancelAtUnix,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: safeMetadata,
      expand: ['latest_invoice.payment_intent'],
    });

    const clientSecret = subscription.latest_invoice && subscription.latest_invoice.payment_intent
      ? subscription.latest_invoice.payment_intent.client_secret
      : null;

    if (!clientSecret) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Subscription created but no payment intent was returned' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret, subscriptionId: subscription.id, customerId: customer.id }),
    };
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: err.message || 'Failed to create subscription' }) };
  }
};
