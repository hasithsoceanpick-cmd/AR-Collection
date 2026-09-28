import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;
export const BUCKET = 'cheques';

// Call a database function; throws with the database's own message.
export async function rpc(name, args = {}) {
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
