// Stripe webhook — fires every time a subscription invoice is paid (month 1,
// month 2, month 3, etc.) and copies the Subscription's metadata (child_name,
// program, grade, etc.) onto that invoice's actual PaymentIntent.
//
// Why this exists: setting metadata on a Subscription at creation time does
// NOT automatically carry over to the PaymentIntent behind each month's
// actual charge. Without this, the dashboard — which reads PaymentIntent
// metadata to identify families — would never see ANY subscription-based
// payment, including the very first one.
//
// Configure in Stripe: Developers → Webhooks → Add endpoint, pointing at
// this function's URL, listening for the "invoice.payment_succeeded" event.
// The signing secret Stripe gives you goes in STRIPE_WEBHOOK_SECRET.

const Stripe = require('stripe');

exports.handler = async (event) => {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!key || !webhookSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe keys not configured' }) };
  }

  const stripe = Stripe(key);
  const signature = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    // Signature verification needs the exact raw body Stripe sent — not a
    // re-serialized/parsed version, or verification will fail.
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: `Webhook signature verification failed: ${err.message}` }) };
  }

  try {
    if (stripeEvent.type === 'invoice.payment_succeeded' || stripeEvent.type === 'invoice.paid') {
      const invoice = stripeEvent.data.object;

      // Only subscription invoices need this — one-time PaymentIntents
      // (pay-in-full, trials) already get their metadata set directly at creation.
      if (invoice.subscription && invoice.payment_intent) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        if (subscription.metadata && Object.keys(subscription.metadata).length) {
          await stripe.paymentIntents.update(invoice.payment_intent, {
            metadata: subscription.metadata,
          });
        }
      }
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    // Returning 200 even on an internal error here is intentional — Stripe
    // will retry a failing webhook repeatedly, and a real failure here
    // shouldn't ever affect whether the family's actual payment succeeded.
    console.error('Webhook processing error:', err);
    return { statusCode: 200, body: JSON.stringify({ received: true, warning: err.message }) };
  }
};
