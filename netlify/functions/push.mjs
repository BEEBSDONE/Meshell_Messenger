import { getStore, getDeployStore } from '@netlify/blobs';
import { handlePush } from '../lib/web-push.mjs';

export default async function push(request, context) {
  try {
    const options = { name: 'meshell-web-push-v1', consistency: 'strong' };
    const store = context.deploy.context === 'production' ? getStore(options) : getDeployStore(options);
    return await handlePush(request, { store, waitUntil: task => context.waitUntil(task) });
  } catch {
    console.warn('Web Push storage unavailable');
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const config = {
  path: '/api/push/:action',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip'], windowSize: 60, windowLimit: 100 },
};
