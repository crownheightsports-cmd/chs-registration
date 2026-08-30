const { withStore } = require('./lib/blobs');

// Add new codes here as needed: CODE -> dollar amount off.
const VALID_CODES = { 'SIBLING50': 50 };
const MAX_USES_PER_EMAIL = 2; // each family/email can use a given code twice

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const code = (body.code || '').trim().toUpperCase();
    const email = (body.email || '').trim().toLowerCase();
    const action = body.action === 'redeem' ? 'redeem' : 'check'; // 'check' = look only, 'redeem' = actually consume a use

    if (!code || !email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing code or email' }) };
    }
    const discountAmount = VALID_CODES[code];
    if (!discountAmount) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'That code is not valid.' }) };
    }

    const usageKey = email + '|||' + code;

    if (action === 'redeem') {
      const result = await withStore('chs-discount-codes', event, async (store) => {
        const data = (await store.get('usage', { type: 'json' })) || {};
        const current = data[usageKey] || 0;
        if (current >= MAX_USES_PER_EMAIL) return { blocked: true, current };
        data[usageKey] = current + 1;
        await store.setJSON('usage', data);
        return { blocked: false, current: data[usageKey] };
      });
      if (result.blocked) {
        return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'This code has already been used the maximum number of times for this email.' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ valid: true, discountAmount, usesRemaining: MAX_USES_PER_EMAIL - result.current }) };
    }

    // action === 'check' — non-destructive, doesn't consume a use
    const currentCount = await withStore('chs-discount-codes', event, async (store) => {
      const data = (await store.get('usage', { type: 'json' })) || {};
      return data[usageKey] || 0;
    });
    if (currentCount >= MAX_USES_PER_EMAIL) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'This code has already been used the maximum number of times for this email.' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ valid: true, discountAmount, usesRemaining: MAX_USES_PER_EMAIL - currentCount }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
