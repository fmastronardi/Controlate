// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPA_URL = 'https://ubtrgrqgopyaevloryue.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVidHJncnFnb3B5YWV2bG9yeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzMxOTAsImV4cCI6MjA5MDgwOTE5MH0.HZ6N5wlsuds3segZCym3pKZm_JKPKshcBoTvoRYOE_g';

let _supaUser = null;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function supaHeaders(extra = {}) {
  const token = (_supaUser && _supaUser.access_token) ? _supaUser.access_token : SUPA_KEY;
  const h = { 
    'Content-Type': 'application/json', 
    'apikey': SUPA_KEY, 
    'Authorization': 'Bearer ' + token 
  };
  return { ...h, ...extra };
}

async function supaFetch(path, opts = {}, isRetry = false) {
  const r = await fetch(SUPA_URL + path, { ...opts, headers: { ...supaHeaders(), ...(opts.headers || {}) } });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    const msg = e.message || e.error_description || r.statusText || '';
    // Auto-refresh if JWT expired and we haven't retried yet
    if (!isRetry && (r.status === 401 || msg.toLowerCase().includes('jwt') || msg.toLowerCase().includes('expired'))) {
      const stored = getStoredSession();
      if (stored && stored.refresh_token) {
        try {
          await refreshSession(stored.refresh_token);
          return supaFetch(path, opts, true); // retry once with new token
        } catch(refreshErr) {
          // Refresh failed — session expired, redirect to login
          _supaUser = null;
          localStorage.removeItem('supa_session');
          alert('Tu sesión expiró. Por favor iniciá sesión nuevamente.');
          window.location.reload();
          return;
        }
      }
    }
    throw new Error(msg || 'Error en la solicitud');
  }
  return r.status === 204 ? null : r.json();
}

async function supaGet(table, params = '') {
  return supaFetch(`/rest/v1/${table}?${params}&apikey=${SUPA_KEY}`);
}
async function supaPost(table, body) {
  // Always send as array for consistency
  const payload = Array.isArray(body) ? body : [body];
  const result = await supaFetch(`/rest/v1/${table}`, { 
    method: 'POST', 
    body: JSON.stringify(payload), 
    headers: { 'Prefer': 'return=representation', 'Content-Type': 'application/json' } 
  });
  if (!result || !result.length) throw new Error('No se recibió respuesta de Supabase al insertar en ' + table);
  return result;
}
async function supaPatch(table, match, body) {
  return supaFetch(`/rest/v1/${table}?${match}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Prefer': 'return=representation' } });
}
async function supaUpsert(table, body) {
  const payload = Array.isArray(body) ? body : [body];
  return supaFetch(`/rest/v1/${table}`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' } });
}
async function supaDelete(table, match) {
  return supaFetch(`/rest/v1/${table}?${match}`, { 
    method: 'DELETE',
    headers: { 'Prefer': 'return=minimal' }
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function signUp(email, password) {
  const r = await fetch(SUPA_URL + '/auth/v1/signup', {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ email, password })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error_description);
  return d;
}

async function signIn(email, password) {
  const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ email, password })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error_description);
  _supaUser = d;
  localStorage.setItem('supa_session', JSON.stringify(d));
  return d;
}

async function signInWithGoogle() {
  const redirect = window.location.origin + window.location.pathname;
  window.location.href = SUPA_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirect);
}

async function signOut() {
  await fetch(SUPA_URL + '/auth/v1/logout', { method: 'POST', headers: supaHeaders() }).catch(() => {});
  _supaUser = null;
  localStorage.removeItem('supa_session');
}

async function refreshSession(refreshToken) {
  const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error_description);
  _supaUser = d;
  localStorage.setItem('supa_session', JSON.stringify(d));
  return d;
}

function getStoredSession() {
  try { return JSON.parse(localStorage.getItem('supa_session')); } catch { return null; }
}

async function restoreSession() {
  // Check URL hash for OAuth callback tokens
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    _supaUser = {
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
      user: { id: params.get('user_id') }
    };
    // Get user info
    try {
      const u = await supaFetch('/auth/v1/user');
      _supaUser.user = u;
    } catch(e) {}
    localStorage.setItem('supa_session', JSON.stringify(_supaUser));
    window.history.replaceState({}, '', window.location.pathname);
    return _supaUser;
  }

  const stored = getStoredSession();
  if (!stored?.access_token) return null;
  // Try to use stored token, refresh if needed
  _supaUser = stored;
  try {
    await supaFetch('/auth/v1/user'); // test if still valid
    return _supaUser;
  } catch {
    if (stored.refresh_token) {
      try { return await refreshSession(stored.refresh_token); } catch {}
    }
    _supaUser = null;
    localStorage.removeItem('supa_session');
    return null;
  }
}

function currentUserId() {
  return _supaUser?.user?.id;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────
async function loadAllData() {
  const uid = currentUserId();
  if (!uid) return null;

  const [cards, summariesRaw, expensesRaw, extHolders, payments,
         categories, gastosExtra, gastosTerceros, settings, extensions, extItems] = await Promise.all([
    supaGet('cards', `user_id=eq.${uid}&order=created_at.asc`),
    supaGet('summaries', `user_id=eq.${uid}&order=uploaded_at.desc`),
    supaGet('expenses', `user_id=eq.${uid}&order=created_at.asc`),
    supaGet('ext_holders', `user_id=eq.${uid}&order=name.asc`),
    supaGet('payments', `user_id=eq.${uid}`),
    supaGet('categories', `user_id=eq.${uid}&order=name.asc`),
    supaGet('gastos_extra', `user_id=eq.${uid}&order=date.desc`),
    supaGet('gastos_terceros', `user_id=eq.${uid}&order=date.desc`),
    supaGet('settings', `user_id=eq.${uid}`).catch(() => []),
    supaGet('extensions', `user_id=eq.${uid}`),
    supaGet('extension_items', '').catch(() => []),
  ]);

  // Group expenses by summary
  const expBySummary = {};
  (expensesRaw || []).forEach(e => {
    if (!expBySummary[e.summary_id]) expBySummary[e.summary_id] = [];
    expBySummary[e.summary_id].push({
      id: e.id,
      desc: e.description,
      amount: Number(e.amount),
      currency: e.currency,
      category: e.category,
      date: e.date,
      isCredit: e.is_credit,
      cuotas: e.cuotas,
      cuotaActual: e.cuota_actual
    });
  });

  // Group extension items by extension
  const itemsByExt = {};
  (extItems || []).forEach(i => {
    if (!itemsByExt[i.extension_id]) itemsByExt[i.extension_id] = [];
    itemsByExt[i.extension_id].push({ desc: i.description, amount: Number(i.amount), currency: i.currency, cuotas: i.cuotas, cuotaActual: i.cuota_actual });
  });

  // Group extensions by summary
  const extBySummary = {};
  (extensions || []).forEach(ext => {
    if (!extBySummary[ext.summary_id]) extBySummary[ext.summary_id] = [];
    extBySummary[ext.summary_id].push({
      id: ext.id,
      holder: ext.holder,
      total: Number(ext.total),
      totalUSD: Number(ext.total_usd),
      items: itemsByExt[ext.id] || []
    });
  });

  // Build payments map: summary_id -> payment
  const paymentsMap = {};
  (payments || []).forEach(p => {
    paymentsMap[p.summary_id] = { ars: p.ars, usd: p.usd, full: p.full_pay, dbId: p.id };
  });

  // Assemble summaries
  const summaries = (summariesRaw || []).map(s => ({
    id: s.id,
    cardId: s.card_id,
    cardName: s.card_name,
    month: s.month,
    vencimiento: s.vencimiento,
    minimo: Number(s.minimo),
    total: Number(s.total),
    totalUSD: Number(s.total_usd),
    driveFileId: s.drive_file_id,
    driveLink: s.drive_link,
    uploadedAt: s.uploaded_at,
    ownExpenses: expBySummary[s.id] || [],
    extensions: extBySummary[s.id] || []
  }));

  // Map cards
  const mappedCards = (cards || []).map(c => ({
    id: c.id, name: c.name, bank: c.bank, type: c.type,
    autoDebit: c.auto_debit ? 'yes' : 'no', createdAt: c.created_at
  }));

  // Map categories (just names array)
  const mappedCats = (categories || []).map(c => c.name);

  // Map extHolders
  const mappedHolders = (extHolders || []).map(h => ({ id: h.id, name: h.name }));

  // Map gastos
  const mappedGastos = (gastosExtra || []).map(g => ({
    id: g.id, desc: g.description, amount: Number(g.amount),
    currency: g.currency, cat: g.category, date: g.date, month: g.month
  }));

  const mappedTerceros = (gastosTerceros || []).map(g => ({
    id: g.id, cardId: g.card_id, holder: g.holder, desc: g.description,
    amount: Number(g.amount), month: g.month, date: g.date
  }));

  const fx = settings?.[0]?.fx_rate || 1200;

  return {
    cards: mappedCards,
    summaries,
    payments: paymentsMap,
    categories: mappedCats.length ? mappedCats : ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Indumentaria','Entretenimiento','Viajes','Educación','Otros'],
    extHolders: mappedHolders,
    gastos: mappedGastos,
    gastosTerceros: mappedTerceros,
    fx
  };
}

// ─── Save helpers ─────────────────────────────────────────────────────────────
async function saveCard(card) {
  const uid = currentUserId();
  const row = { user_id: uid, name: card.name, bank: card.bank || '', type: card.type || '', auto_debit: card.autoDebit === 'yes' };
  if (card.id && !card.id.startsWith('c')) {
    // existing UUID
    await supaPatch('cards', `id=eq.${card.id}`, row);
    return card.id;
  }
  const res = await supaPost('cards', row);
  return res[0].id;
}

async function deleteCard(cardId) {
  await supaDelete('cards', `id=eq.${cardId}`);
}

async function saveSummary(s, expenses, extensions) {
  const uid = currentUserId();
  const row = {
    user_id: uid, card_id: s.cardId, card_name: s.cardName, month: s.month,
    vencimiento: s.vencimiento || null, minimo: s.minimo, total: s.total,
    total_usd: s.totalUSD || 0, drive_file_id: s.driveFileId || null, drive_link: s.driveLink || null
  };
  let summaryId = s.id;
  if (s.id && s.id.length === 36 && !s.id.startsWith('s')) {
    await supaPatch('summaries', `id=eq.${s.id}`, row);
  } else {
    const res = await supaPost('summaries', row);
    summaryId = res[0].id;
  }

  // Delete and re-insert expenses
  await supaDelete('expenses', `summary_id=eq.${summaryId}`);
  if (expenses && expenses.length) {
    const expRows = expenses.map(e => ({
      user_id: uid, summary_id: summaryId,
      description: e.desc || e.d || '', amount: Number(e.amount || e.a || 0),
      currency: e.currency || e.cu || 'ARS', category: e.category || e.cat || 'Otros',
      date: e.date || e.dt || null, is_credit: !!(e.isCredit || e.cr),
      cuotas: e.cuotas || e.q || null, cuota_actual: e.cuotaActual || e.qi || null
    }));
    await supaPost('expenses', expRows);
  }

  // Delete and re-insert extensions
  await supaDelete('extensions', `summary_id=eq.${summaryId}`);
  if (extensions && extensions.length) {
    for (const ext of extensions) {
      const extRes = await supaPost('extensions', [{ user_id: uid, summary_id: summaryId, holder: ext.holder, total: ext.total, total_usd: ext.totalUSD || 0 }]);
      const extId = extRes[0].id;
      if (ext.items && ext.items.length) {
        await supaPost('extension_items', ext.items.map(i => ({
          extension_id: extId, description: i.desc || i.d || '', amount: Number(i.amount || i.a || 0),
          currency: i.currency || i.cu || 'ARS', cuotas: i.cuotas || i.q || null, cuota_actual: i.cuotaActual || i.qi || null
        })));
      }
    }
  }
  return summaryId;
}

async function deleteSummaryDB(summaryId) {
  await supaDelete('summaries', `id=eq.${summaryId}`);
}

async function updateExpenseCategoryDB(summaryId, expenseIndex, category) {
  // Get the expense by summary_id and offset
  const exps = await supaGet('expenses', `summary_id=eq.${summaryId}&order=created_at.asc`);
  if (exps && exps[expenseIndex]) {
    await supaPatch('expenses', `id=eq.${exps[expenseIndex].id}`, { category });
  }
}

async function savePaymentDB(summaryId, payment) {
  const uid = currentUserId();
  await supaUpsert('payments', { user_id: uid, summary_id: summaryId, ars: Number(payment.ars || 0), usd: Number(payment.usd || 0), full_pay: !!payment.full });
}

async function saveCategory(name) {
  const uid = currentUserId();
  await supaUpsert('categories', { user_id: uid, name });
}

async function deleteCategoryDB(name) {
  const uid = currentUserId();
  await supaDelete('categories', `user_id=eq.${uid}&name=eq.${encodeURIComponent(name)}`);
}

async function saveExtHolder(name) {
  const uid = currentUserId();
  const res = await supaPost('ext_holders', { user_id: uid, name });
  return res[0].id;
}

async function deleteExtHolderDB(id) {
  await supaDelete('ext_holders', `id=eq.${id}`);
}

async function saveGastoExtra(g) {
  const uid = currentUserId();
  const row = { user_id: uid, description: g.desc, amount: Number(g.amount), currency: g.currency || 'ARS', category: g.cat || 'Otros', date: g.date || null, month: g.month };
  const res = await supaPost('gastos_extra', row);
  return res[0].id;
}

async function deleteGastoExtraDB(id) {
  await supaDelete('gastos_extra', `id=eq.${id}`);
}

async function saveGastoTercero(g) {
  const uid = currentUserId();
  const row = { user_id: uid, card_id: g.cardId || null, holder: g.holder, description: g.desc, amount: Number(g.amount), month: g.month, date: g.date || null };
  const res = await supaPost('gastos_terceros', row);
  return res[0].id;
}

async function deleteGastoTerceroDB(id) {
  await supaDelete('gastos_terceros', `id=eq.${id}`);
}

async function saveFXDB(rate) {
  const uid = currentUserId();
  await supaUpsert('settings', { user_id: uid, fx_rate: Number(rate) });
}

async function updateSummaryDrive(summaryId, driveFileId, driveLink) {
  await supaPatch('summaries', `id=eq.${summaryId}`, { drive_file_id: driveFileId, drive_link: driveLink });
}

async function updateSummaryFields(id, fields) {
  const row = {};
  if (fields.cardId) row.card_id = fields.cardId;
  if (fields.cardName) row.card_name = fields.cardName;
  if (fields.month) row.month = fields.month;
  if (fields.vencimiento !== undefined) row.vencimiento = fields.vencimiento || null;
  if (fields.total !== undefined) row.total = fields.total;
  if (fields.minimo !== undefined) row.minimo = fields.minimo;
  if (fields.totalUSD !== undefined) row.total_usd = fields.totalUSD;
  await supaPatch('summaries', `id=eq.${id}`, row);
}

// ─── Supabase Storage ─────────────────────────────────────────────────────────

async function uploadToStorage(fileName, fileBase64, mimeType, month) {
  const uid = currentUserId();
  if (!uid) throw new Error('No hay usuario autenticado');

  // Path: userId/YYYY-MM/filename
  const path = uid + '/' + month + '/' + fileName;

  // Convert base64 to binary
  const binary = atob(fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });

  const token = (_supaUser && _supaUser.access_token) ? _supaUser.access_token : SUPA_KEY;

  // Upload via Supabase Storage API
  console.log('Uploading to storage path:', path, 'mimeType:', mimeType, 'size:', bytes.length);
  const resp = await fetch(SUPA_URL + '/storage/v1/object/resumenes/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'apikey': SUPA_KEY,
      'Content-Type': mimeType,
      'x-upsert': 'true'
    },
    body: blob
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error('Storage upload failed:', resp.status, resp.statusText, err);
    throw new Error(err.message || err.error || 'Error subiendo archivo: ' + resp.status);
  }
  console.log('Storage upload OK:', resp.status);

  const data = await resp.json();

  // Get signed URL (valid 10 years)
  const signedResp = await fetch(SUPA_URL + '/storage/v1/object/sign/resumenes/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'apikey': SUPA_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: 315360000 }) // 10 años en segundos
  });

  if (!signedResp.ok) return { path, signedUrl: null };
  const signedData = await signedResp.json();
  const signedUrl = SUPA_URL + '/storage/v1' + signedData.signedURL;

  return { path, signedUrl };
}

async function deleteFromStorage(path) {
  if (!path) return;
  const token = (_supaUser && _supaUser.access_token) ? _supaUser.access_token : SUPA_KEY;
  await fetch(SUPA_URL + '/storage/v1/object/resumenes/' + path, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPA_KEY }
  }).catch(e => console.warn('Storage delete error:', e));
}
