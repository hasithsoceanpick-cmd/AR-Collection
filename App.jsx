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
import CustomerData from './pages/CustomerData';
import TransferForm from './pages/TransferForm';
import Deposits from './pages/Deposits';
import Reports from './pages/Reports';
import Bank from './pages/Bank';
import Chat from './pages/Chat';
import Backup from './pages/Backup';
import More from './pages/More';
import Overview from './pages/Overview';
import BcExport from './pages/BcExport';
import BcCheck from './pages/BcCheck';
import BankRec from './pages/BankRec';
import AdminOverview from './pages/AdminOverview';
import { CashList, CashForm, CashDetail, CashReceipt } from './pages/Cash';
import { MerchantPage, MerchantStatement, MerchantAdd } from './pages/Merchant';
import CardForm from './pages/CardForm';
import NotInBc from './pages/NotInBc';
import Aging from './pages/Aging';
import CustomerList from './pages/CustomerList';
import CustomerPage from './pages/CustomerPage';
import PayHerePage from './pages/PayHere';
import Today from './pages/Today';
import MoneyIn from './pages/MoneyIn';
import BcClose from './pages/BcClose';
import Settings from './pages/Settings';
import FollowUp from './pages/FollowUp';
import FollowUpPromises from './pages/FollowUpPromises';
import FollowUpOwners from './pages/FollowUpOwners';

function Gate() {
  const { session, loading, role, isAdmin } = useAuth();
  if (loading) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!session) return <Login />;
  if (!role) return <NoAccess />;
  const canCreate = role === 'sales' || role === 'finance';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={role === 'executive' ? <Overview /> : role === 'finance' ? <Today /> : <List />} />
        <Route path="collections" element={<List />} />
        {(role === 'finance' || role === 'executive') && <Route path="overview" element={<Overview />} />}
        {role === 'finance' && <Route path="bc-export" element={<BcExport />} />}
        {role === 'finance' && <Route path="bc" element={<Navigate to="/bc-export" replace />} />}
        {role === 'finance' && <Route path="bc-close" element={<BcClose />} />}
        {role === 'finance' && <Route path="money-in" element={<MoneyIn />} />}
        {role === 'finance' && <Route path="settings" element={<Settings />} />}
        {role === 'finance' && <Route path="followup" element={<FollowUp />} />}
        {role === 'finance' && <Route path="followup/promises" element={<FollowUpPromises />} />}
        {role === 'finance' && <Route path="followup/owners" element={<FollowUpOwners />} />}
        {(role === 'finance' || role === 'executive') && <Route path="bc-check" element={<BcCheck />} />}
        {(role === 'finance' || role === 'executive') && <Route path="bank-rec" element={<BankRec />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="cash" element={<CashList />} />}
        {role === 'sales' && <Route path="cash/new" element={<CashForm />} />}
        {role === 'sales' && <Route path="cash/:id/edit" element={<CashForm />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="cash/:id" element={<CashDetail />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="cash/:id/receipt" element={<CashReceipt />} />}
        {canCreate && <Route path="new" element={<CollectionForm />} />}
        <Route path="c/:id" element={<Detail />} />
        {canCreate && <Route path="c/:id/edit" element={<CollectionForm />} />}
        {canCreate && <Route path="customers" element={<CustomerData />} />}
        {canCreate && <Route path="transfer" element={<TransferForm />} />}
        {canCreate && <Route path="card" element={<CardForm />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="merchant" element={<MerchantPage />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="merchant/s/:id" element={<MerchantStatement />} />}
        {role === 'finance' && <Route path="merchant/new" element={<MerchantAdd />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="payhere" element={<PayHerePage />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="not-in-bc" element={<NotInBc />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="aging" element={<Aging />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="customer-list" element={<CustomerList />} />}
        {['sales', 'finance', 'executive'].includes(role) && <Route path="customer/:no" element={<CustomerPage />} />}
        {(role === 'driver' || role === 'finance' || role === 'executive') && <Route path="deposits" element={<Deposits />} />}
        <Route path="reports" element={<Reports />} />
        {role === 'finance' && <Route path="bank" element={<Bank />} />}
        <Route path="more" element={<More />} />
        <Route path="chat" element={<Chat />} />
        {role === 'finance' && isAdmin && <Route path="backup" element={<Backup />} />}
        {role === 'finance' && isAdmin && <Route path="admin" element={<AdminOverview />} />}
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
        <span className="brand-bars big" aria-hidden="true"><i /><i /><i /></span>
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
