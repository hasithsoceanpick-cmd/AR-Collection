import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

// Live / Demo. Demo is a complete separate copy of the database (schema "demo")
// and photo storage (bucket "cheques-demo"); nothing done there touches live.
const MODE_KEY = 'cc-mode';
export const IS_DEMO = typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY) === 'demo';
export const SCHEMA = IS_DEMO ? 'demo' : 'public';
export const BUCKET = IS_DEMO ? 'cheques-demo' : 'cheques';
export const db = configured ? (IS_DEMO ? supabase.schema('demo') : supabase) : null;
export function switchMode(demo) {
  localStorage.setItem(MODE_KEY, demo ? 'demo' : 'live');
  window.location.assign('/');
}

// Call a database function in the current section; throws with the database's own message.
export async function rpc(name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
// People and passwords are shared by both sections, so these always use live.
export async function rpcLive(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function uploadPhoto(collectionId, kind, blob) {
  const path = `${collectionId}/${kind}-${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

// Upload into the signed-in user's own folder (u/<user id>/…). Used for deposit
// slips and transfer receipts, which are uploaded before their record exists.
export async function uploadMine(blob, kind, ext, contentType) {
  const { data } = await supabase.auth.getUser();
  const path = `u/${data.user.id}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

// Collection with the names of everyone involved.
export const COLLECTION_SELECT = `*,
  creator:profiles!collections_created_by_fkey(full_name,email),
  driver:profiles!collections_driver_id_fkey(full_name,email)`;
