const { connectLambda, getStore } = require('@netlify/blobs');

function openStore(name, event) {
  if (!event || !event.blobs) {
    throw new Error('Netlify Blobs credentials were not present on the function event (event.blobs missing).');
  }
  connectLambda(event);
  return getStore({ name, consistency: 'strong' });
}

async function withStore(name, event, fn) {
  const store = openStore(name, event);
  return fn(store);
}

module.exports = { openStore, withStore };
