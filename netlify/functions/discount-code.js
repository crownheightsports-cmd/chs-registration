import { getStore } from '@netlify/blobs';

// Regular discount codes: CODE -> dollar amount off.
const VALID_CODES = { 'SIBLING50': 50 };

// Scholarship codes: CODE -> donor name. These don't discount a price —
// they mark a registration as fully donor-covered ($0 charged). Unlike a
// discount, using one does NOT immediately activate the registration: it
// creates a pending request that an admin must approve on the dashboard
// first. That approval step is the safety net — if a scholarship code ever
// leaks or gets guessed, nobody gets a free active registration without an
// admin seeing and approving it first.
const SCHOLARSHIP_CODES = { 'CHSCHOLAR': 'General Scholarship Fund' };

const MAX_USES_PER_EMAIL = 2; // each family/email can use a given code twice

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const body = await req.json();
    const code = (body.code || '').trim().toUpperCase();
    const email = (body.email || '').trim().toLowerCase();
    const action = body.action === 'redeem' ? 'redeem' : 'check'; // 'check' = look only, 'redeem' = actually consume a use

    if (!code || !email) {
      return new Response(JSON.stringify({ error: 'Missing code or email' }), { status: 400, headers });
    }

    const isDiscount = Object.prototype.hasOwnProperty.call(VALID_CODES, code);
    const isScholarship = Object.prototype.hasOwnProperty.call(SCHOLARSHIP_CODES, code);
    if (!isDiscount && !isScholarship) {
      return new Response(JSON.stringify({ valid: false, reason: 'That code is not valid.' }), { status: 200, headers });
    }

    const store = getStore('chs-discount-codes');
    const usageKey = email + '|||' + code;

    const buildResult = (usesRemaining) => isScholarship
      ? { valid: true, type: 'scholarship', donorName: SCHOLARSHIP_CODES[code], usesRemaining }
      : { valid: true, type: 'discount', discountAmount: VALID_CODES[code], usesRemaining };

    if (action === 'redeem') {
      const data = (await store.get('usage', { type: 'json' })) || {};
      const current = data[usageKey] || 0;
      if (current >= MAX_USES_PER_EMAIL) {
        return new Response(JSON.stringify({ valid: false, reason: 'This code has already been used the maximum number of times for this email.' }), { status: 200, headers });
      }
      data[usageKey] = current + 1;
      await store.setJSON('usage', data);
      return new Response(JSON.stringify(buildResult(MAX_USES_PER_EMAIL - data[usageKey])), { status: 200, headers });
    }

    // action === 'check' — non-destructive, doesn't consume a use
    const data = (await store.get('usage', { type: 'json' })) || {};
    const currentCount = data[usageKey] || 0;
    if (currentCount >= MAX_USES_PER_EMAIL) {
      return new Response(JSON.stringify({ valid: false, reason: 'This code has already been used the maximum number of times for this email.' }), { status: 200, headers });
    }
    return new Response(JSON.stringify(buildResult(MAX_USES_PER_EMAIL - currentCount)), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
