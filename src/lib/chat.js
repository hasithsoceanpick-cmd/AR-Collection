import { useEffect, useState } from 'react';
import { supabase, rpcLive } from './supabase';

// The team chat is shared by Live and Demo: it always uses the live tables and photo storage.
export const CHAT_BUCKET = 'cheques';

export async function uploadChatImage(blob) {
  const { data } = await supabase.auth.getUser();
  const path = `u/${data.user.id}/chat-${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Screenshot upload failed: ${error.message}`);
  return path;
}

// Unread count for the menu, shared by every component that shows it.
let count = 0;
let started = false;
const listeners = new Set();
export async function refreshChatUnread() {
  try { count = Number(await rpcLive('cc_chat_unread')) || 0; } catch { count = 0; }
  listeners.forEach((f) => f(count));
}
function start() {
  if (started) return;
  started = true;
  refreshChatUnread();
  supabase.channel('chat-unread')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => refreshChatUnread())
    .subscribe();
  setInterval(refreshChatUnread, 120000);
}
export function useChatUnread() {
  const [n, setN] = useState(count);
  useEffect(() => { start(); listeners.add(setN); setN(count); return () => { listeners.delete(setN); }; }, []);
  return n;
}
