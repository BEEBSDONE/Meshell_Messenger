import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../../public/push-worker.js', import.meta.url), 'utf8');
const origin = 'https://messenger.test';

function worker(windows = []) {
  const handlers = new Map(), shown = [], opened = [], reads = [];
  let marker;
  const indexedDB = { open() {
    const read = {};
    const database = { close() {}, transaction() {
      return { objectStore: () => ({ get(key) { reads.push(key);
        queueMicrotask(() => { read.result = marker; read.onsuccess(); }); return read;
      } }) };
    } };
    const open = { result: database };
    queueMicrotask(() => open.onsuccess());
    return open;
  } };
  const self = { location: new URL(origin), addEventListener: (name, fn) => handlers.set(name, fn),
    clients: { matchAll: async () => windows, openWindow: async path => opened.push(path) },
    registration: { showNotification: async (title, options) => shown.push([title, options.body, options.tag]) } };
  runInNewContext(script, { self, URL, indexedDB });
  return { shown, opened, reads, setMarker: value => { marker = value; },
    dispatch(name, event) {
      let task;
      handlers.get(name)({ ...event, waitUntil: promise => { task = promise; } });
      return task;
    } };
}
test('only an active matching device displays an alert and the worker reads only its push setting', async () => {
  const sw = worker();
  const push = (device, extra = {}) => sw.dispatch('push', { data: { json: () => ({ v: 1, device, ...extra }) } });
  await push('old');
  sw.setMarker({ device: 'current', active: false }); await push('current');
  sw.setMarker({ device: 'current', active: true }); await push('old');
  await push('current', { v: 2 });
  await sw.dispatch('push', { data: { json() { throw new SyntaxError(); } } });
  await push('current', { title: 'private sender', body: 'private text', url: 'https://elsewhere.test' });
  assert.deepEqual(sw.shown, [['MeShell', 'New activity in MeShell.', 'meshell-activity']]);
  assert.deepEqual([...new Set(sw.reads)], ['push-device']);
});
test('notification clicks focus MeShell or open its lock route if the last window closed', async () => {
  let focused = 0, closed = 0;
  const window = { url: origin + '/chat', focus: async () => { focused++; } };
  const stale = { url: origin + '/', focus: async () => { throw Error('closed'); } };
  const foreign = { url: 'https://elsewhere.test/', focus: () => assert.fail('foreign window') };
  const notice = { tag: 'meshell-activity', data: { url: 'https://elsewhere.test' }, close: () => { closed++; } };
  const present = worker([foreign, stale, window]);
  await present.dispatch('notificationclick', { notification: notice });
  assert.equal(focused, 1); assert.deepEqual(present.opened, []);
  const absent = worker([stale]);
  await absent.dispatch('notificationclick', { notification: notice });
  await absent.dispatch('notificationclick', { notification: { ...notice, tag: 'another-app' } });
  assert.equal(closed, 2); assert.deepEqual(absent.opened, ['/lock']);
});
