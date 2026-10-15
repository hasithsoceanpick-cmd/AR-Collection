// Writes exported documents in the exact column order of the Business Central
// Cash Receipt Journal (Cash_Receipt_Journals.xlsx), so a paste lines up.
export const JOURNAL_COLUMNS = [
  'Batch Name', 'Posting Date', 'Document Type', 'Document No.', 'External Document No.', 'Account Type', 'Account No.',
  'Account Name', 'Description', 'Amount', 'Amount (LCY)', 'Debit Amount', 'Credit Amount', 'Bal. Account Type',
  'Bal. Account No.', 'Bal. Account Name', 'Applied (Yes/No)', 'Applies-to Doc. Type', 'Applies-to Doc. No.', 'Correction',
  'Comment', 'Batch Code', 'Class Code', 'Cage Code', 'Capitalwip Code', 'Country Code', 'Staff-loan Code', 'Division Code',
  'Reqwor Code', 'NumberOfJournalRecords', 'Balance', 'Total Balance',
];

const ddmmyyyy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;

// One row per journal line. Amount is negative (credit to the customer);
// Debit Amount is left blank, Credit Amount is the positive value.
export function journalRows(docs) {
  const out = [];
  for (const d of docs) {
    for (const l of d.lines ?? []) {
      const amt = r2(l.amount);
      out.push([
        '', ddmmyyyy(d.posting_date), 'Payment', d.doc_no, l.ext_doc_no ?? '', l.account_type, l.account_no, l.account_name ?? '',
        l.description, amt, amt, amt > 0 ? amt : '', amt < 0 ? -amt : '', d.bal_type ?? 'Bank Account', d.bc_code ?? '', d.bc_name ?? '',
        l.applied ? 'Yes' : 'No', l.applied ? 'Invoice' : '', l.applies_doc_no ?? '', 'No', l.comment ?? '',
        '', '', '', '', '', '', '', '', '', '', '',
      ]);
    }
  }
  return out;
}

export async function downloadJournal(docs, fileName) {
  const XLSX = await import('xlsx');
  const rows = journalRows(docs);
  const ws = XLSX.utils.aoa_to_sheet([JOURNAL_COLUMNS, ...rows]);
  // Text stays text (cheque numbers keep their leading zeros; dates stay dd/mm/yyyy).
  for (let r = 1; r <= rows.length; r++) {
    for (const c of [1, 3, 4, 6, 18]) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref]) { ws[ref].t = 's'; ws[ref].v = String(ws[ref].v); }
    }
  }
  ws['!cols'] = JOURNAL_COLUMNS.map((h, i) => ({ wch: [1, 3, 4, 6, 9, 10, 11, 12].includes(i) ? 14 : i === 7 || i === 8 || i === 15 || i === 20 ? 32 : 12 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cash Receipt Journals');
  XLSX.writeFile(wb, fileName);
}

// Tab-separated lines (no header) for pasting straight into the BC journal page.
export const journalText = (docs) => journalRows(docs).map((r) => r.join('\t')).join('\r\n');
