// EZY Pawnshop 2006 Web PWA - Application Logic

// ==================== 1. DATABASE & STATE INITIALIZATION ====================
const DEFAULT_CUSTOMERS = [
  { Id: '1-2345-67890-12-3', Name: 'สมชาย ใจดี', Tel: '0812345678' },
  { Id: '3-1002-34567-89-0', Name: 'สมศรี มีสุข', Tel: '0898765432' }
];

const DEFAULT_USERS = [
  { UserID: 'admin', Password: 'admin123', Name: 'ผู้จัดการ ชัยชนะ', Position: 'ผู้จัดการ' },
  { UserID: '1-1111-11111-11-1', Password: 'admin123', Name: 'ผู้จัดการ ชัยชนะ (สำรอง)', Position: 'ผู้จัดการ' },
  { UserID: '2-2222-22222-22-2', Password: 'password123', Name: 'นารี มีทอง', Position: 'พนักงานต้อนรับ' }
];

const DEFAULT_TICKETS = [
  {
    SystemID: 1,
    BudYear: 2569,
    BookNo: 1,
    DocNo: 1001,
    BillType: '',
    BillDate: '',
    BillNo: '',
    BillBookNo: '',
    BillDocNo: '',
    Asstotal: 45000,
    Totalint: 562.50,
    MonthTotal: 1,
    MonthInt: 562.50, // 562.50 Baht per month (derived from 45000 * 1.25%)
    AppDate: '2026/06/15 10:00:00',
    ExpDate: '2026/10/15',
    Model: 'สร้อยคอทองคำ น้ำหนัก 1 บาท (จำนวน 1 เส้น)',
    BillStat: 'N', // N = Pawned/จำนำ
    Id: '1-2345-67890-12-3'
  },
  {
    SystemID: 1,
    BudYear: 2569,
    BookNo: 1,
    DocNo: 1002,
    BillType: '',
    BillDate: '',
    BillNo: '',
    BillBookNo: '',
    BillDocNo: '',
    Asstotal: 20000,
    Totalint: 300.00,
    MonthTotal: 1,
    MonthInt: 300.00, // 300.00 Baht per month (derived from 20000 * 1.5%)
    AppDate: '2026/06/20 14:30:00',
    ExpDate: '2026/10/20',
    Model: 'แหวนเพชรเม็ดเดี่ยว 0.5 กะรัต (จำนวน 1 วง)',
    BillStat: 'N',
    Id: '1-2345-67890-12-3'
  },
  {
    SystemID: 2,
    BudYear: 2569,
    BookNo: 2,
    DocNo: 2001,
    BillType: '',
    BillDate: '',
    BillNo: '',
    BillBookNo: '',
    BillDocNo: '',
    Asstotal: 12000,
    Totalint: 240.00,
    MonthTotal: 1,
    MonthInt: 240.00, // 240.00 Baht per month (derived from 12000 * 2%)
    AppDate: '2026/07/01 09:15:00',
    ExpDate: '2026/11/01',
    Model: 'แท็บเล็ต iPad Air 5 256GB WiFi (จำนวน 1 เครื่อง)',
    BillStat: 'N',
    Id: '3-1002-34567-89-0'
  },
  {
    SystemID: 2,
    BudYear: 2569,
    BookNo: 2,
    DocNo: 2002,
    BillType: '', // Unpaid initially
    BillDate: '',
    BillNo: '',
    BillBookNo: '',
    BillDocNo: '',
    Asstotal: 8000,
    Totalint: 160.00,
    MonthTotal: 1,
    MonthInt: 160.00, // 160.00 Baht per month (derived from 8000 * 2%)
    AppDate: '2026/03/15 11:00:00',
    ExpDate: '2026/07/15',
    Model: 'นาฬิกาข้อมือ Seiko Prospex (จำนวน 1 เรือน)',
    BillStat: 'N', // Active pawn/unpaid
    Id: '1-2345-67890-12-3'
  }
];

const DEFAULT_PAYMENTS = [
  {
    BillNo: 'O260715-0001',
    SystemID: 2,
    BudYear: 2569,
    BookNo: 2,
    DocNo: 2002,
    BillType: '2',
    BillDate: '2026/07/15 11:20:00',
    Slip: 'Backgroud.png', // Fallback to an existing image in repo
    Id: '1-2345-67890-12-3'
  }
];

const DEFAULT_CONFIG = {
  shop_name: 'โรงรับจำนำ อีซี่ Pawnshop 2006',
  bank_name: 'ธนาคารกสิกรไทย',
  bank_logo: 'Logobank-kb.jpg',
  bank_color: '#178e3d',
  bank_acc: '026-8-91256-0',
  bank_acc_name: 'บจ. อีซี่ โรงรับจำนำ 2006',
  system_id: 3
};

const DEFAULT_SYNC_HISTORY = [
  { timestamp: '2026-07-20 15:30:22', status: 'สำเร็จ', count: '4 รายการ' }
];

const DEFAULT_BACKUP_HISTORY = [
  { timestamp: '2026-07-21 16:15:00', filename: 'PawnShop_2569-07-21.zip', status: 'สำเร็จ (Cloudflare R2)' }
];

const DEFAULT_POSITIONS = ['ผู้จัดการ', 'ผู้ช่วยผู้จัดการ', 'พนักงานต้อนรับ', 'พนักงานการเงิน'];

const DEFAULT_HOLIDAYS = [
  { h_date: '2026/01/01' },
  { h_date: '2026/04/13' },
  { h_date: '2026/04/14' },
  { h_date: '2026/04/15' },
  { h_date: '2026/05/01' },
  { h_date: '2026/07/28' }
];

// Normalizes database keys to prevent case-insensitivity issues from MySQL sync
function normalizeKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(normalizeKeys);
  }
  
  const keyMapping = {
    'systemid': 'SystemID',
    'budyear': 'BudYear',
    'bookno': 'BookNo',
    'docno': 'DocNo',
    'asstotal': 'Asstotal',
    'id': 'Id',
    'custcode': 'CustCode',
    'cust_code': 'CustCode',
    'model': 'Model',
    'billstat': 'BillStat',
    'monthint': 'MonthInt',
    'appdate': 'AppDate',
    'expdate': 'ExpDate',
    'name': 'Name',
    'tel': 'Tel',
    'position': 'Position',
    'userid': 'UserID',
    'password': 'Password',
    'billdate': 'BillDate',
    'billno': 'BillNo',
    'billtype': 'BillType',
    'slip': 'Slip',
    'totalint': 'Totalint',
    'monthtotal': 'MonthTotal'
  };
  
  const normalized = {};
  for (const k in obj) {
    const lowerKey = k.toLowerCase();
    const targetKey = keyMapping[lowerKey] || k;
    normalized[targetKey] = obj[k];
  }
  return normalized;
}

// Helper for safely writing to LocalStorage (handles QuotaExceededError when storing images/large objects)
function safeSetLocalStorage(key, data) {
  const strData = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    localStorage.setItem(key, strData);
  } catch (err) {
    console.warn(`[LocalStorage] setItem failed for "${key}" (Quota exceeded?), attempting quota cleanup:`, err);
    if (key === 'pawn_payments' && Array.isArray(data)) {
      // Strip heavy base64 slip images from local storage to prevent QuotaExceededError
      const cleaned = data.map(p => {
        if (p && (p.Slip || p.slip) && String(p.Slip || p.slip).length > 200) {
          const pClean = { ...p };
          delete pClean.Slip;
          delete pClean.slip;
          return pClean;
        }
        return p;
      });
      try {
        localStorage.setItem(key, JSON.stringify(cleaned));
        console.log('[LocalStorage] Successfully saved pawn_payments after stripping heavy slip images.');
        return;
      } catch (err2) {
        console.error('[LocalStorage] Still failed to save pawn_payments after stripping slips:', err2);
      }
    }
    // General fallback: clear pawn_sync_history or old cached data if still failing
    try {
      localStorage.removeItem('pawn_sync_history');
      localStorage.removeItem('pawn_backup_history');
      localStorage.setItem(key, strData);
    } catch (err3) {
      console.error('[LocalStorage] Critical quota error, could not save item:', key, err3);
    }
  }
}

// Load or Initialize database tables in LocalStorage
function initDB() {
  if (!localStorage.getItem('pawn_customers')) {
    safeSetLocalStorage('pawn_customers', DEFAULT_CUSTOMERS);
  }
  const storedUsers = localStorage.getItem('pawn_users');
  if (!storedUsers || !storedUsers.includes('"admin"')) {
    safeSetLocalStorage('pawn_users', DEFAULT_USERS);
  }
  if (!localStorage.getItem('pawn_tickets')) {
    safeSetLocalStorage('pawn_tickets', DEFAULT_TICKETS);
  }
  if (!localStorage.getItem('pawn_payments')) {
    safeSetLocalStorage('pawn_payments', DEFAULT_PAYMENTS);
  }
  const storedConfig = localStorage.getItem('pawn_config');
  if (!storedConfig) {
    safeSetLocalStorage('pawn_config', DEFAULT_CONFIG);
  } else {
    try {
      const parsed = JSON.parse(storedConfig);
      if (parsed.system_id === undefined) {
        parsed.system_id = 3;
        safeSetLocalStorage('pawn_config', parsed);
      }
    } catch (e) {
      safeSetLocalStorage('pawn_config', DEFAULT_CONFIG);
    }
  }
  if (!localStorage.getItem('pawn_sync_history')) {
    safeSetLocalStorage('pawn_sync_history', DEFAULT_SYNC_HISTORY);
  }
  if (!localStorage.getItem('pawn_backup_history')) {
    safeSetLocalStorage('pawn_backup_history', DEFAULT_BACKUP_HISTORY);
  }
  if (!localStorage.getItem('pawn_positions')) {
    safeSetLocalStorage('pawn_positions', DEFAULT_POSITIONS);
  }
  if (!localStorage.getItem('pawn_holidays')) {
    safeSetLocalStorage('pawn_holidays', DEFAULT_HOLIDAYS);
  }
}

initDB();

// Global App States
let db = {
  customers: normalizeKeys(JSON.parse(localStorage.getItem('pawn_customers'))),
  users: normalizeKeys(JSON.parse(localStorage.getItem('pawn_users'))),
  tickets: normalizeKeys(JSON.parse(localStorage.getItem('pawn_tickets'))),
  payments: normalizeKeys(JSON.parse(localStorage.getItem('pawn_payments'))),
  config: JSON.parse(localStorage.getItem('pawn_config')),
  sync: JSON.parse(localStorage.getItem('pawn_sync_history')),
  backup: JSON.parse(localStorage.getItem('pawn_backup_history')),
  positions: JSON.parse(localStorage.getItem('pawn_positions')) || [],
  holidays: JSON.parse(localStorage.getItem('pawn_holidays')) || []
};

// ==================== AUTO-FETCH CLOUD DATA ON PAGE LOAD ====================
// ดึงข้อมูลจริงจาก Cloudflare (ลองจาก /api/sync หรือ /last_cloud_sync.json)
// มาอัปเดต localStorage ทุกครั้งที่เปิดหน้าเว็บ เพื่อให้ Login และแสดงตั๋วได้ 100% เสมอ
async function refreshCloudData(forceRender = true) {
  let cloudData = null;

  // 1. ลองดึงจาก /api/sync
  try {
    const res = await fetch('/api/sync?t=' + Date.now());
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      cloudData = await res.json();
    }
  } catch (e) {}

  // 2. ถ้าดึงจาก /api/sync ไม่ได้ ให้ดึงจาก /last_cloud_sync.json บน Cloudflare Pages CDN
  if (!cloudData || (!cloudData.customers && !cloudData.tickets)) {
    try {
      const res2 = await fetch('/last_cloud_sync.json?t=' + Date.now());
      if (res2.ok) {
        cloudData = await res2.json();
      }
    } catch (e) {}
  }

  if (cloudData) {
    // 1. Tickets
    if (Array.isArray(cloudData.tickets) && cloudData.tickets.length > 0) {
      db.tickets = normalizeKeys(cloudData.tickets);
      safeSetLocalStorage('pawn_tickets', db.tickets);
    }
    
    // 2. Customers
    if (Array.isArray(cloudData.customers) && cloudData.customers.length > 0) {
      const customers = normalizeKeys(cloudData.customers);
      customers.forEach(c => {
        if (c.Name) c.Name = String(c.Name).replace(/\s+/g, ' ').trim();
      });
      db.customers = customers;
      safeSetLocalStorage('pawn_customers', db.customers);
    }
    
    // 3. Payments
    if (Array.isArray(cloudData.payments) && cloudData.payments.length > 0) {
      const normalizedCloudPayments = normalizeKeys(cloudData.payments);
      const mergedPayments = Array.isArray(db.payments) ? [...db.payments] : [];
      normalizedCloudPayments.forEach(cp => {
        const idx = mergedPayments.findIndex(lp => 
          String(lp.BillNo || lp.bill_no) === String(cp.BillNo || cp.bill_no) && 
          String(lp.SystemID || lp.system_id) === String(cp.SystemID || cp.system_id) && 
          String(lp.DocNo || lp.doc_no) === String(cp.DocNo || cp.doc_no)
        );
        if (idx > -1) {
          mergedPayments[idx] = cp;
        } else {
          mergedPayments.push(cp);
        }
      });
      db.payments = mergedPayments;
      safeSetLocalStorage('pawn_payments', db.payments);
    }
    
    // 4. Config
    if (cloudData.config && typeof cloudData.config === 'object') {
      db.config = { ...db.config, ...cloudData.config };
      safeSetLocalStorage('pawn_config', db.config);
      applyBankSettingsToUI();
    } else {
      loadLiveBankConfig();
    }
    
    console.log(`[Cloud Sync] ซิงค์ข้อมูลล่าสุดสำเร็จ: ${db.tickets.length} ตั๋ว, ${db.customers.length} ลูกค้า, ${db.payments.length} การชำระ`);
    
    if (forceRender) {
      if (state.userRole === 'customer' && state.currentUser) {
        const activeTab = document.querySelector('#client-portal .tab-screen.active');
        if (activeTab) {
          if (activeTab.id === 'tab-home') renderCustomerHome();
          else if (activeTab.id === 'tab-tickets') renderCustomerTickets();
          else if (activeTab.id === 'tab-pay') renderCustomerPayInterest();
        }
      } else if (state.userRole === 'admin') {
        const activeAdmin = document.querySelector('.admin-viewport .admin-screen.active');
        if (activeAdmin) {
          if (activeAdmin.id === 'scr-reconcile') renderAdminReconcile();
          else if (activeAdmin.id === 'scr-dashboard') renderAdminDashboard();
          else if (activeAdmin.id === 'scr-tickets') renderAdminTickets();
          else if (activeAdmin.id === 'scr-report') renderAdminReport();
        }
      }
    }
    return true;
  }
  return false;
}

let _cloudDataReady = refreshCloudData(false);

// Global padding utility
function pad(num) {
  return String(num).padStart(2, '0');
}

// Global interest calculation helper to prevent NaN values from imported/synced databases
function getSafeInterest(t) {
  if (!t) return 0;
  let val = Number(t.Totalint);
  if (isNaN(val) || val === 0) {
    const monthlyInt = Number(t.MonthInt) || (Number(t.Asstotal) * 0.015);
    val = monthlyInt * (Number(t.MonthTotal) || 1);
  }
  return isNaN(val) ? 0 : val;
}

// Ensure shop_name and bank_color config properties exist
if (db.config) {
  let updated = false;
  if (!db.config.shop_name) {
    db.config.shop_name = 'โรงรับจำนำ อีซี่ Pawnshop 2006';
    updated = true;
  }
  if (!db.config.bank_color) {
    db.config.bank_color = '#178e3d';
    updated = true;
  }
  if (updated) {
    localStorage.setItem('pawn_config', JSON.stringify(db.config));
  }
}

function saveDBTable(table) {
  safeSetLocalStorage('pawn_' + table, db[table]);
  if (table === 'tickets' || table === 'payments' || table === 'customers' || table === 'config') {
    syncCurrentStateToCloud(table);
  }
}

async function syncCurrentStateToCloud(table = null) {
  try {
    let payload = {};
    if (table === 'payments') {
      payload = { payments: db.payments, sync_time: new Date().toISOString() };
    } else if (table === 'config') {
      payload = { config: db.config, sync_time: new Date().toISOString() };
    } else if (table === 'tickets') {
      const modifiedTickets = (db.tickets || []).filter(t => t.BillStat === 'N' || t.BillType === '9' || t.BillType === '2');
      payload = { tickets: modifiedTickets, sync_time: new Date().toISOString() };
    } else {
      payload = {
        payments: db.payments,
        config: db.config,
        tickets: (db.tickets || []).filter(t => t.BillStat === 'N' || t.BillType === '9' || t.BillType === '2'),
        sync_time: new Date().toISOString()
      };
    }

    await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[Cloud D1 Sync] Auto-saved to Cloudflare for table:', table || 'all');
  } catch (e) {
    console.log('[Cloud D1 Sync] Offline mode:', e.message);
  }
}

async function loadLiveBankConfig() {
  let cfg = null;
  // 1. Try /api/config
  try {
    const res = await fetch('/api/config?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (data && data.config && Object.keys(data.config).length > 0) {
        cfg = data.config;
      }
    }
  } catch(e) {}

  // 2. Try /pawn_config.json
  if (!cfg) {
    try {
      const res2 = await fetch('/pawn_config.json?t=' + Date.now());
      if (res2.ok) {
        cfg = await res2.json();
      }
    } catch(e) {}
  }

  if (cfg && typeof cfg === 'object') {
    db.config = { ...db.config, ...cfg };
    localStorage.setItem('pawn_config', JSON.stringify(db.config));
    applyBankSettingsToUI();
  }
}

let state = {
  currentUser: null,
  userRole: null, // 'customer' or 'admin'
  otpCode: '',
  selectedTickets: [], // List of doc numbers for payment
  selectedSlipBase64: '',
  selectedPaymentDateTime: '',
  adminChart: null,
  uploadedSyncCustFile: null,
  uploadedSyncTicketFile: null,
  uploadedBackupFile: null
};

// Self-destruct and unregister all active service workers to prevent cache issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (let registration of registrations) {
      registration.unregister().then(() => {
        console.log('Old Service Worker unregistered successfully');
      });
    }
  });
}

// Clock logic for Admin Screen
setInterval(() => {
  const clockEl = document.getElementById('admin-live-time');
  if (clockEl) {
    const now = new Date();
    clockEl.innerText = now.toTimeString().split(' ')[0];
  }
}, 1000);

// Helper function to format date as DD/MM/YYYY in Thai Buddhist Era (พ.ศ.)
function formatThaiDate(dateInput) {
  if (!dateInput) return '-';
  
  let cleanInput = dateInput;
  if (typeof dateInput === 'string') {
    cleanInput = dateInput.replace(/-/g, '/').split(' ')[0]; // Extract only the date part
  }
  
  const date = new Date(cleanInput);
  if (isNaN(date.getTime())) return dateInput; // Fallback
  
  const pad = (num) => String(num).padStart(2, '0');
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  
  let year = date.getFullYear();
  if (year < 2400) {
    year += 543; // Convert AD to BE
  }
  
  return `${day}/${month}/${year}`;
}

// Helper function to format ID Card display
function formatIdCard(id) {
  // If the input contains letters, do not format it as an ID card
  if (/[a-zA-Z]/.test(id)) {
    return id;
  }
  // Removes all non-digits and formats as 1-2345-67890-12-3
  let digits = id.replace(/\D/g, '');
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits[0]}-${digits.substring(1)}`;
  if (digits.length <= 10) return `${digits[0]}-${digits.substring(1, 5)}-${digits.substring(5)}`;
  if (digits.length <= 12) return `${digits[0]}-${digits.substring(1, 5)}-${digits.substring(5, 10)}-${digits.substring(10)}`;
  return `${digits[0]}-${digits.substring(1, 5)}-${digits.substring(5, 10)}-${digits.substring(10, 12)}-${digits[12]}`;
}

// Event listener for ID Card input auto-formatting
const loginIdInput = document.getElementById('login-id');
if (loginIdInput) {
  loginIdInput.addEventListener('input', (e) => {
    let cursorPosition = e.target.selectionStart;
    let originalLength = e.target.value.length;
    e.target.value = formatIdCard(e.target.value);
    let diff = e.target.value.length - originalLength;
    e.target.setSelectionRange(cursorPosition + diff, cursorPosition + diff);
  });
}

// ==================== 2. LOGIN AND OTP LOGIC ====================
async function handleLogin() {
  const inputId = document.getElementById('login-id').value.trim();
  const inputContact = document.getElementById('login-contact').value.trim();
  const errorEl = document.getElementById('login-error-msg');
  const loginBtn = document.querySelector('#login-form button[type="submit"]');
  const originalBtnText = loginBtn ? loginBtn.innerHTML : '';
  
  errorEl.classList.add('hidden');

  // 1. First check if Admin / Staff
  const plainId = inputId.replace(/-/g, ''); // UserID normalized
  const user = db.users.find(u => {
    const normalizedDbId = u.UserID.replace(/-/g, '');
    return normalizedDbId === plainId && u.Password === inputContact;
  });
  if (user) {
    state.currentUser = user;
    state.userRole = 'admin';
    triggerOtpFlow('System Admin SMS');
    return;
  }

  // 2. Customer Login
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบข้อมูล...';
  }

  const plainInputId = inputId.replace(/[^0-9a-zA-Z]/g, '');
  const plainInputContact = inputContact.replace(/[^0-9]/g, '');

  // 2.1 Try Online Direct Cloudflare D1 Query (/api/login)
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: plainInputId, contact: plainInputContact })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.customer) {
        state.currentUser = normalizeKeys(data.customer);
        state.userRole = 'customer';
        if (Array.isArray(data.tickets) && data.tickets.length > 0) {
          const userTickets = normalizeKeys(data.tickets);
          const otherTickets = (db.tickets || []).filter(t => !isTicketOfCustomer(t, state.currentUser));
          db.tickets = [...otherTickets, ...userTickets];
          localStorage.setItem('pawn_tickets', JSON.stringify(db.tickets));
        }
        if (loginBtn) {
          loginBtn.disabled = false;
          loginBtn.innerHTML = originalBtnText;
        }
        triggerOtpFlow(state.currentUser.Tel);
        return;
      }
    }
  } catch (err) {
    console.warn('Online cloud login error, checking local/synced db:', err);
  }

  // 2.2 Fallback: Ensure Cloud Data is loaded in memory and search
  if (_cloudDataReady) {
    try { await _cloudDataReady; } catch(e) {}
  }
  if (!db.customers || db.customers.length <= 2) {
    try {
      await refreshCloudData(false);
    } catch(e) {}
  }

  // Search in db.customers
  const customer = (db.customers || []).find(c => {
    const dbId = String(c.Id || '').replace(/[^0-9a-zA-Z]/g, '');
    const dbCustCode = String(c.CustCode || '').replace(/[^0-9a-zA-Z]/g, '');
    const dbTel = String(c.Tel || '').replace(/\D/g, '');
    
    const idMatches = (dbId === plainInputId || dbCustCode === plainInputId);
    const telMatches = (
      !plainInputContact ||
      !dbTel ||
      dbTel === plainInputContact ||
      (dbTel.length >= 9 && plainInputContact.length >= 9 && (dbTel.endsWith(plainInputContact) || plainInputContact.endsWith(dbTel))) ||
      (dbTel.includes(plainInputContact) && plainInputContact.length >= 8)
    );
    return idMatches && telMatches;
  });

  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.innerHTML = originalBtnText;
  }

  if (customer) {
    state.currentUser = customer;
    state.userRole = 'customer';
    triggerOtpFlow(customer.Tel);
    return;
  }

  // 3. Not found, show spec warning message
  errorEl.innerText = '* ไม่พบข้อมูลลูกค้าในระบบ กรุณาติดต่อโรงรับจำนำฯ ใน วัน - เวลาทำการ  จ.-ศ. 09.00 – 15.00 น.';
  errorEl.classList.remove('hidden');
}

function triggerOtpFlow(contactVal) {
  // Generate random 6 digit OTP
  state.otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Update UI and show modal
  document.getElementById('mock-otp-code').innerText = state.otpCode;
  
  // Clear past inputs
  for (let i = 1; i <= 6; i++) {
    document.getElementById(`otp-${i}`).value = '';
  }
  
  const modal = document.getElementById('otp-modal');
  modal.classList.add('active');
  document.getElementById('otp-1').focus();
}

function moveOtpFocus(input, index) {
  if (input.value.length >= 1 && index < 6) {
    document.getElementById(`otp-${index + 1}`).focus();
  }
}

function closeOtpModal() {
  document.getElementById('otp-modal').classList.remove('active');
  state.currentUser = null;
  state.userRole = null;
  state.otpCode = '';
}

async function verifyOtp() {
  let enteredOtp = '';
  for (let i = 1; i <= 6; i++) {
    enteredOtp += document.getElementById(`otp-${i}`).value.trim();
  }
  
  if (enteredOtp === state.otpCode) {
    // Success
    document.getElementById('otp-modal').classList.remove('active');
    document.getElementById('login-view').classList.add('hidden');
    
    if (state.userRole === 'customer') {
      enterCustomerPortal();
    } else if (state.userRole === 'admin') {
      await enterAdminPortal();
    }
  } else {
    alert('รหัส OTP ไม่ถูกต้อง กรุณากรอกใหม่อีกครั้ง');
    // Clear and focus first
    for (let i = 1; i <= 6; i++) {
      document.getElementById(`otp-${i}`).value = '';
    }
    document.getElementById('otp-1').focus();
  }
}

function logout() {
  state.currentUser = null;
  state.userRole = null;
  state.otpCode = '';
  state.selectedTickets = [];
  state.selectedSlipBase64 = '';
  state.selectedPaymentDateTime = '';
  
  document.body.classList.remove('admin-mode');
  document.getElementById('client-portal').classList.add('hidden');
  document.getElementById('admin-portal').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('login-id').value = '';
  document.getElementById('login-contact').value = '';
  document.getElementById('login-error-msg').classList.add('hidden');
}

// ==================== 3. CUSTOMER PORTAL LOGIC ====================
function enterCustomerPortal() {
  document.getElementById('client-portal').classList.remove('hidden');
  
  // Set Profile info
  document.getElementById('cust-name').innerText = state.currentUser.Name || '-';
  
  // Mask ID Card card for display (e.g. 1-2345-XXXXX-XX-X)
  let rawId = state.currentUser.Id || '';
  let maskedId = rawId;
  if (rawId && rawId.length >= 13) {
    maskedId = `${rawId[0]}-${rawId.substring(2,6)}-XXXXX-XX-${rawId[rawId.length-1]}`;
  }
  document.getElementById('cust-id').innerText = maskedId;
  document.getElementById('cust-tel').innerText = state.currentUser.Tel || '-';
  
  // Load defaults
  switchCustomerTab('home', document.querySelector('.bottom-nav .nav-item'));
}

function switchCustomerTab(tabName, navItem) {
  // Update Nav selection classes
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  navItem.classList.add('active');
  
  // Switch Screens
  document.querySelectorAll('#client-portal .tab-screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  const targetScreen = document.getElementById(`tab-${tabName}`);
  targetScreen.classList.add('active');
  
  // Trigger specific tab renders
  if (tabName === 'home') {
    renderCustomerHome();
  } else if (tabName === 'tickets') {
    renderCustomerTickets();
  } else if (tabName === 'pay') {
    renderCustomerPayInterest();
    applyBankSettingsToUI();
  }
}

// Helper for date additions matching VB6 DateAdd("m")
function dateAddMonths(date, months) {
  let res = new Date(date);
  if (isNaN(res.getTime()) || isNaN(months)) {
    return res;
  }
  const expectedMonth = (res.getMonth() + months) % 12;
  res.setMonth(res.getMonth() + months);
  let limit = 0;
  while (res.getMonth() !== expectedMonth && res.getMonth() !== (expectedMonth + 12) % 12 && limit < 40) {
    res.setDate(res.getDate() - 1);
    limit++;
  }
  return res;
}

// Holiday check matching VB6 ChkHD
function chkHD(dateTmp, sMode = "DEC") {
  let cIntTmp = 0;
  let currDate = new Date(dateTmp);
  if (isNaN(currDate.getTime())) {
    return 0;
  }
  currDate.setHours(0,0,0,0);
  
  let limit = 0;
  while (limit < 100) {
    const day = currDate.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = (day === 0 || day === 6);
    
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${currDate.getFullYear()}/${pad(currDate.getMonth()+1)}/${pad(currDate.getDate())}`;
    
    const holidays = db.holidays || [];
    const isHoliday = holidays.some(h => h.h_date === dateStr);
    
    if (isWeekend || isHoliday) {
      cIntTmp++;
      if (sMode === "INC") {
        currDate.setDate(currDate.getDate() + 1);
      } else {
        currDate.setDate(currDate.getDate() - 1);
      }
    } else {
      break;
    }
    limit++;
  }
  return cIntTmp;
}

// Computes interest up to current date matching VB6 DifDate
function calculateActiveInterest(ticket) {
  if (!ticket || !ticket.AppDate) {
    return { months: 0, interestAmount: 0, totalToPay: 0 };
  }
  const dFrDate = new Date(ticket.AppDate);
  if (isNaN(dFrDate.getTime())) {
    return { months: 0, interestAmount: 0, totalToPay: 0 };
  }
  dFrDate.setHours(0,0,0,0);
  
  let dToDate = new Date();
  dToDate.setHours(0,0,0,0);
  
  // Yesterday relative to dToDate
  const yesterday = new Date(dToDate);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0,0,0,0);
  
  const lHoli_Num = chkHD(yesterday, "DEC");
  if (lHoli_Num > 0) {
    dToDate.setDate(dToDate.getDate() - lHoli_Num);
  }
  
  // DateDiff("m", dFrDate, dToDate)
  let lMonth = (dToDate.getFullYear() - dFrDate.getFullYear()) * 12 + (dToDate.getMonth() - dFrDate.getMonth());
  if (isNaN(lMonth)) lMonth = 0;
  
  // check DateAdd("m", lMonth, dFrDate) > dToDate
  let dTmpDate = dateAddMonths(dFrDate, lMonth);
  dTmpDate.setHours(0,0,0,0);
  
  if (dTmpDate > dToDate) {
    lMonth = lMonth - 1;
    dTmpDate = dateAddMonths(dFrDate, lMonth);
    dTmpDate.setHours(0,0,0,0);
  }
  
  // DateDiff("d", dTmpDate, dToDate)
  const diffTime = dToDate - dTmpDate;
  const lDay = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  let lResult = 0;
  if (lDay === 0) {
    lResult = lMonth;
  } else if (lDay >= 1 && lDay <= 15) {
    lResult = lMonth + 0.5;
  } else {
    lResult = lMonth + 1;
  }
  
  if (lResult === 0) {
    lResult = 0.5;
  }
  
  const monthlyInterestVal = ticket.MonthInt || (ticket.Asstotal * 0.015);
  const interestAmount = monthlyInterestVal * lResult;
  
  return {
    months: lResult,
    interestAmount: interestAmount,
    totalToPay: interestAmount
  };
}

function isTicketOfCustomer(t, user) {
  if (!t || !user) return false;
  if (user.CustCode && t.CustCode && String(t.CustCode) === String(user.CustCode)) return true;
  if (user.Id && t.Id && String(t.Id) === String(user.Id)) return true;
  if (user.CustCode && t.Id && String(t.Id) === String(user.CustCode)) return true;
  if (user.Id && t.CustCode && String(t.CustCode) === String(user.Id)) return true;
  return false;
}

function renderCustomerHome() {
  const custTickets = db.tickets.filter(t => isTicketOfCustomer(t, state.currentUser) && t.BillStat === 'N');
  
  // Ticket Count and Sum (คำนวณยอดเงินรับจำนำรวมอย่างถูกต้อง โดยแปลงเป็น Number ก่อน)
  document.getElementById('cust-ticket-count').innerText = custTickets.length;
  
  const totalSum = custTickets.reduce((acc, t) => acc + (Number(t.Asstotal) || 0), 0);
  document.getElementById('cust-ticket-sum').innerText = (Number(totalSum) || 0).toLocaleString('th-TH');
  
  // Calculate aggregate interest up to current date
  let totalInterest = 0;
  custTickets.forEach(t => {
    const calc = calculateActiveInterest(t);
    totalInterest += (Number(calc.interestAmount) || 0);
  });
  
  const todayVal = new Date();
  const padVal = (num) => String(num).padStart(2, '0');
  let y = todayVal.getFullYear();
  if (y < 2400) y += 543;
  const dateFormatted = `${padVal(todayVal.getDate())}/${padVal(todayVal.getMonth()+1)}/${y}`;
  
  const sumEl = document.getElementById('cust-interest-sum-val');
  if (sumEl) sumEl.innerText = totalInterest.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const dateEl = document.getElementById('cust-interest-calc-date');
  if (dateEl) dateEl.innerText = dateFormatted;
}

function renderCustomerTickets() {
  const container = document.getElementById('tickets-list-container');
  container.innerHTML = '';
  
  // Filter tickets for this customer
  const custTickets = db.tickets.filter(t => isTicketOfCustomer(t, state.currentUser));
  
  if (custTickets.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-light); margin-top: 4px;">ไม่พบรายการตั๋วรับจำนำของคุณ</p>';
    return;
  }
  
  // Order: BookNo and DocNo from low to high (ascending)
  custTickets.sort((a, b) => {
    const bookA = Number(a.BookNo) || 0;
    const bookB = Number(b.BookNo) || 0;
    if (bookA !== bookB) {
      return bookA - bookB;
    }
    const docA = Number(a.DocNo) || 0;
    const docB = Number(b.DocNo) || 0;
    return docA - docB;
  });

  custTickets.forEach(t => {
    const card = document.createElement('div');
    card.className = `ticket-card ticket-card-red`;
    
    let statusText = 'จำนำ';
    let badgeClass = 'badge-active';
    
    if (t.BillType === '9') {
      statusText = 'กำลังตรวจสอบ';
      badgeClass = 'badge-pending';
    } else if (t.BillType === '2' || t.BillStat === 'I') {
      statusText = 'ชำระแล้ว';
      badgeClass = 'badge-paid';
    }
    
    // Convert status symbols
    if (t.BillStat === 'R') statusText = 'ไถ่ถอนสำเร็จ';
    if (t.BillStat === 'C') statusText = 'เพิ่มต้นสำเร็จ';
    if (t.BillStat === 'D') statusText = 'ลดต้นสำเร็จ';
    
    const asstotalNum = Number(t.Asstotal) || 0;
    const interestCalc = calculateActiveInterest(t);
    const monthlyInt = Number(t.MonthInt) || (asstotalNum * 0.015);
    
    // Format dates
    const appDateFormatted = formatThaiDate(t.AppDate);
    const expDateFormatted = formatThaiDate(t.ExpDate);
    
    card.innerHTML = `
      <div class="ticket-header flex-row-between">
        <span class="ticket-id"><i class="fa-solid fa-receipt"></i> เล่มที่ ${t.BookNo} เลขที่ ${t.DocNo}</span>
        <span class="ticket-badge ${badgeClass}">${statusText}</span>
      </div>
      <div class="ticket-row flex-row-between">
        <span class="ticket-label">รายการทรัพย์สิน:</span>
        <span class="ticket-val">${t.Model || '-'}</span>
      </div>
      <div class="ticket-row flex-row-between">
        <span class="ticket-label">ยอดเงินรับจำนำ:</span>
        <span class="ticket-val price">${asstotalNum.toLocaleString('th-TH')} บาท</span>
      </div>
      <div class="ticket-row flex-row-between">
        <span class="ticket-label">จำนวนเดือน:</span>
        <span class="ticket-val">${interestCalc.months} เดือน</span>
      </div>
      <div class="ticket-row flex-row-between">
        <span class="ticket-label">ดอกเบี้ยต่อเดือน:</span>
        <span class="ticket-val" style="color: var(--primary-red); font-weight: 700;">${monthlyInt.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท</span>
      </div>
      <div class="ticket-row flex-row-between">
        <span class="ticket-label">วันที่รับจำนำ:</span>
        <span class="ticket-val">${appDateFormatted}</span>
      </div>
      <div class="ticket-row flex-row-between">
        <span class="ticket-label" style="font-weight: 600; color: var(--primary-red);">วันครบกำหนดตั๋ว:</span>
        <span class="ticket-val" style="font-weight: 600; color: var(--primary-red);">${expDateFormatted}</span>
      </div>
    `;
    
    container.appendChild(card);
  });
}

function renderCustomerPayInterest() {
  document.getElementById('pay-select-tickets-view').classList.remove('hidden');
  document.getElementById('pay-details-screen').classList.add('hidden');
  
  const container = document.getElementById('pay-ticket-list');
  container.innerHTML = '';
  
  const activeTickets = db.tickets.filter(t => isTicketOfCustomer(t, state.currentUser) && t.BillStat === 'N' && t.BillType !== '9');
  
  // Sort by BookNo and DocNo from low to high (ascending)
  activeTickets.sort((a, b) => {
    const bookA = Number(a.BookNo) || 0;
    const bookB = Number(b.BookNo) || 0;
    if (bookA !== bookB) {
      return bookA - bookB;
    }
    const docA = Number(a.DocNo) || 0;
    const docB = Number(b.DocNo) || 0;
    return docA - docB;
  });
  
  if (activeTickets.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-medium); padding: 20px;">ไม่มีตั๋วค้างชำระที่รอทำรายการชำระดอกเบี้ย</p>';
    document.getElementById('btn-select-all').classList.add('hidden');
    document.getElementById('btn-confirm-pay-interest').classList.add('hidden');
    return;
  }
  
  document.getElementById('btn-select-all').classList.remove('hidden');
  state.selectedTickets = [];
  updateSelectedCountUI();
  
  activeTickets.forEach(t => {
    const calc = calculateActiveInterest(t);
    const asstotalNum = Number(t.Asstotal) || 0;
    const card = document.createElement('div');
    card.className = 'selectable-ticket';
    card.id = `select-t-${t.DocNo}`;
    card.onclick = () => toggleSelectTicket(t.DocNo, t.BookNo, asstotalNum, calc.interestAmount);
    
    const expDateFormatted = formatThaiDate(t.ExpDate);
    
    card.innerHTML = `
      <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px;">
        เล่มที่ ${t.BookNo} เลขที่ ${t.DocNo}
      </div>
      <div style="font-size: 13px; color: var(--text-medium); margin-bottom: 4px;">
        รายการ: ${t.Model || '-'}
      </div>
      <div class="flex-row-between" style="font-size: 13px; margin-bottom: 4px;">
        <span>เงินรับจำนำ:</span>
        <span class="number" style="font-weight: 600;">${asstotalNum.toLocaleString('th-TH')} บาท</span>
      </div>
      <div class="flex-row-between" style="font-size: 13px; margin-bottom: 4px; color: var(--primary-red);">
        <span>ดอกเบี้ยค้างชำระ (${calc.months} เดือน):</span>
        <span class="number" style="font-weight: 700;">${calc.interestAmount.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</span>
      </div>
      <div style="font-size: 12px; color: var(--text-light); text-align: right; margin-top: 6px;">
        หมดอายุ: ${expDateFormatted}
      </div>
    `;
    
    container.appendChild(card);
  });
}

function toggleSelectTicket(docNo, bookNo, asstotal, interestAmt) {
  const idx = state.selectedTickets.findIndex(item => item.docNo === docNo && item.bookNo === bookNo);
  const card = document.getElementById(`select-t-${docNo}`);
  
  if (idx > -1) {
    state.selectedTickets.splice(idx, 1);
    card.classList.remove('selected');
  } else {
    state.selectedTickets.push({ docNo, bookNo, asstotal, interestAmt });
    card.classList.add('selected');
  }
  
  updateSelectedCountUI();
}

function toggleSelectAllTickets() {
  const activeTickets = db.tickets.filter(t => isTicketOfCustomer(t, state.currentUser) && t.BillStat === 'N' && t.BillType !== '9');
  const btn = document.getElementById('btn-select-all');
  
  if (state.selectedTickets.length === activeTickets.length) {
    state.selectedTickets = [];
    activeTickets.forEach(t => {
      const card = document.getElementById(`select-t-${t.DocNo}`);
      if (card) card.classList.remove('selected');
    });
    btn.innerHTML = '<i class="fa-solid fa-check-double"></i> เลือกทั้งหมด';
  } else {
    state.selectedTickets = [];
    activeTickets.forEach(t => {
      const calc = calculateActiveInterest(t);
      state.selectedTickets.push({ docNo: t.DocNo, bookNo: t.BookNo, asstotal: t.Asstotal, interestAmt: calc.interestAmount });
      const card = document.getElementById(`select-t-${t.DocNo}`);
      if (card) card.classList.add('selected');
    });
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i> ยกเลิกเลือกทั้งหมด';
  }
  
  updateSelectedCountUI();
}

function updateSelectedCountUI() {
  const count = state.selectedTickets.length;
  const countSpan = document.getElementById('selected-tickets-count');
  const actionBtn = document.getElementById('btn-confirm-pay-interest');
  
  countSpan.innerText = count;
  
  if (count > 0) {
    actionBtn.classList.remove('hidden');
  } else {
    actionBtn.classList.add('hidden');
  }
}

// Payment details submission view
function showPaymentDetailsScreen() {
  document.getElementById('pay-select-tickets-view').classList.add('hidden');
  document.getElementById('pay-details-screen').classList.remove('hidden');
  
  // Render Bank Config & Styles immediately from storage
  applyBankSettingsToUI();
  
  // Load latest live bank config from Cloudflare in parallel
  loadLiveBankConfig();
  
  // Summarize payment values
  const count = state.selectedTickets.length;
  const total = state.selectedTickets.reduce((sum, item) => sum + item.interestAmt, 0);
  
  document.getElementById('summary-pay-count').innerText = count;
  document.getElementById('summary-pay-total').innerText = total.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  
  // Reset slip upload view
  state.selectedSlipBase64 = '';
  state.selectedPaymentDateTime = '';
  document.getElementById('slip-preview').classList.add('hidden');
  document.getElementById('slip-placeholder-icon').classList.remove('hidden');
  document.getElementById('slip-placeholder-text').innerText = 'กดเพื่อ เลือกรูปภาพ หรือ ถ่ายภาพสลิป';
  document.getElementById('payment-datetime-text').innerText = 'เลือก วันที่ และ เวลาชำระเงิน';
}

function hidePaymentDetailsScreen() {
  document.getElementById('pay-select-tickets-view').classList.remove('hidden');
  document.getElementById('pay-details-screen').classList.add('hidden');
}

function copyBankAccount() {
  const accNo = db.config.bank_acc.replace(/-/g, '');
  navigator.clipboard.writeText(accNo).then(() => {
    alert('คัดลอกเลขบัญชีธนาคารแล้ว: ' + db.config.bank_acc);
  }).catch(() => {
    alert('ไม่สามารถคัดลอกโดยอัตโนมัติได้ เลขบัญชีคือ: ' + db.config.bank_acc);
  });
}

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input || !icon) return;
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
    icon.style.color = 'var(--primary-red)';
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
    icon.style.color = 'var(--text-medium)';
  }
}

// Single Date-Time Picker button triggers hidden input
function triggerDateTimePicker() {
  const el = document.getElementById('payment-datetime-input');
  if (!el) return;
  try {
    if (typeof el.showPicker === 'function') {
      el.showPicker();
    } else {
      el.focus();
      el.click();
    }
  } catch (e) {
    try {
      el.focus();
      el.click();
    } catch (err) {}
  }
}

function onDateTimeSelected() {
  const val = document.getElementById('payment-datetime-input').value; // 'YYYY-MM-DDTHH:MM'
  if (val) {
    state.selectedPaymentDateTime = val;
    
    const parts = val.split('T');
    const dateParts = parts[0].split('-'); // ['YYYY', 'MM', 'DD']
    const timeFormatted = parts[1] || '00:00';
    
    // Convert to Thai Buddhist Year for display
    const christianYear = parseInt(dateParts[0], 10);
    const thaiYear2Digit = String(christianYear + 543).substring(2);
    
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const monthIdx = parseInt(dateParts[1], 10) - 1;
    const monthName = thaiMonths[monthIdx] || dateParts[1];
    const day = parseInt(dateParts[2], 10);
    
    const dateFormatted = `${day} ${monthName} ${thaiYear2Digit}`;
    document.getElementById('payment-datetime-text').innerText = `${dateFormatted} เวลา ${timeFormatted} น.`;
  }
}

// Slip image handling
function showSlipOptionsModal() {
  // If image is already uploaded, show full view zoom popup instead
  if (state.selectedSlipBase64) {
    showImageViewer(state.selectedSlipBase64);
  } else {
    document.getElementById('slip-options-modal').classList.add('active');
  }
}

function closeSlipOptionsModal() {
  document.getElementById('slip-options-modal').classList.remove('active');
}

function triggerActualFileInput(type) {
  closeSlipOptionsModal();
  if (type === 'camera') {
    document.getElementById('slip-camera-input').click();
  } else {
    document.getElementById('slip-file-input').click();
  }
}

// Bind native file inputs
const slipFileInput = document.getElementById('slip-file-input');
const slipCameraInput = document.getElementById('slip-camera-input');

function handleSlipFileSelected(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      state.selectedSlipBase64 = evt.target.result;
      
      // Update UI preview
      const preview = document.getElementById('slip-preview');
      preview.src = state.selectedSlipBase64;
      preview.classList.remove('hidden');
      document.getElementById('slip-placeholder-icon').classList.add('hidden');
      document.getElementById('slip-placeholder-text').innerText = 'คลิกเพื่อดูรูปขยาย / เลือกใหม่';
    };
    reader.readAsDataURL(file);
  }
}

if (slipFileInput) slipFileInput.addEventListener('change', handleSlipFileSelected);
if (slipCameraInput) slipCameraInput.addEventListener('change', handleSlipFileSelected);

// Image Viewer modal methods
function showImageViewer(src) {
  const modal = document.getElementById('image-viewer-modal');
  const img = document.getElementById('image-viewer-img');
  img.src = src;
  
  // Add re-upload controls in zoom view if customer is uploading
  const actions = document.querySelector('.image-viewer-actions');
  actions.innerHTML = '';
  
  if (state.userRole === 'customer' && !document.getElementById('pay-details-screen').classList.contains('hidden')) {
    const changeBtn = document.createElement('button');
    changeBtn.className = 'btn btn-gold';
    changeBtn.innerHTML = '<i class="fa-solid fa-camera-rotate"></i> เปลี่ยนรูปภาพสลิป';
    changeBtn.onclick = (e) => {
      e.stopPropagation();
      closeImageViewer();
      document.getElementById('slip-options-modal').classList.add('active');
    };
    actions.appendChild(changeBtn);
  }
  
  modal.classList.remove('hidden');
}

function closeImageViewer() {
  document.getElementById('image-viewer-modal').classList.add('hidden');
}

// Submit payment transaction
async function submitPayment() {
  if (!state.selectedTickets || state.selectedTickets.length === 0) {
    alert('กรุณาเลือกตั๋วรับจำนำที่ต้องการชำระเงินอย่างน้อย 1 ใบ');
    return;
  }
  if (!state.selectedPaymentDateTime) {
    alert('กรุณาระบุ วันที่ และ เวลาที่ชำระเงินตามใบสลิปการโอนเงิน');
    return;
  }
  if (!state.selectedSlipBase64) {
    alert('กรุณาอัปโหลดรูปภาพใบสลิปการโอนเงินเพื่อใช้เป็นหลักฐาน');
    return;
  }

  // Show loading state on button
  const submitBtn = document.querySelector('[onclick="submitPayment()"]');
  const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่งข้อมูล...';
  }

  try {
    await _doSubmitPayment();
  } catch (unexpectedErr) {
    console.error('[submitPayment] Unexpected error:', unexpectedErr);
    alert('เกิดข้อผิดพลาดที่ไม่คาดคิด:\n' + (unexpectedErr && unexpectedErr.message ? unexpectedErr.message : String(unexpectedErr)));
  } finally {
    // Always restore the button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHTML;
    }
  }
}

// Internal implementation — separated so submitPayment() can always restore the button
async function _doSubmitPayment() {
  
  // Format Date format to yyyy/mm/dd hh:mm:ss (avoiding timezone offset issues)
  let formattedDate = '';
  try {
    const dtParts = String(state.selectedPaymentDateTime).split('T');
    const dateParts = (dtParts[0] || '').split('-');
    const timeParts = (dtParts[1] || '00:00').split(':');
    if (dateParts.length === 3) {
      formattedDate = `${dateParts[0]}/${dateParts[1]}/${dateParts[2]} ${timeParts[0] || '00'}:${timeParts[1] || '00'}:00`;
    } else {
      const now = new Date();
      const pad2 = (n) => String(n).padStart(2, '0');
      formattedDate = `${now.getFullYear()}/${pad2(now.getMonth()+1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:00`;
    }
  } catch (e) {
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    formattedDate = `${now.getFullYear()}/${pad2(now.getMonth()+1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:00`;
  }
  
  // Generate BillNo: O + YYMMDD - Sequence(4 digits)
  const today = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const year2 = String(today.getFullYear()).substring(2);
  const month2 = pad2(today.getMonth() + 1);
  const date2 = pad2(today.getDate());
  const prefix = `O${year2}${month2}${date2}`;
  
  // Calculate increment number safely by max existing sequence for prefix
  let maxSeq = 0;
  if (!Array.isArray(db.payments)) db.payments = [];
  (db.payments || []).forEach(p => {
    if (p && p.BillNo && String(p.BillNo).startsWith(prefix)) {
      const parts = String(p.BillNo).split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    }
  });
  const seqNum = maxSeq + 1;
  const billNo = `${prefix}-${String(seqNum).padStart(4, '0')}`;
  
  const currentCustId = (state.currentUser && (state.currentUser.Id || state.currentUser.id || state.currentUser.CustCode)) 
    ? String(state.currentUser.Id || state.currentUser.id || state.currentUser.CustCode) 
    : '';

  // Perform updates for each selected ticket
  state.selectedTickets.forEach(item => {
    const ticket = (db.tickets || []).find(t => Number(t.DocNo) === Number(item.docNo) && Number(t.BookNo) === Number(item.bookNo));
    if (ticket) {
      const calc = typeof calculateActiveInterest === 'function' ? calculateActiveInterest(ticket) : { interestAmount: Number(ticket.Totalint || 0), months: Number(ticket.MonthTotal || 1) };
      // 1. Update ticket fields
      ticket.BillType = '9'; // ยืนยันการชำระ / รอตรวจสอบ
      ticket.BillDate = formattedDate;
      ticket.BillNo = billNo;
      ticket.Totalint = calc.interestAmount; // Update to the calculated interest
      ticket.MonthTotal = calc.months; // Update to the calculated months
      
      // 2. Create payment receipt entry
      const newPay = {
        BillNo: billNo,
        SystemID: String(ticket.SystemID || ''),
        BudYear: String(ticket.BudYear || ''),
        BookNo: String(ticket.BookNo || ''),
        DocNo: String(ticket.DocNo || ''),
        BillType: '9', // รออนุมัติ/ยืนยันการชำระ
        BillDate: formattedDate,
        Slip: state.selectedSlipBase64,
        Id: currentCustId || String(ticket.Id || '')
      };
      
      db.payments.push(newPay);
    }
  });
  
  // Save tables locally
  safeSetLocalStorage('pawn_tickets', db.tickets);
  safeSetLocalStorage('pawn_payments', db.payments);

  // Sync to Cloudflare immediately (fast lightweight payload ~50KB)
  const submittedTickets = state.selectedTickets.map(item => {
    return (db.tickets || []).find(t => Number(t.DocNo) === Number(item.docNo) && Number(t.BookNo) === Number(item.bookNo));
  }).filter(Boolean);
  const newPayments = (db.payments || []).filter(p => p.BillNo === billNo);

  // Send to Cloudflare and wait for response — show error if failed
  let cloudOk = false;
  let cloudErrorCode = '';
  let cloudErrorMsg = '';
  try {
    const res = await fetch('/api/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: newPayments[0], payments: newPayments, ticket: submittedTickets[0], tickets: submittedTickets })
    });

    if (res.ok) {
      cloudOk = true;
      // Also push to /api/sync in background (non-blocking)
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payments: newPayments, tickets: submittedTickets })
      }).catch(() => {});
    } else {
      cloudErrorCode = `HTTP ${res.status} ${res.statusText}`;
      try {
        const errJson = await res.json();
        cloudErrorMsg = errJson.error || errJson.message || JSON.stringify(errJson);
      } catch (je) {
        try { cloudErrorMsg = await res.text(); } catch (te) { cloudErrorMsg = '(ไม่สามารถอ่าน response ได้)'; }
      }
    }
  } catch (netErr) {
    cloudErrorCode = 'Network Error';
    cloudErrorMsg = netErr && netErr.message ? netErr.message : String(netErr);
  }

  if (!cloudOk) {
    // Show error modal with code
    showPaymentErrorModal(billNo, cloudErrorCode, cloudErrorMsg);
    return;
  }

  // Trigger In-App Payment Success Modal
  const billNoEl = document.getElementById('success-modal-bill-no');
  if (billNoEl) billNoEl.innerText = billNo;

  const successModal = document.getElementById('payment-success-modal');
  if (successModal) {
    successModal.classList.add('active');
  } else {
    alert(`✅ ส่งข้อมูลหลักฐานเรียบร้อยแล้ว!\nรหัสรับชำระ: ${billNo}\n\nระบบได้ส่งข้อมูลหลักฐานไปยังโรงรับจำนำเรียบร้อยแล้ว อยู่ระหว่างเจ้าหน้าที่ตรวจสอบ`);
    closePaymentSuccessModal();
  }
}

function showPaymentErrorModal(billNo, errorCode, errorMsg) {
  const modal = document.getElementById('payment-error-modal');
  if (modal) {
    const codeEl = document.getElementById('payment-error-code');
    const msgEl  = document.getElementById('payment-error-msg');
    const billEl = document.getElementById('payment-error-bill-no');
    if (codeEl) codeEl.innerText = errorCode || 'Unknown Error';
    if (msgEl)  msgEl.innerText  = errorMsg  || '-';
    if (billEl) billEl.innerText = billNo     || '-';
    modal.classList.add('active');
  } else {
    // Fallback: alert
    alert(`❌ ส่งข้อมูลขึ้น Cloudflare ไม่สำเร็จ\n\nรหัสรับชำระ: ${billNo}\nError Code: ${errorCode}\nรายละเอียด: ${errorMsg}\n\nข้อมูลได้บันทึกไว้บนเครื่องแล้ว กรุณาลองใหม่อีกครั้ง`);
  }
}

function closePaymentErrorModal() {
  const modal = document.getElementById('payment-error-modal');
  if (modal) modal.classList.remove('active');
}

function closePaymentSuccessModal() {
  const successModal = document.getElementById('payment-success-modal');
  if (successModal) successModal.classList.remove('active');
  
  // Reset payment states
  state.selectedTickets = [];
  state.selectedSlipBase64 = '';
  state.selectedPaymentDateTime = '';
  
  // Reset preview UI
  const previewImg = document.getElementById('slip-preview');
  if (previewImg) {
    previewImg.src = '';
    previewImg.classList.add('hidden');
  }
  const placeholderIcon = document.getElementById('slip-placeholder-icon');
  if (placeholderIcon) placeholderIcon.classList.remove('hidden');
  const placeholderText = document.getElementById('slip-placeholder-text');
  if (placeholderText) placeholderText.innerText = 'กดเพื่อ เลือกรูปภาพ หรือ ถ่ายภาพสลิป';
  const dtText = document.getElementById('payment-datetime-text');
  if (dtText) dtText.innerText = 'เลือก วันที่ และ เวลาชำระเงิน';
  
  // Hide details screen
  hidePaymentDetailsScreen();

  // Refresh customer views
  if (typeof renderCustomerTickets === 'function') renderCustomerTickets();
  if (typeof renderSelectTicketsForPayment === 'function') renderSelectTicketsForPayment();
  if (typeof renderCustomerHome === 'function') renderCustomerHome();

  // Switch to "ตั๋วจำนำ" tab immediately with yellow pending badge
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');
  if (navItems && navItems[1] && typeof switchCustomerTab === 'function') {
    switchCustomerTab('tickets', navItems[1]);
  }
}

// ==================== 4. ADMINISTRATOR PORTAL LOGIC ====================
function toggleAdminSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
}

async function loadOptionIni() {
  try {
    const res = await fetch('/option.ini?t=' + Date.now());
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/SysGov\s*=\s*(\d)/i);
      if (match) {
        state.sysGov = parseInt(match[1], 10);
      } else {
        state.sysGov = 0;
      }
    } else {
      state.sysGov = 0;
    }
  } catch (e) {
    console.error('Failed to load option.ini', e);
    state.sysGov = 0;
  }
}

async function enterAdminPortal() {
  await loadOptionIni();
  
  if (state.sysGov === 1) {
    db.config.system_id = 1;
    saveDBTable('config');
    const settingsSysIdFormGroup = document.getElementById('cfg-edit-system-id').parentElement;
    if (settingsSysIdFormGroup) settingsSysIdFormGroup.style.display = 'none';
  } else {
    const settingsSysIdFormGroup = document.getElementById('cfg-edit-system-id').parentElement;
    if (settingsSysIdFormGroup) settingsSysIdFormGroup.style.display = 'block';
  }
  
  document.body.classList.add('admin-mode');
  document.getElementById('admin-portal').classList.remove('hidden');
  document.getElementById('admin-user-display').innerText = `${state.currentUser.Name} (${state.currentUser.Position})`;
  document.getElementById('admin-sidebar-shop-name').innerText = db.config.shop_name || 'EZY Pawnshop 2006';
  document.getElementById('admin-sidebar-user-name').innerText = (state.currentUser.Position || '') + ' ' + (state.currentUser.Name || '');
  
  // Switch to default admin view (dashboard)
  switchAdminScreen('dash', document.querySelector('.admin-nav-item'));
}

function switchAdminScreen(screenName, navItem) {
  // Update nav item classes
  document.querySelectorAll('.admin-nav .admin-nav-item').forEach(item => {
    item.classList.remove('active');
  });
  navItem.classList.add('active');
  
  // Hide all screens
  document.querySelectorAll('.admin-viewport .admin-screen').forEach(screen => {
    screen.classList.add('hidden');
    screen.classList.remove('active');
  });
  
  // Show target
  const target = document.getElementById(`scr-${screenName}`);
  target.classList.remove('hidden');
  target.classList.add('active');
  
  // Title mapping
  const titleMap = {
    dash: 'Dashboard สรุปยอดสะสมการรับชำระดอกเบี้ย',
    reconcile: 'จัดการชำระดอกเบี้ย',
    report: 'รายงานส่งดอกเบี้ยออนไลน์ผ่านเว็บแอปพลิเคชัน',
    sync: 'อัปเดตข้อมูลไฟล์ฐานข้อมูล Cloud',
    backup: 'สำรองข้อมูลความปลอดภัยขึ้น Cloud (Cloudflare)',
    users: 'จัดการแฟ้มข้อมูลผู้ดูแลระบบ (User)',
    settings: 'ตั้งค่าการทำงานและฐานข้อมูลระบบ',
    help: 'คู่มือระบบจัดการสำหรับผู้ดูแลระบบ'
  };
  document.getElementById('admin-view-title').innerText = titleMap[screenName] || 'Admin Portal';
  
  // Render functions
  if (screenName === 'dash') {
    renderAdminDashboard();
  } else if (screenName === 'reconcile') {
    const dateInput = document.getElementById('filter-date');
    const dateInputHidden = document.getElementById('filter-date-hidden');
    if (dateInputHidden && !dateInputHidden.value) {
      const today = new Date();
      const pad = (num) => String(num).padStart(2, '0');
      const todayVal = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`; // YYYY-MM-DD
      dateInputHidden.value = todayVal;
      
      const todayDisplay = `${pad(today.getDate())}/${pad(today.getMonth()+1)}/${today.getFullYear()}`; // DD/MM/YYYY
      if (dateInput) dateInput.value = todayDisplay;
    }
    renderAdminReconcile();
  } else if (screenName === 'report') {
    const startInput = document.getElementById('report-filter-start-date');
    const startInputHidden = document.getElementById('report-filter-start-date-hidden');
    const endInput = document.getElementById('report-filter-end-date');
    const endInputHidden = document.getElementById('report-filter-end-date-hidden');
    
    const today = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const todayVal = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`; // YYYY-MM-DD
    const todayDisplay = `${pad(today.getDate())}/${pad(today.getMonth()+1)}/${today.getFullYear()}`; // DD/MM/YYYY
    
    if (startInputHidden && !startInputHidden.value) {
      startInputHidden.value = todayVal;
      if (startInput) startInput.value = todayDisplay;
    }
    if (endInputHidden && !endInputHidden.value) {
      endInputHidden.value = todayVal;
      if (endInput) endInput.value = todayDisplay;
    }
    renderAdminReport();
  } else if (screenName === 'users') {
    renderAdminUsers();
  } else if (screenName === 'settings') {
    renderAdminSettings();
  } else if (screenName === 'sync') {
    renderSyncHistory();
  } else if (screenName === 'backup') {
    renderBackupHistory();
  }
  updateSystemVersionDisplay();
}

function renderAdminDashboard() {
  // Calculate analytics
  const approvedPayments = db.payments.filter(p => p.BillType === '2');
  
  // Total sum of all tickets paid
  let aggregateTotal = 0;
  let aggregateCount = 0;
  approvedPayments.forEach(p => {
    const t = db.tickets.find(tick => 
      Number(tick.SystemID) === Number(p.SystemID) && 
      Number(tick.BudYear) === Number(p.BudYear) && 
      Number(tick.BookNo) === Number(p.BookNo) && 
      Number(tick.DocNo) === Number(p.DocNo)
    );
    if (t) {
      aggregateTotal += getSafeInterest(t);
      aggregateCount++;
    }
  });
  
  // Today's total (dynamic system date + simulated fallback)
  const today = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const todayStr = `${today.getFullYear()}/${pad(today.getMonth()+1)}/${pad(today.getDate())}`;
  
  let todayTotal = 0;
  let todayCount = 0;
  approvedPayments.forEach(p => {
    if (p.BillDate && (p.BillDate.startsWith(todayStr) || p.BillDate.startsWith('2026/07/22'))) {
      const t = db.tickets.find(tick => 
        Number(tick.SystemID) === Number(p.SystemID) && 
        Number(tick.BudYear) === Number(p.BudYear) && 
        Number(tick.BookNo) === Number(p.BookNo) && 
        Number(tick.DocNo) === Number(p.DocNo)
      );
      if (t) {
        todayTotal += getSafeInterest(t);
        todayCount++;
      }
    }
  });

  // Current Month total
  const monthStr = `${today.getFullYear()}/${pad(today.getMonth()+1)}`;
  let monthTotal = 0;
  let monthCount = 0;
  approvedPayments.forEach(p => {
    if (p.BillDate && (p.BillDate.startsWith(monthStr) || p.BillDate.startsWith('2026/07'))) {
      const t = db.tickets.find(tick => 
        Number(tick.SystemID) === Number(p.SystemID) && 
        Number(tick.BudYear) === Number(p.BudYear) && 
        Number(tick.BookNo) === Number(p.BookNo) && 
        Number(tick.DocNo) === Number(p.DocNo)
      );
      if (t) {
        monthTotal += getSafeInterest(t);
        monthCount++;
      }
    }
  });

  // Render values
  document.getElementById('dash-today-total').innerText = todayTotal.toLocaleString('th-TH', {minimumFractionDigits:2});
  document.getElementById('dash-today-count').innerText = todayCount;
  
  document.getElementById('dash-month-total').innerText = monthTotal.toLocaleString('th-TH', {minimumFractionDigits:2});
  document.getElementById('dash-month-count').innerText = monthCount;
  
  document.getElementById('dash-year-total').innerText = aggregateTotal.toLocaleString('th-TH', {minimumFractionDigits:2});
  document.getElementById('dash-year-count').innerText = aggregateCount;
  
  // Initialize Chart.js safely
  const ctx = document.getElementById('dashboardChart');
  if (ctx) {
    if (typeof Chart === 'undefined') {
      ctx.parentElement.innerHTML = `<div style="text-align: center; color: var(--text-medium); padding: 20px; font-size: 13px;">
        <i class="fa-solid fa-triangle-exclamation" style="color: var(--accent-gold); font-size: 18px;"></i><br>
        ไม่สามารถโหลดไลบรารี Chart.js ได้ (โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต)
      </div>`;
    } else {
      if (state.adminChart) {
        state.adminChart.destroy();
      }
      
      // Group payments dynamically by month
      const monthlySum = { Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 };
      const monthlyCount = { Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 };
      const monthKeys = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      approvedPayments.forEach(p => {
        if (!p.BillDate) return;
        const parts = p.BillDate.split('/');
        if (parts.length >= 2) {
          const monthIdx = parseInt(parts[1], 10) - 1;
          if (monthIdx >= 0 && monthIdx < 12) {
            const t = db.tickets.find(tick => 
              Number(tick.SystemID) === Number(p.SystemID) && 
              Number(tick.BudYear) === Number(p.BudYear) && 
              Number(tick.BookNo) === Number(p.BookNo) && 
              Number(tick.DocNo) === Number(p.DocNo)
            );
            if (t) {
              monthlySum[monthKeys[monthIdx]] += getSafeInterest(t);
              monthlyCount[monthKeys[monthIdx]] += 1;
            }
          }
        }
      });
      
      // July gets simulated totals fallback
      monthlySum.Jul = Math.max(160, monthlySum.Jul);
      monthlyCount.Jul = Math.max(1, monthlyCount.Jul);
      
      state.adminChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
        datasets: [
          {
            label: 'ยอดชำระดอกเบี้ยรวม (บาท)',
            data: Object.values(monthlySum),
            borderColor: '#B30006',
            backgroundColor: 'rgba(179, 0, 6, 0.05)',
            fill: true,
            tension: 0.3,
            borderWidth: 3,
            pointBackgroundColor: '#D4AF37',
            pointBorderColor: '#B30006',
            pointRadius: 5,
            yAxisID: 'y'
          },
          {
            label: 'จำนวนรายการ (รายการ)',
            data: Object.values(monthlyCount),
            type: 'bar',
            borderColor: '#D4AF37',
            backgroundColor: 'rgba(212, 175, 55, 0.35)',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { size: 12, family: "'Inter', 'Outfit', sans-serif" }
            }
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            grid: { color: '#E5E5EA' },
            title: {
              display: true,
              text: 'ยอดเงินดอกเบี้ย (บาท)',
              color: '#B30006',
              font: { weight: 'bold' }
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            title: {
              display: true,
              text: 'จำนวนรายการ (รายการ)',
              color: '#D4AF37',
              font: { weight: 'bold' }
            },
            ticks: {
              precision: 0
            }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  }
}
}

function renderAdminReconcile() {
  const tbody = document.getElementById('reconcile-table-body');
  tbody.innerHTML = '';
  
  // Read filter values
  const dateVal = document.getElementById('filter-date-hidden').value;
  const searchVal = document.getElementById('filter-search').value.toLowerCase().replace(/-/g, '');
  const sysConfigVal = db.config.system_id || 3;
  const systemIdEl = document.getElementById('filter-system-id');
  const systemIdContainer = document.getElementById('filter-system-id-container');
  const filterBar = document.querySelector('#scr-reconcile .filter-bar');
  
  // Always hide SystemID filter box
  if (systemIdContainer) {
    systemIdContainer.style.setProperty('display', 'none', 'important');
  }
  if (filterBar) {
    filterBar.style.gridTemplateColumns = '1.5fr 2fr auto';
  }
  
  if (Number(sysConfigVal) === 1) {
    if (systemIdEl && !systemIdEl.dataset.initialized) {
      systemIdEl.value = '1';
    }
  } else if (Number(sysConfigVal) === 2) {
    if (systemIdEl && !systemIdEl.dataset.initialized) {
      systemIdEl.value = '2';
    }
  } else {
    // Both systems (system_id = 3)
    if (systemIdEl && !systemIdEl.dataset.initialized) {
      systemIdEl.value = 'all';
      systemIdEl.dataset.initialized = 'true';
    }
  }
  const systemIdVal = systemIdEl ? systemIdEl.value : 'all';
  
  // Filter payments
  let filtered = db.payments;
  if (systemIdVal !== 'all') {
    filtered = filtered.filter(p => Number(p.SystemID) === Number(systemIdVal));
  }
  
  // Sort payments: เรียงลำดับ รหัสรับชำระ (BillNo) จากน้อยไปมาก
  filtered.sort((a, b) => {
    const billA = String(a.BillNo || '');
    const billB = String(b.BillNo || '');
    return billA.localeCompare(billB, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  if (dateVal) {
    // Format input YYYY-MM-DD into YYYY/MM/DD
    const searchDate = dateVal.replace(/-/g, '/');
    filtered = filtered.filter(p => p.BillDate.startsWith(searchDate));
  }
  
  if (searchVal) {
    filtered = filtered.filter(p => {
      const cust = db.customers.find(c => c.Id === p.Id);
      const nameMatch = cust ? cust.Name.toLowerCase().includes(searchVal) : false;
      const telMatch = cust ? cust.Tel.includes(searchVal) : false;
      const idMatch = p.Id.replace(/-/g, '').includes(searchVal);
      const billNoMatch = p.BillNo.toLowerCase().includes(searchVal);
      return nameMatch || telMatch || idMatch || billNoMatch;
    });
  }
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-light); padding: 30px;">ไม่พบรายการชำระเงินที่ต้องการ</td></tr>`;
    updateSystemVersionDisplay();
    return;
  }
  
  filtered.forEach(p => {
    const cust = db.customers.find(c => c.Id === p.Id);
    const tick = db.tickets.find(t => 
      Number(t.SystemID) === Number(p.SystemID) && 
      Number(t.BudYear) === Number(p.BudYear) && 
      Number(t.BookNo) === Number(p.BookNo) && 
      Number(t.DocNo) === Number(p.DocNo)
    );
    const tr = document.createElement('tr');
    
    // Status text & colors
    let statusBadge = '';
    if (p.BillType === '9') {
      statusBadge = '<span class="ticket-badge badge-pending">รออนุมัติ</span>';
    } else if (p.BillType === '2') {
      statusBadge = '<span class="ticket-badge badge-paid" style="background-color: var(--success-green);">อนุมัติแล้ว</span>';
    }
    
    // Display thumbnail of slip
    const slipHtml = p.Slip ? 
      `<img src="${p.Slip}" style="height: 32px; max-width: 60px; object-fit: contain; cursor: pointer; border: 1px solid var(--border-light); border-radius: 4px;" onclick="showImageViewer('${p.Slip}')" title="กดซูมดูรูป">` 
      : 'ไม่มีรูป';
      
    const formattedDate = formatThaiDate(p.BillDate.split(' ')[0]) + ' ' + p.BillDate.split(' ')[1].substring(0, 5) + ' น.';
    const customerName = cust ? cust.Name : 'ไม่ทราบชื่อ';
    const ticketDetails = tick ? `${tick.Model} (เล่ม ${tick.BookNo} เลขที่ ${tick.DocNo})` : `เลขที่ ${p.DocNo}`;
    const interestAmtVal = tick ? tick.Totalint : 0;
    
    // Select checkbox enabled only for "pending" status
    const checkboxHtml = p.BillType === '9' ? `
      <label class="checkbox-container">
        <input type="checkbox" name="reconcile-checkbox" value="${p.SystemID}_${p.BudYear}_${p.BookNo}_${p.DocNo}">
        <span class="checkmark"></span>
      </label>
    ` : '<i class="fa-solid fa-circle-check" style="color: var(--success-green);"></i>';
    
    tr.innerHTML = `
      <td style="text-align: center;">${checkboxHtml}</td>
      <td class="number" style="font-weight: 600;">${p.BillNo}</td>
      <td>
        <span style="font-weight: 600;">${customerName}</span><br>
        <span class="number" style="font-size: 12px; color: var(--text-medium);">${p.Id}</span>
      </td>
      <td class="number">${formattedDate}</td>
      <td style="font-size: 13px; max-width: 200px;">${ticketDetails}</td>
      <td style="text-align: center;">${slipHtml}</td>
      <td class="number" style="font-weight: 700; color: var(--primary-red); text-align: right;">${interestAmtVal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
      <td>${statusBadge}</td>
      <td style="text-align: center;">
        <button class="btn btn-secondary" style="width: auto; padding: 6px 10px; font-size: 12px; border-radius: 6px;" onclick="showReconcileDetailModal('${p.SystemID}', '${p.BudYear}', '${p.BookNo}', '${p.DocNo}')">
          <i class="fa-solid fa-eye"></i>
        </button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
  updateSystemVersionDisplay();
}

function applyReconcileFilters() {
  renderAdminReconcile();
}

function clearReconcileFilters() {
  const dateInput = document.getElementById('filter-date');
  const dateInputHidden = document.getElementById('filter-date-hidden');
  
  const today = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const todayVal = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`; // YYYY-MM-DD
  const todayDisplay = `${pad(today.getDate())}/${pad(today.getMonth()+1)}/${today.getFullYear()}`; // DD/MM/YYYY
  
  if (dateInputHidden) dateInputHidden.value = todayVal;
  if (dateInput) dateInput.value = todayDisplay;
  
  document.getElementById('filter-search').value = '';
  
  const systemIdEl = document.getElementById('filter-system-id');
  if (systemIdEl) {
    const sysConfigVal = db.config.system_id || 3;
    systemIdEl.value = Number(sysConfigVal) === 3 ? 'all' : String(sysConfigVal);
  }
  
  renderAdminReconcile();
}

function toggleSelectAllReconcile(master) {
  const checkboxes = document.getElementsByName('reconcile-checkbox');
  checkboxes.forEach(cb => cb.checked = master.checked);
}

// Reconcile detail viewer modal (The two-column details and slip popup)
function showReconcileDetailModal(systemId, budYear, bookNo, docNo) {
  const pay = db.payments.find(p => 
    Number(p.SystemID) === Number(systemId) && 
    Number(p.BudYear) === Number(budYear) && 
    Number(p.BookNo) === Number(bookNo) && 
    Number(p.DocNo) === Number(docNo)
  );
  if (!pay) return;
  
  const cust = db.customers.find(c => c.Id === pay.Id);
  const tick = db.tickets.find(t => 
    Number(t.SystemID) === Number(systemId) && 
    Number(t.BudYear) === Number(budYear) && 
    Number(t.BookNo) === Number(bookNo) && 
    Number(t.DocNo) === Number(docNo)
  );
  
  // Format info
  const custName = cust ? cust.Name : '-';
  const itemModel = tick ? tick.Model : '-';
  const asstotal = tick ? tick.Asstotal : 0;
  const monthInt = tick ? tick.MonthInt : 0;
  const months = tick ? tick.MonthTotal : 0;
  const interest = tick ? tick.Totalint : 0;
  const appDateStr = tick ? formatThaiDate(tick.AppDate) : '-';
  const expDateStr = tick ? formatThaiDate(tick.ExpDate) : '-';
  const formattedDate = formatThaiDate(pay.BillDate.split(' ')[0]) + ' ' + pay.BillDate.split(' ')[1].substring(0, 5);
  const monthlyInterestVal = monthInt || (asstotal * 0.015);
  
  // Fields markup (left column)
  const fieldsContent = `
    <div style="background-color: var(--bg-light); padding: 16px; border-radius: var(--radius-md); border-left: 5px solid var(--primary-red); margin-bottom: 16px;">
      <h4 style="font-size: 14px; margin-bottom: 12px; color: var(--primary-red); font-weight: 700;">ข้อมูลการชำระเงิน</h4>
      <div style="display: grid; grid-template-columns: 1fr; gap: 8px; font-size: 13px;">
        <div><strong>รหัสชำระ (BillNo):</strong> <span class="number">${pay.BillNo}</span></div>
        <div><strong>ลูกค้า:</strong> ${custName}</div>
        <div><strong>เลขบัตรประชาชน:</strong> ${pay.Id}</div>
        <div><strong>วันที่ชำระเงิน:</strong> ${formattedDate} น.</div>
      </div>
    </div>

    <div style="background-color: var(--bg-light); padding: 16px; border-radius: var(--radius-md); border-left: 5px solid var(--accent-gold); font-size: 13px;">
      <h4 style="font-size: 14px; margin-bottom: 12px; color: var(--accent-gold); font-weight: 700;">ข้อมูลตั๋วรับจำนำ</h4>
      <div style="display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 10px;">
        <div><strong>เล่มที่/เลขที่ตั๋ว:</strong> เล่ม ${pay.BookNo} เลขที่ ${pay.DocNo}</div>
        <div><strong>รายการทรัพย์สิน:</strong> ${itemModel}</div>
        <div><strong>วงเงินจำนำ:</strong> ${asstotal.toLocaleString('th-TH')} บาท</div>
        <div><strong>ดอกเบี้ย:</strong> ${monthlyInterestVal.toLocaleString('th-TH', {minimumFractionDigits: 2})} บาท</div>
        <div><strong>จำนวนเดือน:</strong> ${months} เดือน</div>
        <div><strong>วันที่จำนำ:</strong> ${appDateStr}</div>
        <div><strong>วันครบกำหนดตั๋ว:</strong> ${expDateStr}</div>
      </div>
      </div>
      <div style="border-top: 1px dashed var(--border-light); padding-top: 10px; color: var(--primary-red); font-size: 15px; font-weight: 700; display: flex; justify-content: space-between;">
        <span>ยอดดอกเบี้ยชำระรวม:</span>
        <span>${interest.toLocaleString('th-TH', {minimumFractionDigits: 2})} บาท</span>
      </div>
    </div>
  `;
  
  // Set fields and slip image src
  document.getElementById('reconcile-detail-fields').innerHTML = fieldsContent;
  
  const slipImg = document.getElementById('reconcile-detail-slip-img');
  if (pay.Slip) {
    slipImg.src = pay.Slip;
    slipImg.parentElement.style.display = 'flex';
  } else {
    slipImg.src = '';
    slipImg.parentElement.style.display = 'none';
  }
  
  // Configure action buttons (bottom row)
  const actionsContainer = document.getElementById('reconcile-detail-actions');
  actionsContainer.innerHTML = '';
  
  if (pay.BillType === '9') {
    // Approve Button
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'btn btn-primary';
    approveBtn.style.backgroundColor = 'var(--success-green)';
    approveBtn.style.backgroundImage = 'none';
    approveBtn.style.width = 'auto';
    approveBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> อนุมัติรายการชำระดอกเบี้ย';
    approveBtn.onclick = () => {
      approveSinglePayment(pay.SystemID, pay.BudYear, pay.BookNo, pay.DocNo);
      closeReconcileDetailModal();
    };
    actionsContainer.appendChild(approveBtn);
  }
  
  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary';
  closeBtn.style.width = 'auto';
  closeBtn.innerHTML = 'ปิดหน้าต่าง';
  closeBtn.onclick = () => closeReconcileDetailModal();
  actionsContainer.appendChild(closeBtn);
  
  // Open modal overlay
  document.getElementById('reconcile-detail-modal').classList.add('active');
}

function closeReconcileDetailModal() {
  document.getElementById('reconcile-detail-modal').classList.remove('active');
}

// Approve a single payment transaction
function approveSinglePayment(systemId, budYear, bookNo, docNo) {
  const pay = db.payments.find(p => 
    Number(p.SystemID) === Number(systemId) && 
    Number(p.BudYear) === Number(budYear) && 
    Number(p.BookNo) === Number(bookNo) && 
    Number(p.DocNo) === Number(docNo)
  );
  if (!pay) return;
  
  // Change payment status to approved
  pay.BillType = '2'; // ชำระแล้ว
  
  const ticket = db.tickets.find(t => 
    Number(t.SystemID) === Number(systemId) && 
    Number(t.BudYear) === Number(budYear) && 
    Number(t.BookNo) === Number(bookNo) && 
    Number(t.DocNo) === Number(docNo)
  );
  if (ticket) {
    // Update old ticket to paid / interest paid success
    ticket.BillStat = 'I'; // ส่งดอกสำเร็จแล้ว
    ticket.BillType = '2'; // ชำระแล้ว
    
    // Generate BillBookNo & BillDocNo for tax receipt
    const lastBookNo = db.tickets.reduce((max, t) => Math.max(max, Number(t.BillBookNo || 0)), 0);
    const lastDocNo = db.tickets.reduce((max, t) => Math.max(max, Number(t.BillDocNo || 0)), 0);
    ticket.BillBookNo = lastBookNo + 1;
    ticket.BillDocNo = lastDocNo + 1;
    
    // Pawn Extension: CREATE A NEW TICKET representing renewal!
    // Expiration date moves by 4 months
    const oldExp = new Date(ticket.ExpDate);
    const newExp = new Date(oldExp);
    newExp.setMonth(newExp.getMonth() + 4);
    
    const pad = (num) => String(num).padStart(2, '0');
    const newExpStr = `${newExp.getFullYear()}/${pad(newExp.getMonth()+1)}/${pad(newExp.getDate())}`;
    
    // AppDate is new renewal date
    const today = new Date();
    const newAppStr = `${today.getFullYear()}/${pad(today.getMonth()+1)}/${pad(today.getDate())} ${pad(today.getHours())}:${pad(today.getMinutes())}:00`;
    
    // Generate new document number
    const maxDocNo = db.tickets.reduce((max, t) => Math.max(max, t.DocNo), 0);
    
    const renewedTicket = {
      SystemID: ticket.SystemID,
      BudYear: ticket.BudYear,
      BookNo: ticket.BookNo,
      DocNo: maxDocNo + 1,
      BillType: '', // Blank = unpaid
      BillDate: '',
      BillNo: '',
      BillBookNo: '',
      BillDocNo: '',
      Asstotal: ticket.Asstotal, // Keep same principal
      Totalint: ticket.MonthInt * 1, // MonthInt * MonthTotal
      MonthTotal: 1,
      MonthInt: ticket.MonthInt,
      AppDate: newAppStr,
      ExpDate: newExpStr,
      Model: ticket.Model,
      BillStat: 'N', // N = active pawn
      Id: ticket.Id
    };
    
    db.tickets.push(renewedTicket);
  }
  
  saveDBTable('payments');
  saveDBTable('tickets');
  
  alert('อนุมัติการชำระดอกเบี้ยเรียบร้อยแล้ว! ออกใบต่อตั๋วฉบับใหม่เข้าระบบสำเร็จ');
  renderAdminReconcile();
}

// Batch approve checked items
function batchApprovePayments() {
  const checkboxes = document.getElementsByName('reconcile-checkbox');
  const selectedBills = [];
  checkboxes.forEach(cb => {
    if (cb.checked) selectedBills.push(cb.value);
  });
  
  if (selectedBills.length === 0) {
    alert('กรุณาเลือกรายการที่ต้องการอนุมัติอย่างน้อย 1 รายการ');
    return;
  }
  
  if (confirm(`คุณต้องการอนุมัติรายการชำระดอกเบี้ยที่เลือกทั้งหมด ${selectedBills.length} รายการ หรือไม่?`)) {
    selectedBills.forEach(key => {
      const parts = key.split('_');
      if (parts.length < 4) return;
      const sysId = Number(parts[0]);
      const budYear = Number(parts[1]);
      const bookNo = Number(parts[2]);
      const docNo = Number(parts[3]);
      
      const pay = db.payments.find(p => 
        Number(p.SystemID) === sysId && 
        Number(p.BudYear) === budYear && 
        Number(p.BookNo) === bookNo && 
        Number(p.DocNo) === docNo
      );
      if (pay) {
        pay.BillType = '2'; // Approved
        const ticket = db.tickets.find(t => 
          Number(t.SystemID) === sysId && 
          Number(t.BudYear) === budYear && 
          Number(t.BookNo) === bookNo && 
          Number(t.DocNo) === docNo
        );
        if (ticket) {
          ticket.BillStat = 'I';
          ticket.BillType = '2';
          
          const lastBookNo = db.tickets.reduce((max, t) => Math.max(max, Number(t.BillBookNo || 0)), 0);
          const lastDocNo = db.tickets.reduce((max, t) => Math.max(max, Number(t.BillDocNo || 0)), 0);
          ticket.BillBookNo = lastBookNo + 1;
          ticket.BillDocNo = lastDocNo + 1;
          
          // Renewal ticket
          const oldExp = new Date(ticket.ExpDate);
          const newExp = new Date(oldExp);
          newExp.setMonth(newExp.getMonth() + 4);
          const pad = (num) => String(num).padStart(2, '0');
          const newExpStr = `${newExp.getFullYear()}/${pad(newExp.getMonth()+1)}/${pad(newExp.getDate())}`;
          
          const today = new Date();
          const newAppStr = `${today.getFullYear()}/${pad(today.getMonth()+1)}/${pad(today.getDate())} ${pad(today.getHours())}:${pad(today.getMinutes())}:00`;
          
          const maxDocNo = db.tickets.reduce((max, t) => Math.max(max, t.DocNo), 0);
          
          const renewedTicket = {
            SystemID: ticket.SystemID,
            BudYear: ticket.BudYear,
            BookNo: ticket.BookNo,
            DocNo: maxDocNo + 1,
            BillType: '',
            BillDate: '',
            BillNo: '',
            BillBookNo: '',
            BillDocNo: '',
            Asstotal: ticket.Asstotal,
            Totalint: ticket.MonthInt * 1, // MonthInt * MonthTotal
            MonthTotal: 1,
            MonthInt: ticket.MonthInt,
            AppDate: newAppStr,
            ExpDate: newExpStr,
            Model: ticket.Model,
            BillStat: 'N',
            Id: ticket.Id
          };
          db.tickets.push(renewedTicket);
        }
      }
    });
    
    saveDBTable('payments');
    saveDBTable('tickets');
    
    alert(`อนุมัติสำเร็จเรียบร้อย ${selectedBills.length} รายการ!`);
    
    // Reset top check-all box
    document.getElementById('reconcile-select-all').checked = false;
    renderAdminReconcile();
  }
}

function renderAdminReport() {
  const tbody = document.getElementById('report-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const startVal = document.getElementById('report-filter-start-date-hidden') ? document.getElementById('report-filter-start-date-hidden').value : '';
  const endVal = document.getElementById('report-filter-end-date-hidden') ? document.getElementById('report-filter-end-date-hidden').value : '';
  const sysConfigVal = db.config.system_id || 3;
  const systemIdEl = document.getElementById('report-filter-system-id');
  const systemIdContainer = document.getElementById('report-filter-system-id-container');
  const filterBar = document.querySelector('#scr-report .filter-bar');
  
  // Always hide SystemID filter box
  if (systemIdContainer) {
    systemIdContainer.style.setProperty('display', 'none', 'important');
  }
  if (filterBar) {
    filterBar.style.gridTemplateColumns = '1.5fr 1.5fr auto';
  }
  
  if (Number(sysConfigVal) === 1) {
    if (systemIdEl && !systemIdEl.dataset.initialized) {
      systemIdEl.value = '1';
    }
  } else if (Number(sysConfigVal) === 2) {
    if (systemIdEl && !systemIdEl.dataset.initialized) {
      systemIdEl.value = '2';
    }
  } else {
    // Both systems (system_id = 3)
    if (systemIdEl && !systemIdEl.dataset.initialized) {
      systemIdEl.value = 'all';
      systemIdEl.dataset.initialized = 'true';
    }
  }
  const systemIdVal = systemIdEl ? systemIdEl.value : 'all';
  
  // Toggle print system indicator
  const indicatorEl = document.getElementById('report-print-system-indicator');
  if (indicatorEl) {
    if (systemIdVal === '2') {
      indicatorEl.style.display = 'block';
      indicatorEl.classList.remove('hidden-indicator');
    } else {
      indicatorEl.style.display = 'none';
      indicatorEl.classList.add('hidden-indicator');
    }
  }
  
  // Show approved payments
  let approved = db.payments.filter(p => p.BillType === '2');
  if (systemIdVal !== 'all') {
    approved = approved.filter(p => Number(p.SystemID) === Number(systemIdVal));
  }
  
  // Date filtering
  if (startVal) {
    approved = approved.filter(p => {
      const pDateStr = p.BillDate.split(' ')[0].replace(/\//g, '-');
      return pDateStr >= startVal;
    });
  }
  if (endVal) {
    approved = approved.filter(p => {
      const pDateStr = p.BillDate.split(' ')[0].replace(/\//g, '-');
      return pDateStr <= endVal;
    });
  }
  
  // Update Print-Only Header subtitle and footer timestamp
  const startFormatted = startVal ? formatThaiDate(startVal) : '';
  const endFormatted = endVal ? formatThaiDate(endVal) : '';
  let rangeText = 'รายการธุรกรรมทั้งหมด';
  if (startFormatted && endFormatted) {
    rangeText = `ประจำวันที่ ${startFormatted} ถึง วันที่ ${endFormatted}`;
  } else if (startFormatted) {
    rangeText = `ตั้งแต่วันที่ ${startFormatted}`;
  } else if (endFormatted) {
    rangeText = `จนถึงวันที่ ${endFormatted}`;
  }
  
  const subEl = document.getElementById('print-date-range-sub');
  if (subEl) subEl.innerText = rangeText;
  
  const shopSubEl = document.getElementById('print-shop-name-sub');
  if (shopSubEl) shopSubEl.innerText = db.config.shop_name || 'โรงรับจำนำ อีซี่ Pawnshop 2006';
  
  const now = new Date();
  const printTS = formatThaiDate(now) + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const tsEl = document.getElementById('print-timestamp-val-header');
  if (tsEl) tsEl.innerText = printTS;
  
  // Calculate and render Grand Total
  let grandCount = approved.length;
  let grandInterest = 0;
  approved.forEach(p => {
    const tick = db.tickets.find(t => 
      Number(t.SystemID) === Number(p.SystemID) && 
      Number(t.BudYear) === Number(p.BudYear) && 
      Number(t.BookNo) === Number(p.BookNo) && 
      Number(t.DocNo) === Number(p.DocNo)
    );
    if (tick) {
      grandInterest += getSafeInterest(tick);
    }
  });

  const summaryCountEl = document.getElementById('report-summary-count');
  if (summaryCountEl) summaryCountEl.innerText = grandCount;
  const summaryTotalEl = document.getElementById('report-summary-total');
  if (summaryTotalEl) summaryTotalEl.innerText = grandInterest.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' บาท';

  if (approved.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-light); padding: 30px;">ไม่มีรายการธุรกรรมในรายงานคัดกรองขณะนี้</td></tr>`;
    return;
  }

  // Sort approved payments chronologically (ascending) for date-grouping breakouts
  approved.sort((a, b) => new Date(a.BillDate) - new Date(b.BillDate));

  let lastDate = '';
  let lastMonth = '';
  
  let dailyInterest = 0;
  let dailyCount = 0;
  
  let monthlyInterest = 0;
  let monthlyCount = 0;
  
  function printDailySubtotal() {
    if (dailyCount === 0) return;
    const formattedDate = formatThaiDate(lastDate);
    const tr = document.createElement('tr');
    tr.style.backgroundColor = 'rgba(212, 175, 55, 0.08)'; // Light gold background
    tr.style.fontWeight = 'bold';
    tr.innerHTML = `
      <td colspan="6" style="text-align: right; color: var(--accent-gold); font-size: 13px; padding: 10px;">
        <i class="fa-solid fa-calendar-day"></i> ยอดรวมประจำวันที่ ${formattedDate} (${dailyCount} รายการ):
      </td>
      <td style="text-align: right; color: var(--primary-red); font-size: 14px; padding: 10px; border-top: 1px solid var(--border-light); border-bottom: 1px solid var(--border-light); font-weight: 700;" class="number">
        ${dailyInterest.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
      </td>
      <td></td>
    `;
    tbody.appendChild(tr);
    
    dailyInterest = 0;
    dailyCount = 0;
  }
  
  function printMonthlySubtotal() {
    if (monthlyCount === 0) return;
    const parts = lastMonth.split('/');
    const monthIndex = parseInt(parts[1] || lastMonth.split('-')[1], 10);
    const thaiMonths = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const thaiMonthName = thaiMonths[monthIndex] || lastMonth;
    const thaiYearStr = parseInt(parts[0], 10) + 543;
    
    const tr = document.createElement('tr');
    tr.style.backgroundColor = 'rgba(179, 0, 6, 0.05)'; // Light red background
    tr.style.fontWeight = '800';
    tr.style.borderTop = '2px solid var(--primary-red)';
    tr.style.borderBottom = '2px solid var(--primary-red)';
    tr.innerHTML = `
      <td colspan="6" style="text-align: right; color: var(--primary-red); font-size: 13px; padding: 12px;">
        <i class="fa-solid fa-calendar-days"></i> ยอดรวมประจำเดือน ${thaiMonthName} พ.ศ. ${thaiYearStr} (${monthlyCount} รายการ):
      </td>
      <td style="text-align: right; color: var(--primary-red); font-size: 15px; padding: 12px; font-weight: 800;" class="number">
        ${monthlyInterest.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
      </td>
      <td></td>
    `;
    tbody.appendChild(tr);
    
    monthlyInterest = 0;
    monthlyCount = 0;
  }

  approved.forEach(p => {
    const pDate = p.BillDate.split(' ')[0].replace(/-/g, '/'); // Normalize to YYYY/MM/DD
    const pMonth = pDate.substring(0, 7); // YYYY/MM
    
    if (lastMonth && pMonth !== lastMonth) {
      printDailySubtotal();
      printMonthlySubtotal();
    } else if (lastDate && pDate !== lastDate) {
      printDailySubtotal();
    }
    
    lastDate = pDate;
    lastMonth = pMonth;
    
    const cust = db.customers.find(c => c.Id === p.Id);
    const tick = db.tickets.find(t => 
      Number(t.SystemID) === Number(p.SystemID) && 
      Number(t.BudYear) === Number(p.BudYear) && 
      Number(t.BookNo) === Number(p.BookNo) && 
      Number(t.DocNo) === Number(p.DocNo)
    );
    
    const custName = cust ? cust.Name : '-';
    const appDateFormatted = formatThaiDate(p.BillDate.split(' ')[0]) + ' ' + p.BillDate.split(' ')[1].substring(0, 5);
    const model = tick ? tick.Model : '-';
    const asstotal = tick ? tick.Asstotal : 0;
    const interest = getSafeInterest(tick);
    
    dailyInterest += interest;
    dailyCount++;
    monthlyInterest += interest;
    monthlyCount++;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="number">${p.BillNo}</td>
      <td>${custName}</td>
      <td class="number">${appDateFormatted}</td>
      <td class="number">เล่ม ${p.BookNo} เลขที่ ${p.DocNo}</td>
      <td>${model}</td>
      <td class="number" style="text-align: right;">${asstotal.toLocaleString('th-TH')}</td>
      <td class="number" style="text-align: right; font-weight: 700; color: var(--primary-red);">${interest.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
      <td style="text-align: left;"><span class="ticket-badge badge-paid" style="background-color: var(--success-green); padding: 4px 8px; border-radius: 4px; display: inline-block;">อนุมัติแล้ว</span></td>
    `;
    tbody.appendChild(tr);
  });
  
  if (approved.length > 0) {
    printDailySubtotal();
    printMonthlySubtotal();
  }
  updateSystemVersionDisplay();
}

function clearReportFilter() {
  const startInput = document.getElementById('report-filter-start-date');
  const startInputHidden = document.getElementById('report-filter-start-date-hidden');
  const endInput = document.getElementById('report-filter-end-date');
  const endInputHidden = document.getElementById('report-filter-end-date-hidden');
  const systemIdEl = document.getElementById('report-filter-system-id');
  
  const today = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const todayVal = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`; // YYYY-MM-DD
  const todayDisplay = `${pad(today.getDate())}/${pad(today.getMonth()+1)}/${today.getFullYear()}`; // DD/MM/YYYY
  
  if (startInputHidden) startInputHidden.value = todayVal;
  if (startInput) startInput.value = todayDisplay;
  
  if (endInputHidden) endInputHidden.value = todayVal;
  if (endInput) endInput.value = todayDisplay;
  
  if (systemIdEl) {
    const sysConfigVal = db.config.system_id || 3;
    systemIdEl.value = Number(sysConfigVal) === 3 ? 'all' : String(sysConfigVal);
  }
  
  renderAdminReport();
}

function renderAdminUsers() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  db.users.forEach(u => {
    const tr = document.createElement('tr');
    
    // Disable delete on current user to prevent self-deletion
    const isSelf = u.UserID === state.currentUser.UserID;
    const deleteBtnHtml = isSelf ? 
      `<button type="button" class="btn btn-secondary" style="width: auto; padding: 6px 10px; font-size: 12px; border-radius: 6px; opacity: 0.5; cursor: not-allowed;" disabled title="ไม่สามารถลบตัวเองได้"><i class="fa-solid fa-trash-can"></i></button>` : 
      `<button type="button" class="btn btn-outline" style="width: auto; padding: 6px 10px; font-size: 12px; border-radius: 6px; color: var(--primary-red); border-color: var(--primary-red); margin-left: 6px;" onclick="deleteUser('${u.UserID}')"><i class="fa-solid fa-trash-can"></i></button>`;
      
    tr.innerHTML = `
      <td style="font-weight: 600;" class="number">${u.UserID}</td>
      <td>${u.Name}</td>
      <td>${u.Position}</td>
      <td><span class="ticket-badge badge-paid" style="background-color: var(--primary-red-light); color: var(--primary-red);">Active</span></td>
      <td style="text-align: center; display: flex; gap: 4px; justify-content: center;">
        <button type="button" class="btn btn-secondary" style="width: auto; padding: 6px 10px; font-size: 12px; border-radius: 6px;" onclick="openEditUserModal('${u.UserID}')">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        ${deleteBtnHtml}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function populatePositionsDropdown(selectedValue) {
  const select = document.getElementById('user-crud-pos');
  if (!select) return;
  select.innerHTML = '';
  db.positions.forEach(pos => {
    const opt = document.createElement('option');
    opt.value = pos;
    opt.innerText = pos;
    if (pos === selectedValue) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function openAddUserModal() {
  document.getElementById('user-crud-title').innerText = 'เพิ่มผู้ใช้งานระบบใหม่';
  document.getElementById('user-crud-mode').value = 'add';
  document.getElementById('user-crud-id').value = '';
  document.getElementById('user-crud-id').disabled = false;
  document.getElementById('user-crud-name').value = '';
  document.getElementById('user-crud-pass').value = '';
  
  populatePositionsDropdown(db.positions[0] || 'ผู้จัดการ');
  
  document.getElementById('user-crud-modal').classList.add('active');
}

function openEditUserModal(userId) {
  const user = db.users.find(u => u.UserID === userId);
  if (!user) return;
  
  document.getElementById('user-crud-title').innerText = 'แก้ไขข้อมูลผู้ใช้งานระบบ';
  document.getElementById('user-crud-mode').value = 'edit';
  document.getElementById('user-crud-old-id').value = user.UserID;
  
  document.getElementById('user-crud-id').value = user.UserID;
  document.getElementById('user-crud-id').disabled = true; // ID cannot be edited
  document.getElementById('user-crud-name').value = user.Name;
  document.getElementById('user-crud-pass').value = user.Password;
  
  populatePositionsDropdown(user.Position);
  
  document.getElementById('user-crud-modal').classList.add('active');
}

function closeUserCrudModal() {
  document.getElementById('user-crud-modal').classList.remove('active');
}

function saveUserCrud() {
  const mode = document.getElementById('user-crud-mode').value;
  const userId = document.getElementById('user-crud-id').value.trim();
  const name = document.getElementById('user-crud-name').value.trim();
  const pass = document.getElementById('user-crud-pass').value.trim();
  const pos = document.getElementById('user-crud-pos').value;
  
  if (mode === 'add') {
    // Check duplication
    const exist = db.users.some(u => u.UserID.toLowerCase() === userId.toLowerCase());
    if (exist) {
      alert('ขออภัย: รหัสพนักงาน (UserID) นี้มีอยู่ในระบบแล้ว!');
      return;
    }
    
    db.users.push({ UserID: userId, Password: pass, Name: name, Position: pos });
  } else {
    // Edit mode
    const oldId = document.getElementById('user-crud-old-id').value;
    const user = db.users.find(u => u.UserID === oldId);
    if (user) {
      user.Name = name;
      user.Password = pass;
      user.Position = pos;
    }
  }
  
  saveDBTable('users');
  renderAdminUsers();
  closeUserCrudModal();
  alert('บันทึกข้อมูลผู้ใช้งานระบบเสร็จสิ้น!');
}

function deleteUser(userId) {
  if (confirm(`คุณต้องการลบผู้ใช้งาน: ${userId} ออกจากระบบใช่หรือไม่?`)) {
    const idx = db.users.findIndex(u => u.UserID === userId);
    if (idx !== -1) {
      db.users.splice(idx, 1);
      saveDBTable('users');
      renderAdminUsers();
      alert('ลบผู้ใช้งานเรียบร้อยแล้ว!');
    }
  }
}

// ==================== 4.5 SYSTEM SETTINGS LOGIC (BANK INFO & POSITIONS CRUD) ====================
function renderAdminSettings() {
  // 1. Load Bank and Shop settings into inputs
  document.getElementById('cfg-edit-shop-name').value = db.config.shop_name || '';
  document.getElementById('cfg-edit-bank-logo').value = db.config.bank_logo || '';
  document.getElementById('cfg-edit-bank-name').value = db.config.bank_name || '';
  document.getElementById('cfg-edit-bank-acc').value = db.config.bank_acc || '';
  document.getElementById('cfg-edit-bank-acc-name').value = db.config.bank_acc_name || '';
  document.getElementById('cfg-edit-system-id').value = db.config.system_id || 1;
  
  const colorVal = db.config.bank_color || '#178e3d';
  document.getElementById('cfg-edit-bank-color').value = colorVal;
  document.getElementById('cfg-edit-bank-color-picker').value = colorVal;
  
  // 2. Render positions table
  renderAdminPositions();
}

function applyBankSettingsToUI() {
  // Always read latest config from localStorage or memory
  let cfg = db.config;
  try {
    const raw = localStorage.getItem('pawn_config');
    if (raw) {
      cfg = JSON.parse(raw);
      db.config = cfg;
    }
  } catch(e) {}
  if (!cfg) cfg = {};
  
  // 1. Bank Name
  const nameEl = document.getElementById('cfg-bank-name');
  if (nameEl) nameEl.innerText = cfg.bank_name || 'ธนาคารกสิกรไทย';
  
  // 2. Bank Acc
  const accEl = document.getElementById('cfg-bank-acc');
  if (accEl) accEl.innerText = cfg.bank_acc || '026-8-91256-0';
  
  // 3. Bank Acc Name
  const accNameEl = document.getElementById('cfg-bank-acc-name');
  if (accNameEl) accNameEl.innerText = cfg.bank_acc_name || 'บจ. อีซี่ โรงรับจำนำ 2006';

  // 4. Smart Bank Color Detection
  let customColor = cfg.bank_color || '';
  const bankNameStr = String(cfg.bank_name || '').toLowerCase();
  const bankLogoStr = String(cfg.bank_logo || '').toUpperCase();
  
  if (!customColor || customColor === '#178e3d') {
    if (bankLogoStr.includes('KTB') || bankNameStr.includes('กรุงไทย')) customColor = '#00a5e5';
    else if (bankLogoStr.includes('SCB') || bankNameStr.includes('ไทยพาณิชย์')) customColor = '#4e2a84';
    else if (bankLogoStr.includes('BBL') || bankNameStr.includes('กรุงเทพ')) customColor = '#1e4598';
    else if (bankLogoStr.includes('BAY') || bankNameStr.includes('กรุงศรี')) customColor = '#fec43b';
    else if (bankLogoStr.includes('TTB') || bankNameStr.includes('ทหารไทย')) customColor = '#002d63';
    else if (bankLogoStr.includes('GSB') || bankNameStr.includes('ออมสิน')) customColor = '#eb1985';
    else if (bankLogoStr.includes('KB') || bankNameStr.includes('กสิกร')) customColor = '#178e3d';
    else customColor = cfg.bank_color || '#178e3d';
  }

  // 5. Bank Logo (Image or Text)
  const logoEl = document.getElementById('cfg-bank-logo');
  const logoVal = String(cfg.bank_logo || 'KB').trim();
  const isImagePath = /\.(jpg|jpeg|png|gif|ico|webp)$/i.test(logoVal) || logoVal.includes('\\') || logoVal.includes('/') || logoVal.startsWith('data:') || logoVal.startsWith('http');
  
  if (logoEl) {
    if (isImagePath) {
      let srcVal = logoVal;
      if (srcVal.includes('\\') || srcVal.includes('/')) {
        const parts = srcVal.split(/[\\/]/);
        srcVal = parts[parts.length - 1];
      }
      logoEl.innerHTML = `<img src="${srcVal}" alt="Bank Logo" style="width: 100%; height: 100%; object-fit: contain; border-radius: 50%; display: block;" onerror="this.onerror=null; this.parentNode.innerText='${logoVal.substring(0,4)}'; this.parentNode.style.backgroundColor='${customColor}'; this.parentNode.style.color='#ffffff';">`;
      logoEl.style.setProperty('padding', '0', 'important');
      logoEl.style.setProperty('background', 'transparent', 'important');
      logoEl.style.setProperty('border', '1px solid ' + customColor, 'important');
    } else {
      logoEl.innerText = logoVal || 'KB';
      logoEl.style.setProperty('padding', '', '');
      logoEl.style.setProperty('background-color', customColor, 'important');
      logoEl.style.setProperty('color', '#ffffff', 'important');
      logoEl.style.setProperty('font-weight', '800', 'important');
      logoEl.style.setProperty('border', 'none', 'important');
    }
  }

  // 6. Bank Card Styling (border, background tint)
  const bankCard = document.querySelector('.bank-info-card');
  if (bankCard) {
    bankCard.className = 'bank-info-card'; // reset classes
    bankCard.style.setProperty('background-color', customColor + '18', 'important'); // 18% opacity tint
    bankCard.style.setProperty('border-left', '6px solid ' + customColor, 'important');
    bankCard.style.setProperty('border-color', customColor, 'important');
  }

  // 7. Admin Sidebar Shop Name
  const sidebarShopEl = document.getElementById('admin-sidebar-shop-name');
  if (sidebarShopEl && cfg.shop_name) sidebarShopEl.innerText = cfg.shop_name;
}

async function saveBankSettings() {
  const shopName = document.getElementById('cfg-edit-shop-name').value.trim();
  const logo = document.getElementById('cfg-edit-bank-logo').value.trim();
  const name = document.getElementById('cfg-edit-bank-name').value.trim();
  const acc = document.getElementById('cfg-edit-bank-acc').value.trim();
  const accName = document.getElementById('cfg-edit-bank-acc-name').value.trim();
  const color = document.getElementById('cfg-edit-bank-color').value.trim();
  const systemId = parseInt(document.getElementById('cfg-edit-system-id').value, 10) || 1;
  
  db.config.shop_name = shopName;
  db.config.bank_logo = logo;
  db.config.bank_name = name;
  db.config.bank_acc = acc;
  db.config.bank_acc_name = accName;
  db.config.bank_color = color;
  db.config.system_id = systemId;
  
  // 1. บันทึกลงในเครื่อง (LocalStorage) และอัปเดต UI ทันที
  localStorage.setItem('pawn_config', JSON.stringify(db.config));
  applyBankSettingsToUI();
  
  // 2. แสดงสถานะกำลังบันทึกที่ปุ่ม
  const submitBtn = document.querySelector('#bank-settings-form button[type="submit"]');
  const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกข้อมูลขึ้น Cloudflare...';
  }
  
  // 3. ตรวจสอบการบันทึกขึ้น Cloudflare ว่าสำเร็จหรือไม่
  let cloudSuccess = false;
  let cloudErrMsg = '';
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s Timeout
    
    // ลองส่งไปยัง /api/config
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: db.config }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const resData = await res.json();
      if (resData && resData.success !== false) {
        cloudSuccess = true;
      } else {
        cloudErrMsg = resData.error || resData.message || 'Cloudflare ปฏิเสธคำขอ';
      }
    } else if (res.ok) {
      // ตอบกลับ 200 OK
      cloudSuccess = true;
    } else {
      // หาก /api/config ไม่ตอบสนอง ลองส่งผ่าน /api/sync สำรอง
      const controllerSync = new AbortController();
      const timeoutSyncId = setTimeout(() => controllerSync.abort(), 10000);
      const resSync = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: db.config }),
        signal: controllerSync.signal
      });
      clearTimeout(timeoutSyncId);
      
      const syncContentType = resSync.headers.get('content-type') || '';
      if (resSync.ok && syncContentType.includes('application/json')) {
        const syncData = await resSync.json();
        if (syncData && syncData.success !== false) {
          cloudSuccess = true;
        } else {
          cloudErrMsg = syncData.error || 'สถานะตอบกลับ: ' + resSync.status;
        }
      } else if (resSync.ok) {
        cloudSuccess = true;
      } else {
        cloudErrMsg = `HTTP Status: ${res.status} (${res.statusText || 'Error'})`;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      cloudErrMsg = 'หมดเวลาการเชื่อมต่อ (Request Timeout 10s) กรุณาตรวจสอบอินเทอร์เน็ต';
    } else {
      cloudErrMsg = err.message || 'ไม่สามารถติดต่อ Cloudflare Server ได้';
    }
  } finally {
    // คืนสถานะปุ่มบันทึก
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml || '<i class="fa-solid fa-floppy-disk"></i> บันทึกข้อมูลตั้งค่าระบบ';
    }
  }
  
  // 4. แจ้งเตือนผลลัพธ์การบันทึกอย่างชัดเจน
  if (cloudSuccess) {
    alert('✅ บันทึกข้อมูลตั้งค่าการทำงานและฐานข้อมูลระบบขึ้น Cloudflare สำเร็จ!\n\nอัปเดตไฟล์ pawn_config.json บนระบบเรียบร้อยแล้ว\n');
  } else {
    alert(`❌ บันทึกข้อมูลขึ้น Cloudflare ไม่สำเร็จ!\nสาเหตุ: ${cloudErrMsg}\n\n(ระบบได้บันทึกค่าลงในเบราว์เซอร์นี้ไว้เรียบร้อยแล้ว กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือ Cloudflare อีกครั้ง)\n`);
  }
}

function renderAdminPositions() {
  const tbody = document.getElementById('positions-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (db.positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-light); padding: 15px;">ไม่มีตำแหน่งงานในฐานข้อมูลขณะนี้</td></tr>`;
    return;
  }
  
  db.positions.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600;">${p}</td>
      <td style="text-align: center; display: flex; gap: 4px; justify-content: center; align-items: center;">
        <button type="button" class="btn btn-secondary" style="width: auto; padding: 6px 10px; font-size: 11px; border-radius: 4px;" onclick="openEditPositionModal('${p}')">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button type="button" class="btn btn-outline" style="width: auto; padding: 6px 10px; font-size: 11px; border-radius: 4px; color: var(--primary-red); border-color: var(--primary-red); margin-left: 6px;" onclick="deletePosition('${p}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openAddPositionModal() {
  document.getElementById('position-crud-title').innerText = 'เพิ่มตำแหน่งงานใหม่';
  document.getElementById('position-crud-mode').value = 'add';
  document.getElementById('position-crud-name').value = '';
  
  document.getElementById('position-crud-modal').classList.add('active');
}

function openEditPositionModal(name) {
  document.getElementById('position-crud-title').innerText = 'แก้ไขชื่อตำแหน่งงาน';
  document.getElementById('position-crud-mode').value = 'edit';
  document.getElementById('position-crud-old-name').value = name;
  document.getElementById('position-crud-name').value = name;
  
  document.getElementById('position-crud-modal').classList.add('active');
}

function closePositionCrudModal() {
  document.getElementById('position-crud-modal').classList.remove('active');
}

function savePositionCrud() {
  const mode = document.getElementById('position-crud-mode').value;
  const name = document.getElementById('position-crud-name').value.trim();
  
  if (!name) return;
  
  if (mode === 'add') {
    // Duplication check
    const exist = db.positions.some(p => p.toLowerCase() === name.toLowerCase());
    if (exist) {
      alert('ขออภัย: ตำแหน่งงานนี้มีอยู่ในระบบแล้ว!');
      return;
    }
    db.positions.push(name);
  } else {
    // Edit mode
    const oldName = document.getElementById('position-crud-old-name').value;
    const idx = db.positions.indexOf(oldName);
    if (idx !== -1) {
      db.positions[idx] = name;
      
      // Update any users that have this position
      db.users.forEach(u => {
        if (u.Position === oldName) {
          u.Position = name;
        }
      });
      saveDBTable('users');
    }
  }
  
  saveDBTable('positions');
  renderAdminPositions();
  closePositionCrudModal();
  alert('บันทึกข้อมูลตำแหน่งงานเสร็จสิ้น!');
}

function deletePosition(name) {
  // Check if position is currently used by any user
  const isUsed = db.users.some(u => u.Position === name);
  if (isUsed) {
    alert(`ไม่สามารถลบได้: ตำแหน่งงาน "${name}" กำลังใช้งานอยู่โดยผู้ใช้บางราย! กรุณาย้ายตำแหน่งผู้ใช้ก่อนลบ`);
    return;
  }
  
  if (confirm(`คุณต้องการลบตำแหน่งงาน: "${name}" ใช่หรือไม่?`)) {
    const idx = db.positions.indexOf(name);
    if (idx !== -1) {
      db.positions.splice(idx, 1);
      saveDBTable('positions');
      renderAdminPositions();
      alert('ลบตำแหน่งงานเรียบร้อยแล้ว!');
    }
  }
}

// ==================== 5. CLOUD SYNC & BACKUP SIMULATION ====================
function triggerFileInput(id) {
  document.getElementById(id).click();
}

// Open file picker, try to hint towards S:\Backup via File System Access API
async function openBackupFilePicker() {
  // Try File System Access API (Chrome/Edge) - opens native file dialog
  if (window.showOpenFilePicker) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'Zip Backup Files', accept: { 'application/zip': ['.zip'] } }],
        multiple: false
      });
      const file = await fileHandle.getFile();
      state.uploadedBackupFile = file;
      const display = document.getElementById('backup-file-name');
      if (display) display.innerText = `✅ เลือกไฟล์สำเร็จ: ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
      const btn = document.getElementById('btn-backup-upload');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
      return;
    } catch (e) {
      if (e.name !== 'AbortError') {
        // Fallback to classic input
        document.getElementById('backup-zip-file').click();
      }
      return;
    }
  }
  // Fallback: classic <input type="file">
  document.getElementById('backup-zip-file').click();
}

function handleFileSelect(input, type) {
  const file = input.files[0];
  if (file) {
    if (type === 'customer') {
      state.uploadedSyncCustFile = file;
      document.getElementById('cust-file-name').innerText = `เลือกไฟล์สำเร็จ: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    } else if (type === 'ticket') {
      state.uploadedSyncTicketFile = file;
      document.getElementById('ticket-file-name').innerText = `เลือกไฟล์สำเร็จ: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    } else if (type === 'backup') {
      // Use dedicated handler for backup to enable upload button
      handleBackupFileSelect(input);
    }
  }
}

// Dedicated handler for backup file selection - enables upload button
function handleBackupFileSelect(input) {
  const file = input.files[0];
  if (file) {
    state.uploadedBackupFile = file;
    const display = document.getElementById('backup-file-name');
    if (display) display.innerText = `✅ เลือกไฟล์สำเร็จ: ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
    // Enable upload button
    const btn = document.getElementById('btn-backup-upload');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
  }
}

// Drag & drop handlers
function setupDragAndDrop() {
  const setupZone = (zoneId, inputId, type) => {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.style.borderColor = 'var(--primary-red)';
      zone.style.backgroundColor = 'var(--primary-red-light)';
    });
    
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.style.borderColor = 'var(--border-light)';
      zone.style.backgroundColor = 'var(--bg-white)';
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.borderColor = 'var(--border-light)';
      zone.style.backgroundColor = 'var(--bg-white)';
      
      const file = e.dataTransfer.files[0];
      if (file) {
        const input = document.getElementById(inputId);
        // Bind files to input element programmatically
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        handleFileSelect(input, type);
      }
    });
  };
  
  setupZone('drop-zone-customer', 'sync-cust-file', 'customer');
  setupZone('drop-zone-ticket', 'sync-ticket-file', 'ticket');
  setupZone('drop-zone-backup', 'backup-zip-file', 'backup');
}

// Sync data up to Cloud — ส่งข้อมูลแบบ chunk เพื่อหลีกเลี่ยง "Too many API requests"
async function runCloudSync() {
  const btn = document.querySelector('#scr-sync button.btn-primary');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) btn.disabled = true;

  // Helper: แบ่ง array เป็น chunks
  const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  };

  // Helper: POST chunk ไปยัง /api/sync
  const postChunk = async (payload) => {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let r = { success: false };
    try { r = await res.json(); } catch(e) { r = { success: res.ok }; }
    if (!res.ok && !r.success) throw new Error(r.error || `HTTP ${res.status}`);
    return r;
  };

  try {
    // ดึงข้อมูลล่าสุดจาก KV (ที่ db_sync.py อัปโหลดไว้จาก MySQL จริง)
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังดึงข้อมูลล่าสุดจาก Cloud KV...';
    let customers = db.customers || [];
    let tickets   = db.tickets   || [];
    let payments  = db.payments  || [];

    try {
      // ระบุ source=kv เพื่อดึงข้อมูลจริงที่ db_sync.py อัปโหลดขึ้น KV โดยตรง
      const kvRes = await fetch('/api/sync?source=kv&t=' + Date.now());
      if (kvRes.ok) {
        const kvData = await kvRes.json();
        if (kvData && kvData.tickets && kvData.tickets.length > 0) {
          tickets   = normalizeKeys(kvData.tickets);
          customers = normalizeKeys(kvData.customers || []);
          payments  = normalizeKeys(kvData.payments  || []);
          // ตัดช่องว่างท้ายชื่อลูกค้าออกอย่างสมบูรณ์
          customers.forEach(c => {
            if (c.Name) c.Name = String(c.Name).replace(/\s+/g, ' ').trim();
          });
          // บันทึกลง local db ด้วย
          db.tickets   = tickets;
          db.customers = customers;
          db.payments  = payments;
          saveDBTable('tickets');
          saveDBTable('customers');
          saveDBTable('payments');
        } else {
          alert('⚠️ ยังไม่พบข้อมูลตั๋วใน Cloud KV กรุณารันคำสั่ง "python db_sync.py sync" ที่เครื่องแม่เพื่อส่งข้อมูล MySQL ขึ้น Cloud ก่อนครับ');
        }
      }
    } catch(e) { console.error('Fetch KV error:', e); }

    // ส่งข้อมูลขึ้น D1 แบบ chunk (200 records ต่อครั้ง เพื่อความเร็วและไม่เกิน Worker subrequest limit)
    const CHUNK_SIZE = 200;
    const custChunks = chunkArray(customers, CHUNK_SIZE);
    const tickChunks = chunkArray(tickets, CHUNK_SIZE);
    const totalChunks = custChunks.length + tickChunks.length;
    let doneChunks = 0;

    // --- Upload Customers ---
    for (let i = 0; i < custChunks.length; i++) {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ลูกค้า ${Math.min((i+1)*CHUNK_SIZE, customers.length)}/${customers.length} (chunk ${++doneChunks}/${totalChunks})`;
      await postChunk({ customers: custChunks[i], tickets: [], payments: [], sync_time: new Date().toISOString() });
    }

    // --- Upload Tickets ---
    for (let i = 0; i < tickChunks.length; i++) {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ตั๋ว ${Math.min((i+1)*CHUNK_SIZE, tickets.length)}/${tickets.length} (chunk ${++doneChunks}/${totalChunks})`;
      await postChunk({ customers: [], tickets: tickChunks[i], payments: [], sync_time: new Date().toISOString() });
    }

    // --- Upload Payments (ถ้ามี) ---
    if (payments.length > 0) {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่งการชำระ ${payments.length} รายการ...`;
      for (const chunk of chunkArray(payments, CHUNK_SIZE)) {
        await postChunk({ customers: [], tickets: [], payments: chunk, sync_time: new Date().toISOString() });
      }
    }

    // บันทึก sync log
    const timestampStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    db.sync.unshift({
      timestamp: timestampStr,
      status: 'สำเร็จ (D1 + KV)',
      count: `ซิงค์สำเร็จ: ${tickets.length} ตั๋ว / ${customers.length} ลูกค้า / ${payments.length} การชำระ`
    });
    saveDBTable('sync');
    renderSyncHistory();
    renderAll();

    alert(`✅ ซิงค์ข้อมูลขึ้น Cloud สำเร็จ!\n\n` +
      `  • ตั๋วจำนำ  : ${tickets.length.toLocaleString()} รายการ\n` +
      `  • ลูกค้า   : ${customers.length.toLocaleString()} รายการ\n` +
      `  • การชำระ  : ${payments.length.toLocaleString()} รายการ\n\n` +
      `ข้อมูลถูกบันทึกเข้า Cloudflare D1 + KV เรียบร้อยแล้ว`);

  } catch (error) {
    console.error(error);
    alert('เกิดข้อผิดพลาดในการซิงค์ข้อมูล: ' + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldText;
    }
  }
}

// Alias for backward compatibility
async function runCloudSyncSimulation() {
  return await runCloudSync();
}


// Refresh all visible admin/customer panels after a data sync
function renderAll() {
  // Re-render the admin dashboard stats if visible
  try { renderAdminDashboard(); } catch(e) {}
  // Re-render reconciliation if visible  
  try { renderAdminReconcile(); } catch(e) {}
  // Refresh sync history list
  try { renderSyncHistory(); } catch(e) {}
}


function renderSyncHistory() {
  const container = document.getElementById('sync-history-log');
  if (!container) return;
  
  container.innerHTML = '';
  db.sync.forEach(h => {
    const div = document.createElement('div');
    div.className = 'sync-status-item';
    const timePart = h.timestamp.includes(' ') ? ' ' + h.timestamp.split(' ')[1].substring(0, 5) : '';
    const formattedTS = formatThaiDate(h.timestamp) + timePart;
    div.innerHTML = `
      <div>
        <strong style="color: var(--text-dark); font-size: 14px;">ซิงค์ไฟล์ฐานข้อมูล</strong><br>
        <span class="number" style="font-size: 12px; color: var(--text-medium);">${formattedTS}</span>
      </div>
      <div>
        <span class="number" style="font-size: 13px; margin-right: 12px; font-weight: 500;">${h.count}</span>
        <span class="ticket-badge badge-paid" style="background-color: var(--success-green);">${h.status}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

// Real Backup file upload function to Cloudflare R2
async function runCloudBackup() {
  // Guard: ต้องเลือกไฟล์ก่อน
  if (!state.uploadedBackupFile) {
    alert('กรุณาแตะกรอบเพื่อเลือกไฟล์ .zip จากไดรฟ์ S:\\Backup ก่อน');
    return;
  }
  
  const btn = document.getElementById('btn-backup-upload');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังอัปโหลด ZIP สำรองไปยัง Cloudflare R2...';
  }
  
  const file = state.uploadedBackupFile;
  const fileName = file.name;
  
  try {
    // ส่งไฟล์ zip จริงไปยัง R2 API endpoint (/api/backup/:filename)
    const response = await fetch('/api/backup/' + encodeURIComponent(fileName), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/zip'
      },
      body: file
    });
    
    let result = {};
    try { result = await response.json(); } catch(e) {}
    
    if (response.ok && (result.success || result.success === undefined)) {
      const timestampStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
      
      db.backup.unshift({
        timestamp: timestampStr,
        filename: fileName,
        status: 'จัดเก็บเรียบร้อย (Cloudflare R2)'
      });
      
      saveDBTable('backup');
      renderBackupHistory();
      
      // Reset state
      state.uploadedBackupFile = null;
      const zipInput = document.getElementById('backup-zip-file');
      if (zipInput) zipInput.value = '';
      const fnDisplay = document.getElementById('backup-file-name');
      if (fnDisplay) fnDisplay.innerText = '';
      
      alert(`✅ สำรองข้อมูล zip ประจำวัน "${fileName}" ขึ้น Cloudflare R2 สำเร็จเรียบร้อย!`);
    } else {
      throw new Error(result.error || `HTTP Status ${response.status}`);
    }
  } catch (error) {
    console.error(error);
    alert('เกิดข้อผิดพลาดในการอัปโหลดไฟล์สำรอง: ' + error.message);
  } finally {
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = oldText;
    }
  }
}

// Alias for backward compatibility
function runCloudBackupSimulation() {
  runCloudBackup();
}

async function renderBackupHistory() {
  const container = document.getElementById('backup-history-log');
  if (!container) return;
  
  container.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-medium); font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดรายการไฟล์สำรองข้อมูลบน Cloudflare R2...</div>';
  
  let r2Files = [];
  try {
    const res = await fetch('/api/backups?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (data && data.files) {
        r2Files = data.files;
      }
    }
  } catch (e) {
    console.log('[R2 Backup] Running in local fallback mode');
  }
  
  container.innerHTML = '';
  
  const allBackups = [...r2Files];
  db.backup.forEach(localH => {
    if (!allBackups.some(f => f.filename === localH.filename)) {
      allBackups.push(localH);
    }
  });
  
  if (allBackups.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-medium); font-size: 13px;">ยังไม่มีไฟล์สำรองข้อมูล zip ในระบบจัดเก็บ R2 Storage</div>';
    return;
  }
  
  allBackups.forEach(h => {
    const div = document.createElement('div');
    div.className = 'sync-status-item';
    const rawTime = h.uploaded || h.timestamp || '';
    const timePart = rawTime.includes(' ') ? ' ' + rawTime.split(' ')[1].substring(0, 5) : '';
    const formattedTS = rawTime ? (formatThaiDate(rawTime.split(' ')[0]) + timePart) : '-';
    
    div.innerHTML = `
      <div>
        <strong style="color: var(--text-dark); font-size: 14px;"><i class="fa-solid fa-file-zipper" style="color: var(--primary-red); margin-right: 6px;"></i>${h.filename}</strong><br>
        <span class="number" style="font-size: 12px; color: var(--text-medium);">เวลาอัปโหลด: ${formattedTS}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="ticket-badge badge-paid" style="background-color: var(--primary-red-light); color: var(--primary-red); font-weight: 600;">${h.status || 'จัดเก็บเรียบร้อย (Cloudflare R2)'}</span>
        <a href="/api/backup/${h.filename}" download="${h.filename}" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-download"></i> ดาวน์โหลด
        </a>
      </div>
    `;
    container.appendChild(div);
  });
}

function resetDatabase() {
  if (confirm("ต้องการรีเซ็ตข้อมูลจำลองทั้งหมดเพื่อเริ่มทดสอบใหม่ใช่หรือไม่? (ระบบจะล้างแคชและ Service Worker เพื่อโหลดเวอร์ชันล่าสุดให้ด้วย)")) {
    localStorage.clear();
    
    // Unregister service workers to force reload newest code
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
    }
    
    // Clear browser caches
    if ('caches' in window) {
      caches.keys().then(names => {
        for (let name of names) {
          caches.delete(name);
        }
      });
    }
    
    setTimeout(() => {
      location.reload();
    }, 600);
  }
}

// Helper to open hidden date picker when clicking on text inputs
function triggerHiddenDatePicker(id) {
  const hiddenInput = document.getElementById(id);
  if (hiddenInput) {
    if (typeof hiddenInput.showPicker === 'function') {
      hiddenInput.showPicker();
    } else {
      hiddenInput.click();
    }
  }
}

// Helper to format yyyy-mm-dd to dd/mm/yyyy AD
function handleHiddenDateChange(input, targetId, callback) {
  if (!input.value) {
    document.getElementById(targetId).value = '';
    if (callback) callback();
    return;
  }
  const parts = input.value.split('-'); // [yyyy, mm, dd]
  if (parts.length === 3) {
    const formatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
    document.getElementById(targetId).value = formatted;
    if (callback) callback();
  }
}

function updateSystemVersionDisplay() {
  const versionEl = document.getElementById('admin-sys-version-indicator');
  if (!versionEl) return;
  
  // Check active screen
  const activeScreen = document.querySelector('.admin-viewport .admin-screen.active');
  const screenId = activeScreen ? activeScreen.id : '';
  
  // Display Version text ONLY if SysGov === 0 AND active screen is 'scr-reconcile' or 'scr-report'
  if (state.sysGov === 0 && (screenId === 'scr-reconcile' || screenId === 'scr-report')) {
    let currentSysId = '1';
    if (screenId === 'scr-reconcile') {
      const el = document.getElementById('filter-system-id');
      currentSysId = el ? el.value : 'all';
    } else if (screenId === 'scr-report') {
      const el = document.getElementById('report-filter-system-id');
      currentSysId = el ? el.value : 'all';
    }
    
    let versionNum = '1';
    if (currentSysId === '2') {
      versionNum = '2';
    } else if (currentSysId === '3' || currentSysId === 'all') {
      versionNum = '3';
    } else {
      versionNum = currentSysId;
    }
    
    versionEl.innerText = `Version. ${versionNum}`;
    versionEl.style.display = 'block';
  } else {
    versionEl.style.display = 'none';
  }
}

function startAdminClock() {
  const timeEl = document.getElementById('admin-live-time');
  if (!timeEl) return;
  const update = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    timeEl.innerText = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };
  update();
  setInterval(update, 1000);
}

// Keyboard shortcuts helper for SystemID filtering
function setAdminSystemIdFilter(val) {
  const filterReconcile = document.getElementById('filter-system-id');
  const filterReport = document.getElementById('report-filter-system-id');
  
  if (filterReconcile) filterReconcile.value = val;
  if (filterReport) filterReport.value = val;
  
  // Find active admin screen and trigger re-render
  const activeScreen = document.querySelector('.admin-viewport .admin-screen.active');
  if (activeScreen) {
    if (activeScreen.id === 'scr-reconcile') {
      renderAdminReconcile();
    } else if (activeScreen.id === 'scr-report') {
      renderAdminReport();
    }
  }
  updateSystemVersionDisplay();
}

// Execute on script load
window.onload = function() {
  setupDragAndDrop();
  startAdminClock();
  updateSystemVersionDisplay();
  applyBankSettingsToUI();
  refreshCloudData(true);
  
  // Register keyboard shortcut listeners
  window.addEventListener('keydown', (e) => {
    // Only capture shortcut keys in admin portal
    if (!document.body.classList.contains('admin-mode')) return;
    
    // If SysGov = 1, disable Ctrl+1/2/3 shortcut keys completely
    if (state.sysGov === 1) return;
    
    if (e.ctrlKey) {
      if (e.key === '1') {
        e.preventDefault();
        setAdminSystemIdFilter('1');
        alert('SystemID=1');
      } else if (e.key === '2') {
        e.preventDefault();
        setAdminSystemIdFilter('2');
        alert('SystemID=2');
      } else if (e.key === '3') {
        e.preventDefault();
        setAdminSystemIdFilter('all');
        alert('SystemID=3');
      }
    }
  });
};
