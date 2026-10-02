import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, rpcLive } from './supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  const loadProfile = useCallback(async () => {
    if (!userId) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile(data ?? null);
  }, [userId]);

  // Reload the profile only when the signed-in user changes (not on token refresh).
  const ready = session !== undefined;
  useEffect(() => {
    if (!ready) return;
    setProfile(undefined);
    loadProfile();
  }, [ready, loadProfile]);

  const value = {
    session,
    profile,
    loading: session === undefined || (session && profile === undefined),
    // Finance Admins work in a chosen view; the database checks permissions the same way.
    role: profile?.active ? (profile.is_admin && profile.acting_role ? profile.acting_role : profile.role) : null,
    baseRole: profile?.active ? profile.role : null,
    isAdmin: Boolean(profile?.active && profile?.is_admin),
    actingRole: profile?.is_admin ? profile.acting_role ?? null : null,
    setView: async (r) => { await rpcLive('cc_set_acting_role', { p_role: r || '' }); window.location.assign('/'); },
    reloadProfile: loadProfile,
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
