import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import List from './pages/List';
import CollectionForm from './pages/CollectionForm';
import Detail from './pages/Detail';
import Photos from './pages/Photos';
import Users from './pages/Users';
import Account from './pages/Account';

function Gate() {
  const { session, loading, role } = useAuth();
  if (loading) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!session) return <Login />;
  if (!role) return <NoAccess />;
  const canCreate = role === 'sales' || role === 'finance';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<List />} />
        {canCreate && <Route path="new" element={<CollectionForm />} />}
        <Route path="c/:id" element={<Detail />} />
        {canCreate && <Route path="c/:id/edit" element={<CollectionForm />} />}
        {role === 'finance' && <Route path="photos" element={<Photos />} />}
        {role === 'finance' && <Route path="users" element={<Users />} />}
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  if (!configured) {
    return (
      <div className="login"><div className="login-card">
        <h1>Almost ready</h1>
        <p>This site isn't connected to Supabase yet. In Netlify, add the environment variables
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then redeploy.</p>
      </div></div>
    );
  }
  return (
    <BrowserRouter>
      <AuthProvider><Gate /></AuthProvider>
    </BrowserRouter>
  );
}
