import { useCallback, useEffect, useRef, useState } from 'react';
import { findInbox } from '../utils/inboxRelays';
import { pendingMessage, reserveMessage, updatePending } from '../utils/messageOutbox';
import { openPrivateMessage, prepareMessage, type Account, type PrivateDraft } from '../utils/privateMessages';
import { publishConfirmed } from '../utils/nostr';
import type { Event } from 'nostr-tools/pure';
import type { InboxRelays } from './useDefaultInbox';

export default function useSendMessage(account: Account, peer: string, configured: string[],
  inbox: InboxRelays, accept: (event: Event) => void) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<PrivateDraft>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const active = useRef(true), sending = useRef(false);
  useEffect(() => {
    active.current = true;
    let current = true;
    pendingMessage(account.pk, peer).then(saved => {
      if (!current || !saved) return;
      const own = openPrivateMessage(saved.toSelf, account);
      if (!own || own.peer !== peer) return;
      setDraft(saved); setText(own.rumor.content);
      setError(saved.delivered ? 'Your contact’s relay accepted the message. Retry to save your inbox copy.' : 'Your previous send is ready to retry.');
    }).catch(() => { if (current) setError('Your pending messages could not be opened.'); })
      .finally(() => { if (current) setRestoring(false); });
    return () => { current = false; active.current = false; };
  }, [account, peer]);

  function send() {
    if (!text.trim() || sending.current || waiting || restoring) return;
    setError('');
    if (inbox.urls.length) { void deliver(); return; }
    if (inbox.hasList || !configured.length) { setError(inbox.issue); return; }
    if (inbox.issue) inbox.retrySetup();
    setWaiting(true);
  }
  const { urls, readRelays, signAuth } = inbox;
  const deliver = useCallback(async () => {
    const content = text.trim();
    if (!content || sending.current || restoring) return;
    sending.current = true; setBusy(true); setError('');
    let current = draft;
    try {
      let destinations = urls;
      if (peer !== account.pk && !current?.delivered) {
        destinations = await findInbox(peer, readRelays, configured, signAuth);
        if (!destinations.length) throw Error('No NIP-17 inbox was found for this contact. Ask them to publish their inbox relays, then retry.');
      }
      if (!current) {
        if (!active.current) return;
        current = await reserveMessage(account.pk, prepareMessage(account, peer, content));
        if (active.current) setDraft(current);
        const saved = openPrivateMessage(current.toSelf, account);
        if (!saved || saved.peer !== peer) throw Error('Your pending message could not be opened.');
        if (saved.rumor.content !== content) {
          if (active.current) setText(saved.rumor.content);
          throw Error('Another tab has a pending message here. Finish it before sending another.');
        }
      }
      if (!current.delivered) {
        await publishConfirmed(destinations, current.toPeer, signAuth).catch(() => {
          throw Error('No relay confirmed this message. Your draft is ready to retry.');
        });
        current = { ...current, delivered: true };
        if (active.current) setDraft(current);
        await updatePending(account.pk, current, 'delivered');
      }
      if (peer !== account.pk) {
        await publishConfirmed(urls, current.toSelf, signAuth).catch(() => {
          throw Error('Your contact’s relay accepted the message. Retry to save your inbox copy.');
        });
      }
      accept(current.toSelf);
      await updatePending(account.pk, current, 'complete');
      if (active.current) { setDraft(undefined); setText(''); }
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : 'Sending failed. Your draft is ready to retry.');
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }, [account, peer, configured, urls, readRelays, signAuth, text, draft, restoring, accept]);
  useEffect(() => {
    if (!waiting || (!urls.length && !inbox.issue)) return;
    setWaiting(false);
    if (urls.length) void deliver();
    else setError(inbox.issue);
  }, [waiting, urls.length, inbox.issue, deliver]);

  async function discard() {
    if (!draft || draft.delivered || sending.current) return;
    try {
      await updatePending(account.pk, draft, 'discard');
      if (active.current) { setDraft(undefined); setError(''); }
    } catch { if (active.current) setError('Could not update your pending message. Please retry.'); }
  }
  return { text, setText, busy: busy || waiting, waiting, restoring, draft, error, send, discard };
}
