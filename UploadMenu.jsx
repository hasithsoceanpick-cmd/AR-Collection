import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fmtDate, fmtDateTime } from '../lib/format';
import Icon from './Icon';

// One "Upload a file" button for every file finance brings in, with the date of the latest one of each.
export default function UploadMenu({ files }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  const banks = files?.banks ?? [];
  const items = [
    { to: '/bank', label: 'Bank statement', sub: banks.length ? banks.map((b) => `${b.name} to ${fmtDate(b.upto)}`).join(' · ') : 'Sampath, HNB, Amana' },
    { to: '/merchant/new', label: 'HNB merchant statement', sub: files?.merchant?.upto ? `Card batches to ${fmtDate(files.merchant.upto)}` : 'Card batches' },
    { to: '/payhere', label: 'PayHere export', sub: files?.payhere?.upto ? `Payments to ${fmtDate(files.payhere.upto)}` : 'Payments and payouts' },
    { to: '/bc-check', label: 'BC bank ledger', sub: files?.bc_bank ? `Last ${fmtDateTime(files.bc_bank)}` : 'Bank Account Ledger Entries' },
    { to: '/bc-check', label: 'BC customer ledger', sub: files?.bc_customer ? `Last ${fmtDateTime(files.bc_customer)}` : 'Detailed Cust. Ledg. Entries' },
    { to: '/customers', label: 'Customers and open invoices', sub: files?.open_invoices ? `Open invoices ${fmtDateTime(files.open_invoices)}` : 'From Business Central' },
  ];
  return (
    <div className="upmenu" ref={box}>
      <button type="button" className="top-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Icon name="upload" size={18} /><span className="top-btn-label">Upload a file</span>
      </button>
      {open && (
        <ul className="upmenu-list">
          {items.map((i) => (
            <li key={i.label}><Link to={i.to}><strong>{i.label}</strong><span>{i.sub}</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
