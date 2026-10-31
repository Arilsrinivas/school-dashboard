import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, DollarSign, Download, Filter, Plus, Printer, RefreshCw, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { request, type User } from './api';

type FeeCategory = {
  id: string;
  name: string;
  category_type: 'tuition' | 'transport' | 'examination' | 'custom';
};

type FeeStructure = {
  id: string;
  category_id: string;
  category_name: string;
  category_type: string;
  academic_year_id: string;
  academic_year_name: string;
  amount_minor: number | string;
  currency: string;
  due_on: string | null;
  description: string;
};

type StudentFeeRow = {
  id: string;
  fee_structure_id: string;
  category_name: string;
  category_type: string;
  currency: string;
  amount_due_minor: number | string;
  due_on: string | null;
  paid_minor: number | string;
  reversed_minor: number | string;
  balance_minor: number | string;
};

type PaymentReceipt = {
  id: string;
  receipt_number: string;
  amount_minor: number | string;
  method: string;
  reference: string | null;
  paid_at: string;
};

const formatMoney = (minor: number | string, currency = 'INR') => {
  const num = Number(minor || 0) / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(num);
};

export default function FeesWorkspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const canManage = !!user.permissions?.some(p => p === 'fees:manage');

  const [activeTab, setActiveTab] = useState<'ledger' | 'structures' | 'reports'>('ledger');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [structureModal, setStructureModal] = useState(false);
  const [assignModal, setAssignModal] = useState(false);
  const [paymentModalFee, setPaymentModalFee] = useState<StudentFeeRow | null>(null);
  const [reverseModal, setReverseModal] = useState<{ paymentId: string; amountMinor: number } | null>(null);
  const [receiptView, setReceiptView] = useState<PaymentReceipt | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Fetch Students for Ledger search
  const studentsQuery = useQuery({
    queryKey: ['fees-students', studentSearch],
    queryFn: () => request<{ items: { id: string; first_name: string; last_name: string; admission_number: string; class_name?: string }[] }>(
      `/api/school/students?limit=25&search=${encodeURIComponent(studentSearch)}`
    ),
  });

  const students = studentsQuery.data?.items || [];
  const activeStudentId = selectedStudentId || students[0]?.id || '';

  // 2. Fetch Selected Student Fees
  const studentFeesQuery = useQuery({
    queryKey: ['student-fees', activeStudentId],
    queryFn: () => request<{ studentId: string; items: StudentFeeRow[] }>(`/api/school/fees/students/${activeStudentId}`),
    enabled: !!activeStudentId,
  });

  // 3. Fetch Fee Categories & Structures
  const structuresQuery = useQuery({
    queryKey: ['fee-structures'],
    queryFn: () => request<{ items: FeeStructure[] }>('/api/school/fees/structures'),
  });

  // 4. Fetch Collection Reports
  const collectionReport = useQuery({
    queryKey: ['fees-collection-report'],
    queryFn: () => request<{ items: { method: string; total_minor: number; count: number }[] }>('/api/school/fees/reports/collection'),
    enabled: activeTab === 'reports' && canManage,
  });

  const studentFees = studentFeesQuery.data?.items || [];

  // Summary Metrics
  const summary = useMemo(() => {
    let due = 0, paid = 0, balance = 0;
    for (const f of studentFees) {
      due += Number(f.amount_due_minor || 0);
      paid += Number(f.paid_minor || 0) - Number(f.reversed_minor || 0);
      balance += Number(f.balance_minor || 0);
    }
    return { due, paid, balance };
  }, [studentFees]);

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#e8ede9] shadow-sm">
        <div>
          <div className="text-[10px] font-bold text-[#89968f] tracking-wider uppercase">Finance & Ledger</div>
          <h2 className="text-xl font-bold text-[#1c3025] font-['Manrope']">Fees & Collections</h2>
          <p className="text-xs text-[#849189]">Fee structures, student billing ledger, offline payments, and auditable receipts.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <button className="btn btn-secondary" onClick={() => setStructureModal(true)}>
                <Plus size={15} /> New Fee Structure
              </button>
              <button className="btn btn-primary" onClick={() => setAssignModal(true)} disabled={!students.length}>
                <Plus size={15} /> Assign Fee
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {/* Tabs */}
      <div className="school-workbar mb-2">
        <div className="school-tabs">
          <button className={activeTab === 'ledger' ? 'selected' : ''} onClick={() => setActiveTab('ledger')}>
            Student Ledger
          </button>
          <button className={activeTab === 'structures' ? 'selected' : ''} onClick={() => setActiveTab('structures')}>
            Fee Structures
          </button>
          {canManage && (
            <button className={activeTab === 'reports' ? 'selected' : ''} onClick={() => setActiveTab('reports')}>
              Collection Reports
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Student Ledger */}
      {activeTab === 'ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Student Selector */}
          <section className="panel p-0 overflow-hidden lg:col-span-1">
            <div className="p-3 border-b border-[#eff2f0] bg-[#fafbfa]">
              <div className="search-box w-full">
                <Search size={15} />
                <input
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                  placeholder="Search student or adm no..."
                />
              </div>
            </div>

            <div className="divide-y divide-[#eff2f0] max-h-[500px] overflow-y-auto">
              {studentsQuery.isLoading ? (
                <div className="p-4 space-y-2">
                  <div className="skeleton h-10 w-full" />
                  <div className="skeleton h-10 w-full" />
                </div>
              ) : students.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#89958d]">No students found.</div>
              ) : (
                students.map(st => (
                  <div
                    key={st.id}
                    onClick={() => setSelectedStudentId(st.id)}
                    className={`p-3 cursor-pointer transition hover:bg-[#f6f8f6] ${
                      activeStudentId === st.id ? 'bg-[#edf4ef] border-l-4 border-[#36735c]' : ''
                    }`}
                  >
                    <div className="font-bold text-xs text-[#2b3d32]">{st.first_name} {st.last_name}</div>
                    <div className="text-[10px] text-[#89958d] flex items-center justify-between mt-1">
                      <span>Adm: {st.admission_number}</span>
                      <span>{st.class_name || 'Class N/A'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Right: Selected Student Fee Details & Summary */}
          <section className="panel p-4 lg:col-span-2 space-y-4">
            {!activeStudentId ? (
              <div className="empty-state py-16">
                <DollarSign size={28} className="text-[#89968f] mb-2" />
                <strong>Select a student</strong>
                <p className="text-xs text-[#89958d]">Select a student from the list to view their ledger and record payments.</p>
              </div>
            ) : (
              <>
                {/* 3 Metric Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-[#fafbfa] border border-[#eff2f0]">
                    <div className="text-[10px] text-[#89958d] font-bold uppercase">Total Invoiced</div>
                    <div className="text-lg font-bold text-[#1c3025] font-['Manrope'] mt-1">{formatMoney(summary.due)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#edf6ef] border border-[#dcebe1]">
                    <div className="text-[10px] text-[#49845e] font-bold uppercase">Total Collected</div>
                    <div className="text-lg font-bold text-[#49845e] font-['Manrope'] mt-1">{formatMoney(summary.paid)}</div>
                  </div>
                  <div className={`p-3 rounded-lg border ${summary.balance > 0 ? 'bg-[#fff5f2] border-[#f1d6cf]' : 'bg-[#fafbfa] border-[#eff2f0]'}`}>
                    <div className={`text-[10px] font-bold uppercase ${summary.balance > 0 ? 'text-[#a75644]' : 'text-[#89958d]'}`}>
                      Outstanding Balance
                    </div>
                    <div className={`text-lg font-bold font-['Manrope'] mt-1 ${summary.balance > 0 ? 'text-[#a75644]' : 'text-[#2b3d32]'}`}>
                      {formatMoney(summary.balance)}
                    </div>
                  </div>
                </div>

                {/* Fees Table */}
                <div className="border border-[#eff2f0] rounded-lg overflow-hidden">
                  <div className="p-3 bg-[#fafbfa] border-b border-[#eff2f0] flex items-center justify-between">
                    <span className="text-xs font-bold text-[#43564a]">Assigned Fee Charges ({studentFees.length})</span>
                    <span className="text-[10px] text-[#89958d]">Append-only payment ledger</span>
                  </div>

                  {studentFeesQuery.isLoading ? (
                    <div className="p-4 space-y-2">
                      <div className="skeleton h-10 w-full" />
                      <div className="skeleton h-10 w-full" />
                    </div>
                  ) : studentFees.length === 0 ? (
                    <div className="empty-state py-8">
                      <strong>No fees assigned to this student</strong>
                      <span className="text-xs text-[#89958d]">Assign a tuition or facility fee to generate billing.</span>
                    </div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>CATEGORY</th>
                            <th>DUE DATE</th>
                            <th>INVOICED</th>
                            <th>COLLECTED</th>
                            <th>OUTSTANDING</th>
                            <th>ACTION</th>
                          </tr>
                        </thead>
                        <tbody>
                          {studentFees.map(fee => {
                            const bal = Number(fee.balance_minor);
                            return (
                              <tr key={fee.id}>
                                <td>
                                  <strong>{fee.category_name}</strong>
                                  <div className="text-[9px] text-[#89958d]">{fee.category_type}</div>
                                </td>
                                <td>{fee.due_on || '—'}</td>
                                <td className="font-semibold">{formatMoney(fee.amount_due_minor, fee.currency)}</td>
                                <td className="text-[#36735c] font-semibold">{formatMoney(fee.paid_minor, fee.currency)}</td>
                                <td>
                                  <span className={`font-bold ${bal > 0 ? 'text-[#a75644]' : 'text-[#36735c]'}`}>
                                    {formatMoney(fee.balance_minor, fee.currency)}
                                  </span>
                                </td>
                                <td>
                                  {canManage && bal > 0 && (
                                    <button
                                      className="btn btn-primary small-btn"
                                      onClick={() => setPaymentModalFee(fee)}
                                    >
                                      Record Payment
                                    </button>
                                  )}
                                  {bal === 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#edf6ef] text-[#49845e] font-bold">
                                      Fully Paid
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: Fee Structures */}
      {activeTab === 'structures' && (
        <section className="panel p-0 overflow-hidden">
          <div className="p-3 border-b border-[#eff2f0] flex items-center justify-between bg-[#fafbfa]">
            <span className="text-xs font-bold text-[#43564a]">Configured Fee Structures</span>
            <span className="text-[10px] text-[#89958d]">Standard pricing templates</span>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>CATEGORY</th>
                  <th>ACADEMIC YEAR</th>
                  <th>AMOUNT</th>
                  <th>CURRENCY</th>
                  <th>DUE DATE</th>
                  <th>DESCRIPTION</th>
                </tr>
              </thead>
              <tbody>
                {structuresQuery.data?.items.map(st => (
                  <tr key={st.id}>
                    <td>
                      <strong>{st.category_name}</strong>
                      <div className="text-[9px] text-[#89958d]">{st.category_type}</div>
                    </td>
                    <td>{st.academic_year_name}</td>
                    <td className="font-bold text-[#2b3d32]">{formatMoney(st.amount_minor, st.currency)}</td>
                    <td>{st.currency}</td>
                    <td>{st.due_on || '—'}</td>
                    <td className="text-xs text-[#637168]">{st.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: Collection Reports */}
      {activeTab === 'reports' && (
        <section className="panel p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#eff2f0] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[#1c3025]">Collection Breakdown</h3>
              <p className="text-xs text-[#89958d]">Aggregated financial receipts by payment channel.</p>
            </div>
            <a
              href="/api/school/reports/export?type=fees&format=csv"
              className="btn btn-secondary small-btn"
              download
            >
              <Download size={14} /> Export CSV
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {collectionReport.data?.items.map(item => (
              <div key={item.method} className="p-3 rounded-lg border border-[#eff2f0] bg-[#fafbfa]">
                <div className="text-[10px] font-bold text-[#89958d] uppercase">{item.method.replace('_', ' ')}</div>
                <div className="text-lg font-bold text-[#36735c] font-['Manrope'] mt-1">{formatMoney(item.total_minor)}</div>
                <div className="text-[10px] text-[#89958d] mt-1">{item.count} transaction(s)</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MODAL: Record Offline Payment */}
      {paymentModalFee && (
        <RecordPaymentModal
          fee={paymentModalFee}
          onClose={() => setPaymentModalFee(null)}
          onSuccess={receipt => {
            setPaymentModalFee(null);
            setReceiptView(receipt);
            void qc.invalidateQueries({ queryKey: ['student-fees'] });
          }}
        />
      )}

      {/* MODAL: Create Fee Structure */}
      {structureModal && (
        <CreateStructureModal
          onClose={() => setStructureModal(false)}
          onSuccess={() => {
            setStructureModal(false);
            void qc.invalidateQueries({ queryKey: ['fee-structures'] });
          }}
        />
      )}

      {/* MODAL: Assign Fee to Student */}
      {assignModal && (
        <AssignFeeModal
          students={students}
          structures={structuresQuery.data?.items || []}
          onClose={() => setAssignModal(false)}
          onSuccess={() => {
            setAssignModal(false);
            void qc.invalidateQueries({ queryKey: ['student-fees'] });
          }}
        />
      )}

      {/* MODAL: Receipt View */}
      {receiptView && (
        <ReceiptModal receipt={receiptView} onClose={() => setReceiptView(null)} />
      )}
    </div>
  );
}

function RecordPaymentModal({
  fee,
  onClose,
  onSuccess,
}: {
  fee: StudentFeeRow;
  onClose: () => void;
  onSuccess: (receipt: PaymentReceipt) => void;
}) {
  const maxMinor = Number(fee.balance_minor);
  const [amountRupees, setAmountRupees] = useState(String(maxMinor / 100));
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'cheque' | 'demand_draft'>('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountMinor = Math.round(Number(amountRupees) * 100);
    if (amountMinor <= 0 || amountMinor > maxMinor) {
      setError(`Amount must be between ₹1 and ₹${maxMinor / 100}`);
      return;
    }
    setBusy(true);
    setError('');
    const idempotencyKey = `pay-${crypto.randomUUID()}`;
    try {
      const res = await request<{ payment: { id: string; method: string; reference: string | null; paid_at: string }; receipt: { id: string; receipt_number: string } }>(
        '/api/school/fees/payments',
        {
          method: 'POST',
          body: JSON.stringify({
            studentFeeId: fee.id,
            amountMinor,
            method,
            reference: reference.trim() || undefined,
            idempotencyKey,
          }),
        }
      );
      onSuccess({
        id: res.receipt.id,
        receipt_number: res.receipt.receipt_number,
        amount_minor: amountMinor,
        method: res.payment.method,
        reference: res.payment.reference,
        paid_at: res.payment.paid_at,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal school-modal max-w-md">
        <div className="modal-head">
          <div>
            <div className="eyebrow">PAYMENTS & COLLECTIONS</div>
            <h2>Record Payment</h2>
            <p>Invoice for {fee.category_name}. Outstanding: {formatMoney(fee.balance_minor)}</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="modal-form space-y-3 pb-4">
          <div className="field">
            <span>Payment Method</span>
            <select value={method} onChange={e => setMethod(e.target.value as typeof method)}>
              <option value="cash">Cash Collection</option>
              <option value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
              <option value="cheque">Cheque</option>
              <option value="demand_draft">Demand Draft</option>
            </select>
          </div>

          <div className="field">
            <span>Amount Received (₹)</span>
            <input
              type="number"
              min="1"
              max={maxMinor / 100}
              step="0.01"
              required
              value={amountRupees}
              onChange={e => setAmountRupees(e.target.value)}
            />
          </div>

          <div className="field">
            <span>Transaction / Cheque / Bank Reference (Optional)</span>
            <input
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="e.g. UTR-9823412 or Cheque #00412"
            />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions pt-2">
            <span className="text-xs text-[#849189]">An auditable serial receipt will be issued automatically.</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Recording...' : 'Record Payment'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateStructureModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [categoryType, setCategoryType] = useState<'tuition' | 'transport' | 'examination' | 'custom'>('tuition');
  const [amountRupees, setAmountRupees] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const yearsQuery = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => request<{ items: { id: string; name: string; is_current: boolean }[] }>('/api/school/academic-years'),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const yearId = yearsQuery.data?.items.find(y => y.is_current)?.id || yearsQuery.data?.items[0]?.id;
    if (!yearId || !amountRupees || !name) {
      setError('Please fill in required fields');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Create category first
      const catRes = await request<{ category: { id: string } }>('/api/school/fees/categories', {
        method: 'POST',
        body: JSON.stringify({ name, categoryType }),
      });
      // Create structure
      await request('/api/school/fees/structures', {
        method: 'POST',
        body: JSON.stringify({
          categoryId: catRes.category.id,
          academicYearId: yearId,
          amountMinor: Math.round(Number(amountRupees) * 100),
          currency: 'INR',
          dueOn: dueOn || undefined,
          description: description.trim() || undefined,
        }),
      });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal school-modal max-w-md">
        <div className="modal-head">
          <div>
            <div className="eyebrow">FEES / STRUCTURE</div>
            <h2>Create Fee Structure</h2>
            <p>Establish a fee category and base billing tariff.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="modal-form space-y-3 pb-4">
          <div className="field">
            <span>Category Name</span>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Grade 10 Annual Tuition" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <span>Category Type</span>
              <select value={categoryType} onChange={e => setCategoryType(e.target.value as typeof categoryType)}>
                <option value="tuition">Tuition Fee</option>
                <option value="transport">Transport Fee</option>
                <option value="examination">Examination Fee</option>
                <option value="custom">Custom Fee</option>
              </select>
            </div>
            <div className="field">
              <span>Amount (₹)</span>
              <input type="number" min="1" step="0.01" required value={amountRupees} onChange={e => setAmountRupees(e.target.value)} placeholder="50000" />
            </div>
          </div>

          <div className="field">
            <span>Default Due Date (Optional)</span>
            <input type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} />
          </div>

          <div className="field">
            <span>Description</span>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Term 1 details or inclusions" />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Create Structure'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignFeeModal({
  students,
  structures,
  onClose,
  onSuccess,
}: {
  students: { id: string; first_name: string; last_name: string; admission_number: string }[];
  structures: FeeStructure[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [studentId, setStudentId] = useState(students[0]?.id || '');
  const [feeStructureId, setFeeStructureId] = useState(structures[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId || !feeStructureId) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/school/fees/assignments', {
        method: 'POST',
        body: JSON.stringify({ studentId, feeStructureId }),
      });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal school-modal max-w-md">
        <div className="modal-head">
          <div>
            <div className="eyebrow">FEES / BILLING</div>
            <h2>Assign Fee to Student</h2>
            <p>Attach a tariff structure to a student’s active ledger.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="modal-form space-y-3 pb-4">
          <div className="field">
            <span>Select Student</span>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} required>
              {students.map(st => (
                <option key={st.id} value={st.id}>{st.first_name} {st.last_name} ({st.admission_number})</option>
              ))}
            </select>
          </div>

          <div className="field">
            <span>Select Fee Structure</span>
            <select value={feeStructureId} onChange={e => setFeeStructureId(e.target.value)} required>
              {structures.map(fs => (
                <option key={fs.id} value={fs.id}>
                  {fs.category_name} • {formatMoney(fs.amount_minor, fs.currency)}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Assigning...' : 'Assign Fee'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReceiptModal({ receipt, onClose }: { receipt: PaymentReceipt; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal school-modal max-w-md">
        <div className="p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#eaf4ed] text-[#4e8b63] mx-auto flex items-center justify-center">
            <CreditCard size={24} />
          </div>
          <div className="text-[10px] text-[#89968f] font-bold uppercase tracking-wider">Payment Receipt Confirmed</div>
          <h2 className="text-xl font-bold text-[#1c3025]">{receipt.receipt_number}</h2>
          <div className="p-3 bg-[#fafbfa] border border-[#eff2f0] rounded-lg text-left text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[#89958d]">Amount Received:</span>
              <strong className="text-[#36735c]">{formatMoney(receipt.amount_minor)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[#89958d]">Payment Mode:</span>
              <span className="font-semibold text-[#2b3d32]">{receipt.method.replace('_', ' ').toUpperCase()}</span>
            </div>
            {receipt.reference && (
              <div className="flex justify-between">
                <span className="text-[#89958d]">Reference:</span>
                <span>{receipt.reference}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#89958d]">Date:</span>
              <span>{new Date(receipt.paid_at).toLocaleString()}</span>
            </div>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <button className="btn btn-secondary small-btn" onClick={() => window.print()}>
              <Printer size={14} /> Print Receipt
            </button>
            <button className="btn btn-primary small-btn" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
