// CReuse 管理后台前端逻辑（P0/P1 增强版）
const API_BASE_URL = (() => {
  const PROD_API_BASE_URL = 'https://campus-reuse-backend-production.up.railway.app';
  const LOCAL_API_BASE_URL = 'http://localhost:8080';
  const hostname = String(window.location.hostname || '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return LOCAL_API_BASE_URL;
  }
  // Never let a query parameter select the API origin. This page holds an
  // administrator Bearer token, so `?apiBase=https://attacker.example` would
  // otherwise make the browser send that token to an untrusted host.
  return PROD_API_BASE_URL;
})();

let authToken = localStorage.getItem('adminToken') || '';
let adminUser = JSON.parse(localStorage.getItem('adminUser') || 'null');

const state = {
  currentSection: 'dashboard',
  currentPage: {
    users: 1,
    reports: 1,
    feedbacks: 1,
    items: 1,
    orders: 1,
    transactions: 1,
    disputes: 1,
    moving: 1,
    storage: 1,
    logs: 1,
    pinOrders: 1,
    memberships: 1,
    rewardRecords: 1,
    withdrawals: 1,
  },
  selectedReportIds: new Set(),
  selectedUserIds: new Set(),
  selectedItemIds: new Set(),
  selectedMovingIds: new Set(),
  selectedStorageIds: new Set(),
  movingServicesById: new Map(),
  withdrawalsById: new Map(),
  selectedMovingServiceId: null,
  movingWorkflowDefaultQuote: 0,
  movingWorkflowSubmitting: false,
  featureFlags: {
    paymentsEnabled: false,
    platformDeliveryEnabled: false,
    platformDeliveryMessage: '',
  },
};

const listingReviewState = { generation: 0, controllers: new Set(), urls: new Set(), busy: false, view: 'CURRENT' };
const paymentsUnavailableMessage = '线上支付、充值、提现和付费权益购买暂未开放。历史记录只读，赠送权益不收款。';

function clearListingReview() {
  listingReviewState.generation++;
  for (const controller of listingReviewState.controllers) controller.abort();
  for (const url of listingReviewState.urls) URL.revokeObjectURL(url);
  listingReviewState.controllers.clear(); listingReviewState.urls.clear(); listingReviewState.busy = false;
  listingReviewState.view = 'CURRENT';
  for (const id of ['listingReviewList', 'listingReviewDetail', 'listingReviewPages', 'listingReviewStatus',
    'privacyMaintenanceStatus','privacyMaintenanceJobs','privacyMaintenanceEvidence','privacyMaintenancePages']) {
    const node = document.getElementById(id); if (node) node.replaceChildren();
  }
}

function listingReviewContext(section = 'listingReview') {
  const token = authToken, generation = listingReviewState.generation;
  return { token, current: () => token && token === authToken && generation === listingReviewState.generation && state.currentSection === section };
}
async function listingReviewRequest(context, endpoint, command, bytes = false, prefix = '/admin/listing-reviews') {
  const controller = new AbortController(); listingReviewState.controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    if (!context.current()) throw new Error('页面或账号已变化。');
    const response = await fetch(`${API_BASE_URL}${prefix}${endpoint}`, { method: command ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${context.token}`, ...(command ? { 'Content-Type': 'application/json' } : {}) },
      body: command ? JSON.stringify(command) : undefined, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!context.current()) throw new Error('页面或账号已变化。');
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(typeof failure.error === 'string' ? failure.error.slice(0, 500) : '读取未完成，请刷新后重试。');
    }
    if (bytes) {
      const type = response.headers.get('Content-Type') || '';
      if (!['image/jpeg','image/png','image/gif','image/webp'].includes(type)) throw new Error('图片响应无效。');
      const blob = await response.blob();
      if (blob.size > 10485760) throw new Error('图片响应过大。');
      return blob;
    }
    return await response.json();
  } finally { clearTimeout(timer); listingReviewState.controllers.delete(controller); }
}
async function loadListingReviews(page = 1) {
  clearListingReview();
  const context = listingReviewContext(); if (!context.current()) return;
  setText('listingReviewStatus', '正在读取待审核商品…');
  try {
    const data = await listingReviewRequest(context, `?page=${page}`);
    if (!context.current()) return;
    if (!Array.isArray(data.reviews) || data.reviews.length > 25 || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('审核列表响应无效。');
    const host = document.getElementById('listingReviewList');
    for (const row of data.reviews) {
      if (!/^[0-9a-f-]{36}$/i.test(row.id) || typeof row.title !== 'string') throw new Error('审核记录无效。');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'card block w-full text-left';
      button.textContent = `${row.title} · ${row.status === 'APPEALED' ? '申诉待复核' : '待审核'}`;
      button.addEventListener('click', () => openListingReview(row.id)); host.appendChild(button);
    }
    setText('listingReviewStatus', data.total ? `共有 ${data.total} 项待审核。` : '暂无待审核商品。');
    renderPagination('listingReviewPages', page, Math.max(1, Math.ceil(data.total / 25)), loadListingReviews);
  } catch (error) { if (context.current()) setText('listingReviewStatus', error.message); }
}
function refreshListingReviewView() {
  return listingReviewState.view === 'CURRENT' ? loadListingReviews() : loadExpiredListingAppeals(1, listingReviewState.view);
}

async function loadExpiredListingAppeals(page = 1, caseState = 'PENDING') {
  if (!['PENDING','CLOSED'].includes(caseState)) return;
  clearListingReview(); listingReviewState.view = caseState;
  const context = listingReviewContext(); if (!context.current()) return;
  setText('listingReviewStatus', caseState === 'CLOSED' ? '正在读取已结案申诉…' : '正在读取过期未决申诉…');
  try {
    const data = await listingReviewRequest(context, `/appeals?page=${page}&state=${caseState}`);
    if (!context.current()) return;
    if (!Array.isArray(data.cases) || data.cases.length > 25 || data.page !== page || data.pageSize !== 25
      || data.state !== caseState || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('申诉队列响应无效。');
    const labels = { READY: '待核查结案', CLOSED: '已结案', SELF_REVIEW_FORBIDDEN: '本人商品，需由其他管理员处理',
      SOURCE_REVIEW_REQUIRED: '原始记录需核查', POLICY_REVIEW_REQUIRED: '审核规则需核查', CURRENT_REVIEW_REQUIRED: '请使用当前审核入口' };
    const host = document.getElementById('listingReviewList');
    for (const row of data.cases) {
      if (!/^[0-9a-f-]{36}$/i.test(row.id) || typeof row.title !== 'string') throw new Error('申诉记录无效。');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'card block w-full text-left';
      button.textContent = `${row.title} · ${labels[row.eligibility] || '状态待核查'}`;
      button.addEventListener('click', () => openExpiredListingAppeal(row.id)); host.appendChild(button);
    }
    setText('listingReviewStatus', `${caseState === 'CLOSED' ? '已结案' : '过期未决'}申诉共 ${data.total} 项。结案不会自动发布商品。`);
    renderPagination('listingReviewPages', page, Math.max(1, Math.ceil(data.total / 25)), value => loadExpiredListingAppeals(value, caseState));
  } catch (error) { if (context.current()) setText('listingReviewStatus', error.message); }
}

async function openExpiredListingAppeal(id) {
  listingReviewState.generation++;
  for (const controller of listingReviewState.controllers) controller.abort();
  for (const url of listingReviewState.urls) URL.revokeObjectURL(url);
  listingReviewState.urls.clear(); listingReviewState.busy = false;
  const context = listingReviewContext(), host = document.getElementById('listingReviewDetail'); host.replaceChildren();
  const paragraph = text => { const p = document.createElement('p'); p.className = 'whitespace-pre-wrap mb-2'; p.textContent = text; host.appendChild(p); return p; };
  try {
    const row = await listingReviewRequest(context, `/appeals/${id}`); if (!context.current()) return;
    if (row.id !== id || !Number.isSafeInteger(row.reviewRevision) || row.reviewRevision < 1 || !row.content
      || !Number.isSafeInteger(row.imageCount) || row.imageCount < 0 || row.imageCount > 5) throw new Error('申诉详情无效。');
    const fields = { title: '标题', category: '分类', description: '描述', conditionLabel: '成色', dimensions: '尺寸', pickupCity: '城市', pickupAddress: '取货位置' };
    for (const [field, label] of Object.entries(fields)) paragraph(`${label}：${String(row.content[field] ?? '')}`);
    paragraph(`原审核说明：${row.originalDecisionReason || '未记录'}`);
    paragraph(`申诉理由：${row.appeal || '需核查原始记录'}`);
    paragraph('本轮审核已失效。结案只处理原申诉；后续发布仍需重新提交审核。');
    if (row.closure) {
      const labels = { UPHELD: '维持原决定', OVERTURNED: '申诉成立' };
      if (!['UPHELD','OVERTURNED'].includes(row.closure.outcome) || row.closure.reviewId !== id || row.closure.publicationRestored !== false
        || row.closure.requiresNewReview !== true || typeof row.closure.reason !== 'string'
        || row.closure.reason.length < 5 || row.closure.reason.length > 500) throw new Error('结案结果需重新核查。');
      paragraph(`结案结果：${labels[row.closure.outcome]}`); paragraph(`结案理由：${row.closure.reason}`);
      paragraph(`结案时间：${formatDateTime(row.closure.closedAt)}`); return;
    }
    if (row.eligibility !== 'READY' || !Number.isSafeInteger(row.appealRevision) || row.appealRevision < 1) {
      const messages = { SELF_REVIEW_FORBIDDEN: '不能处理自己的商品申诉，请由其他管理员核查。',
        SOURCE_REVIEW_REQUIRED: '原始记录不完整，需先核查来源和证据；当前保留待处理。',
        POLICY_REVIEW_REQUIRED: '原审核规则尚需核查；当前保留待处理。',
        CURRENT_REVIEW_REQUIRED: '本轮仍在有效期，请通过当前审核入口处理。' };
      paragraph(messages[row.eligibility] || '申诉状态已变化，请刷新。'); return;
    }
    const imageHost = document.createElement('div'); imageHost.className = 'flex flex-wrap gap-3'; host.appendChild(imageHost);
    const imageButton = document.createElement('button'); imageButton.type = 'button'; imageButton.className = 'btn-gray my-3';
    imageButton.textContent = '核查原审核全部图片'; imageButton.hidden = row.imageCount === 0; host.appendChild(imageButton);
    const outcome = document.createElement('select'); outcome.className = 'input block my-3'; outcome.setAttribute('aria-label', '申诉结案结果');
    for (const [value, text] of [['','请选择结案结果'],['UPHELD','维持原决定'],['OVERTURNED','申诉成立']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; outcome.appendChild(option);
    }
    host.appendChild(outcome);
    const reason = document.createElement('textarea'); reason.className = 'input w-full my-3'; reason.maxLength = 500;
    reason.setAttribute('aria-label', '结案理由'); reason.placeholder = '说明证据及结案依据（5–500 字，卖家可见）'; host.appendChild(reason);
    const label = document.createElement('label'); label.className = 'block my-3';
    const acknowledged = document.createElement('input'); acknowledged.type = 'checkbox'; label.appendChild(acknowledged);
    label.appendChild(document.createTextNode(' 已核查本轮申诉及原审核证据，确认此结案决定')); host.appendChild(label);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'btn-gray'; close.textContent = '确认结案'; host.appendChild(close);
    const status = paragraph('证据不可读取或不完整时，请保留待处理。'); status.setAttribute('role', 'status');
    let imagesReady = row.imageCount === 0;
    const update = () => {
      close.disabled = listingReviewState.busy || !imagesReady || !acknowledged.checked || !outcome.value || reason.value.trim().length < 5;
      outcome.disabled = reason.disabled = acknowledged.disabled = listingReviewState.busy;
    };
    outcome.addEventListener('change', update); reason.addEventListener('input', update); acknowledged.addEventListener('change', update); update();
    imageButton.addEventListener('click', async () => {
      imageButton.disabled = true; imageHost.replaceChildren();
      for (const url of listingReviewState.urls) URL.revokeObjectURL(url); listingReviewState.urls.clear();
      try {
        for (let index = 0; index < row.imageCount; index++) {
          const blob = await listingReviewRequest(context, `/appeals/${id}/images/${index}`, null, true);
          if (!context.current()) return;
          const url = URL.createObjectURL(blob); listingReviewState.urls.add(url);
          const img = document.createElement('img'); img.src = url; img.alt = `原审核图片 ${index + 1}`; img.className = 'max-w-xs max-h-80 object-contain'; imageHost.appendChild(img);
        }
        imagesReady = true; status.textContent = '请结合申诉理由核查全部证据，再填写结案决定。'; update();
      } catch (error) { if (context.current()) { status.textContent = `图片核查未完成，暂不能结案。${error.message}`; imageButton.disabled = false; } }
    });
    close.addEventListener('click', async () => {
      if (!context.current() || close.disabled || listingReviewState.busy) return;
      listingReviewState.busy = true; imageButton.disabled = true; update();
      try {
        const result = await listingReviewRequest(context, `/appeals/${id}/close`, { operationKey: crypto.randomUUID(),
          reviewRevision: row.reviewRevision, appealRevision: row.appealRevision, outcome: outcome.value, reason: reason.value.trim() });
        if (!context.current()) return;
        if (result.reviewId !== id || !['UPHELD','OVERTURNED'].includes(result.outcome)
          || result.publicationRestored !== false || result.requiresNewReview !== true) throw new Error('结案响应需核查。');
        await openExpiredListingAppeal(id);
      } catch (error) {
        if (context.current()) status.textContent = `未确认结案结果，请刷新详情或查看已结案队列；不要重复提交。${error.message}`;
        // Remain disabled after uncertainty. A fresh GET observes the result.
      }
    });
  } catch (error) { if (context.current()) { host.replaceChildren(); setText('listingReviewStatus', error.message); } }
}
async function openListingReview(id) {
  // Replace the previous detail and invalidate its late image/decision calls.
  listingReviewState.generation++;
  for (const controller of listingReviewState.controllers) controller.abort();
  for (const url of listingReviewState.urls) URL.revokeObjectURL(url);
  listingReviewState.urls.clear(); listingReviewState.busy = false;
  const context = listingReviewContext(), host = document.getElementById('listingReviewDetail'); host.replaceChildren();
  try {
    const row = await listingReviewRequest(context, `/${id}`); if (!context.current()) return;
    if (row.id !== id || !Number.isSafeInteger(row.revision) || row.revision < 1 || !row.content || !Number.isSafeInteger(row.imageCount) || row.imageCount < 0 || row.imageCount > 5) throw new Error('审核详情无效。');
    if (row.canDecide !== true || row.validity !== 'CURRENT') {
      setText('listingReviewStatus', '本轮审核已失效或已处理，请刷新列表。'); return;
    }
    for (const [label, value] of Object.entries(row.content)) {
      const p = document.createElement('p'); p.className = 'whitespace-pre-wrap mb-2';
      const labels = { title: '标题', category: '分类', description: '描述', conditionLabel: '成色', dimensions: '尺寸', pickupCity: '城市', pickupAddress: '取货位置' };
      p.textContent = `${labels[label] || '内容'}：${String(value ?? '')}`; host.appendChild(p);
    }
    if (row.appeal) { const p = document.createElement('p'); p.textContent = `申诉原因：${row.appeal}`; host.appendChild(p); }
    const imageHost = document.createElement('div'); imageHost.className = 'flex flex-wrap gap-3'; host.appendChild(imageHost);
    const imageButton = document.createElement('button'); imageButton.type = 'button'; imageButton.className = 'btn-gray my-3'; imageButton.textContent = '打开全部待审核图片';
    let imagesReady = row.imageCount === 0;
    imageButton.hidden = imagesReady; host.appendChild(imageButton);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); host.appendChild(status);
    const reason = document.createElement('textarea'); reason.className = 'input w-full my-3'; reason.maxLength = 500;
    reason.setAttribute('aria-label', '审核决定理由'); reason.placeholder = '请说明审核决定（5–500 字，卖家可见）'; host.appendChild(reason);
    const approve = document.createElement('button'), reject = document.createElement('button');
    for (const [button, label] of [[approve, '通过审核'], [reject, '退回修改']]) { button.type = 'button'; button.className = 'btn-gray mr-3'; button.textContent = label; host.appendChild(button); }
    const updateButtons = () => { approve.disabled = listingReviewState.busy || !imagesReady; reject.disabled = listingReviewState.busy; };
    updateButtons();
    imageButton.addEventListener('click', async () => {
      imageButton.disabled = true; imageHost.replaceChildren();
      for (const url of listingReviewState.urls) URL.revokeObjectURL(url);
      listingReviewState.urls.clear();
      try {
        for (let index = 0; index < row.imageCount; index++) {
          const blob = await listingReviewRequest(context, `/${id}/images/${index}`, null, true);
          if (!context.current()) return;
          const url = URL.createObjectURL(blob); listingReviewState.urls.add(url);
          const img = document.createElement('img'); img.src = url; img.alt = `待审核图片 ${index + 1}`; img.className = 'max-w-xs max-h-80 object-contain'; imageHost.appendChild(img);
        }
        imagesReady = true; status.textContent = '请核查全部图片后作出决定。'; updateButtons();
      } catch (error) { if (context.current()) { status.textContent = error.message; imageButton.disabled = false; } }
    });
    const decide = async action => {
      if (!context.current() || listingReviewState.busy) return;
      const explanation = reason.value.trim(); if (explanation.length < 5) { status.textContent = '请填写至少 5 字的审核理由。'; return; }
      listingReviewState.busy = true; updateButtons();
      try {
        await listingReviewRequest(context, `/${id}/decision`, { operationKey: crypto.randomUUID(), revision: row.revision, action, reason: explanation });
        if (context.current()) await loadListingReviews();
      } catch (error) {
        if (context.current()) status.textContent = `未确认操作结果，请先刷新审核状态。${error.message}`;
        // Keep writes disabled after uncertainty; refresh observes the result.
      }
    };
    approve.addEventListener('click', () => decide('APPROVE')); reject.addEventListener('click', () => decide('REJECT'));
  } catch (error) { if (context.current()) setText('listingReviewStatus', error.message); }
}

async function loadPrivacyMaintenance(page = 1) {
  clearListingReview();
  const context = listingReviewContext('privacyMaintenance'); if (!context.current()) return;
  setText('privacyMaintenanceStatus', '正在读取维护状态…');
  const request = (prefix, endpoint = '', command) => listingReviewRequest(context, endpoint, command, false, prefix);
  try {
    const data = await request('/admin/privacy-maintenance'); if (!context.current()) return;
    const names = { EXPIRY: '到期资料处理', EVIDENCE: '到期未提交附件', DELETION: '已排队注销任务', HEALTH: '维护状态核查' };
    if (!Array.isArray(data.jobs) || data.jobs.length < 2 || data.jobs.length > 4
      || new Set(data.jobs.map(row => row.name)).size !== data.jobs.length
      || data.jobs.some(row => !Object.prototype.hasOwnProperty.call(names, row.name))) throw new Error('维护状态响应无效。');
    const states = { NOT_STARTED: '未运行', RUNNING: '运行中', SUCCEEDED: '本次运行完成', FAILED: '运行未完成' };
    const host = document.getElementById('privacyMaintenanceJobs');
    for (const row of data.jobs) {
      const card = document.createElement('div'); card.className = 'card';
      const heading = document.createElement('p'); heading.textContent = `${names[row.name] || '维护任务'}：${states[row.state] || '状态待确认'}`; card.appendChild(heading);
      const detail = document.createElement('p'); detail.className = 'text-sm mt-2';
      detail.textContent = row.stale || row.leaseExpired ? '记录过期或任务可能中断，需要核查。' : `最近成功运行：${formatDateTime(row.lastSuccessAt)}`; card.appendChild(detail);
      if (row.name === 'HEALTH' && row.summary) {
        const dependency = document.createElement('p'); dependency.className = 'text-sm mt-2';
        const labels = { REACHABLE: '可连接', UNAVAILABLE: '不可连接', NOT_CONFIGURED: '未配置', NOT_PROBED: '未核查' };
        dependency.textContent = `数据库：${labels[row.summary.database] || '未知'}；缓存：${labels[row.summary.redis] || '未知'}；对象存储：${labels[row.summary.objectStorage] || '未知'}`;
        card.appendChild(dependency);
      }
      if (row.name === 'EXPIRY' && row.summary) {
        const reviews = document.createElement('p'); reviews.className = 'text-sm mt-2';
        const count = Number.isSafeInteger(row.summary.reviewSnapshotsRemoved) ? row.summary.reviewSnapshotsRemoved : 0;
        reviews.textContent = row.summary.reviewRetention === 'BATCH_COMPLETED'
          ? `本批清理 ${count} 条到期审核记录。图片对象和备份尚未清理。` : '审核到期清理尚未启用。';
        card.appendChild(reviews);
      }
      if (row.name === 'EVIDENCE' && row.summary) {
        const evidence = document.createElement('p'); evidence.className = 'text-sm mt-2';
        const count = key => Number.isSafeInteger(row.summary[key]) ? row.summary[key] : '待核查';
        evidence.textContent = `本批已清理 ${count('retired')} 个到期未提交附件；待确认 ${count('pending')} 个。已提交举报附件不在此任务内。`;
        card.appendChild(evidence);
      }
      if (row.name === 'HEALTH' && row.summary?.reviewRetention === 'ASSESSED') {
        const reviews = document.createElement('p'); reviews.className = 'text-sm mt-2';
        const count = key => Number.isSafeInteger(row.summary[key]) ? row.summary[key] : '待核查';
        reviews.textContent = `审核记录：到期 ${count('dueReviewSnapshots')}；受保全 ${count('heldReviewSnapshots')}；过期未决申诉 ${count('unresolvedExpiredAppeals')}；来源待核查 ${count('untrackedDueReviewSnapshots')}；待核实备份的回执 ${count('reviewReceiptsAwaitingBackupProof')}。`;
        card.appendChild(reviews);
      }
      if (row.summary?.attentionRequired) { const alert = document.createElement('p'); alert.textContent = '存在需处理的保全、备份证明、未确认附件或审核记录，请查看具体状态。'; card.appendChild(alert); }
      host.appendChild(card);
    }
    setText('privacyMaintenanceStatus', '任务运行完成不代表全部资料清理完成。外部告警送达与完整恢复仍待验收。');
  } catch (error) { if (context.current()) setText('privacyMaintenanceStatus', error.message); }
  if (!context.current()) return;
  try {
    const data = await request('/admin/evidence-maintenance', `?page=${page}`); if (!context.current()) return;
    if (!Array.isArray(data.rows) || data.rows.length > 25 || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('附件队列响应无效。');
    const host = document.getElementById('privacyMaintenanceEvidence');
    const labels = { PENDING: '上传待确认', VERIFY_REQUIRED: '需要核查', RECONCILING: '核查中', AVAILABLE: '已确认上传', MISSING: '未找到对象', DELETE_PENDING: '清理待确认', DELETE_UNCERTAIN: '清理结果不明', DELETED: '线上对象已清理' };
    for (const row of data.rows) {
      if (!/^[a-f0-9-]{36}$/i.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.attached !== false) throw new Error('附件记录无效。');
      const card = document.createElement('div'); card.className = 'card';
      const p = document.createElement('p'); p.textContent = `${labels[row.status] || '状态待确认'} · ${formatDateTime(row.createdAt)}`; card.appendChild(p);
      for (const [action, text] of [['RECONCILE','核查上传结果'],['RETIRE','清理过期附件']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-gray mr-3 mt-3'; button.textContent = text;
        button.disabled = action === 'RETIRE' && (!Number.isFinite(Date.parse(row.cleanupEligibleAfter)) || Date.parse(row.cleanupEligibleAfter) > Date.now());
        button.addEventListener('click', async () => {
          if (!context.current()) return;
          if (action === 'RETIRE') {
            const confirmation = await openAdminDialog({ title: '清理过期未提交附件', bodyHtml: '<p>仅处理这一个尚未提交的附件。已关联举报或存在保全时会停止。确认继续？</p>', confirmText: '确认处理', cancelText: '取消', presentation: 'drawer' });
            if (!confirmation.confirmed || !context.current()) return;
          }
          for (const entry of card.querySelectorAll('button')) entry.disabled = true;
          try {
            await request('/admin/evidence-maintenance', `/${row.id}`, { revision: row.revision, action });
            if (context.current()) await loadPrivacyMaintenance(page);
          } catch (error) { if (context.current()) setText('privacyMaintenanceStatus', `未确认处理结果，请先刷新。${error.message}`); }
        });
        card.appendChild(button);
      }
      host.appendChild(card);
    }
    if (!data.rows.length) host.textContent = '本页没有待处理附件。';
    renderPagination('privacyMaintenancePages', page, Math.max(1, Math.ceil(data.total / 25)), loadPrivacyMaintenance);
  } catch (error) {
    if (context.current()) document.getElementById('privacyMaintenanceEvidence').textContent = error.message;
  }
}

function paymentsAreEnabled() {
  return state.featureFlags.paymentsEnabled === true;
}

function renderPaymentsNoticeBanners() {
  for (const id of ['paymentsCommercializationBanner', 'paymentsWithdrawalsBanner', 'paymentsConfigBanner']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = paymentsUnavailableMessage;
    el.className = paymentsAreEnabled() ? 'hidden' : 'rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 mb-4';
  }
  setText('withdrawalsHint', paymentsAreEnabled() ? '点击提现记录可展开详情与处理动作。' : '历史提现记录只读，当前不能打款、驳回或标记失败。');
}

const adminDialogState = {
  resolve: null,
  escHandler: null,
  config: null,
  fields: [],
  presentation: 'drawer',
};

const MOVING_WORKFLOW_TIME_WHEEL_IDS = ['movingWorkflowEstimatedPickupAt', 'movingWorkflowEstimatedDeliveryAt'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 'A$0.00';
  return `A$${amount.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-AU');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-AU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function maskEmail(value) {
  const email = String(value || '').trim();
  if (!email) return '-';
  const atIndex = email.indexOf('@');
  if (atIndex <= 1) return email;
  const localPart = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);
  const prefix = localPart.slice(0, 1);
  const suffix = localPart.length > 2 ? localPart.slice(-1) : '';
  return `${prefix}${localPart.length > 2 ? '***' : '*'}${suffix}@${domainPart}`;
}

function formatPaymentChannelLabel(channel) {
  const normalized = String(channel || '').trim().toUpperCase();
  switch (normalized) {
    case 'STRIPE':
      return 'Stripe';
    case 'APPLE_IAP':
      return 'Apple 内购';
    case 'OFFLINE':
      return '线下支付';
    case 'MOCK_WECHAT':
      return '模拟微信';
    case 'MOCK_ALIPAY':
      return '模拟支付宝';
    case 'MOCK_CARD':
      return '模拟银行卡';
    case 'MOCK_OFFLINE':
      return '模拟线下支付';
    case 'UNKNOWN':
      return '未知';
    default:
      return normalized || '-';
  }
}

function pinOrderActionLabel(action) {
  switch (String(action || '').toUpperCase()) {
    case 'CONFIRM':
      return '确认支付';
    case 'FAIL':
      return '标记失败';
    case 'CANCEL_PIN':
      return '取消置顶';
    case 'EXTEND_24H':
      return '延长24小时';
    case 'EXTEND_72H':
      return '延长72小时';
    case 'EXTEND_7D':
      return '延长7天';
    default:
      return String(action || '置顶操作');
  }
}

function normalizeMembershipGrantMode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === '待处理') return 'PENDING';
  return 'CONFIRM';
}

function normalizeRewardType(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  const compact = normalized.replace(/[^A-Z0-9_\u4e00-\u9fff]/g, '');
  if (compact === 'PIN_CREDIT' || compact === '置顶' || compact === '置顶时长') return 'PIN_CREDIT';
  if (compact === 'MEMBERSHIP_30D' || compact === 'MEMBERSHIP30D' || compact === '会员30天' || compact === '会员') {
    return 'MEMBERSHIP_30D';
  }
  if (compact === 'POINTS' || compact === '积分') return 'POINTS';
  if (compact === 'BALANCE' || compact === '余额') return 'BALANCE';
  return normalized;
}

function normalizeFeedbackRewardType(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  const compact = normalized.replace(/[^A-Z0-9_\u4e00-\u9fff]/g, '');
  if (compact === 'NONE' || compact === '不发放' || compact === '无') return 'NONE';
  if (compact === 'PIN_CREDIT' || compact === '置顶' || compact === '置顶时长') return 'PIN_CREDIT';
  if (compact === 'COUPON' || compact === '代金券' || compact === '优惠券') return 'COUPON';
  if (compact === 'MEMBERSHIP_DAYS' || compact === 'MEMBERSHIPDAYS' || compact === '会员天数' || compact === '会员') {
    return 'MEMBERSHIP_DAYS';
  }
  if (compact === 'POINTS' || compact === '积分') return 'POINTS';
  if (compact === 'BALANCE' || compact === '余额') return 'BALANCE';
  return normalized;
}

function maskPhone(value) {
  const phone = String(value || '').trim();
  if (!phone) return '-';
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return phone;
  return `${digits.slice(0, Math.min(4, digits.length - 3))}****${digits.slice(-3)}`;
}

function maskContact(value) {
  const contact = String(value || '').trim();
  if (!contact) return '-';
  if (contact.includes('@')) return maskEmail(contact);
  if (/\d/.test(contact)) return maskPhone(contact);
  return contact;
}

function maskAccountNumber(value) {
  const account = String(value || '').trim();
  if (!account) return '-';
  const digits = account.replace(/\D/g, '');
  if (digits.length <= 4) return account;
  return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}

function humanizeLogKey(key) {
  const map = {
    action: '操作',
    actionLabel: '操作名称',
    amount: '金额',
    adminNote: '管理员备注',
    adminEmail: '管理员邮箱',
    confirm: '二次确认',
    contactPhone: '联系电话',
    contactEmail: '联系邮箱',
    email: '邮箱',
    currentStatus: '当前状态',
    deliveryFee: '配送费',
    failedCount: '失败数量',
    ids: 'ID 列表',
    itemIds: '商品 ID 列表',
    mode: '模式',
    nextStatus: '变更后状态',
    note: '备注',
    orderId: '订单 ID',
    prevPriority: '变更前优先级',
    prevStatus: '变更前状态',
    priority: '优先级',
    quote: '报价',
    reason: '原因',
    requestedStatus: '请求状态',
    rewardType: '奖励类型',
    rewardValue: '奖励值',
    withdrawalRequestId: '提现申请 ID',
    payoutReference: '转账参考号',
    bankName: '银行名称',
    accountName: '收款户名',
    accountNumber: '银行卡号',
    bsb: 'BSB',
    withdrawableBalance: '可提现余额',
    salesTotal: '销售总额',
    sameStatus: '同状态提交',
    serviceId: '服务单 ID',
    source: '来源',
    status: '状态',
    successCount: '成功数量',
    targetId: '目标 ID',
    targetType: '目标类型',
    phone: '电话',
    mobile: '手机',
    sellerEmail: '卖家邮箱',
    buyerEmail: '买家邮箱',
    reporterEmail: '举报人邮箱',
    userEmail: '用户邮箱',
    userId: '用户 ID',
  };
  if (map[key]) return map[key];
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatLogValue(value, key = '') {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value.map((item) => formatLogValue(item, key)).filter(Boolean).join('，') || '-';
  }
  if (value instanceof Date) {
    return formatDateTime(value);
  }
  if (typeof value === 'string') {
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey.includes('email') || (value.includes('@') && !/\s/.test(value))) {
      return maskEmail(value);
    }
    if ((normalizedKey.includes('phone') || normalizedKey.includes('mobile') || normalizedKey.includes('tel')) && /\d/.test(value)) {
      return maskPhone(value);
    }
    if (normalizedKey.includes('accountnumber') || normalizedKey.includes('bankaccount')) {
      return maskAccountNumber(value);
    }
    return value;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 6);
    return entries.length
      ? entries.map(([childKey, item]) => `${humanizeLogKey(childKey)}: ${formatLogValue(item, childKey)}`).join('；')
      : '-';
  }
  return String(value);
}

function renderLogDetailsSummary(details) {
  if (!details) return '<span class="text-gray-400">-</span>';
  if (typeof details === 'string') {
    return `<span class="break-all">${escapeHtml(details)}</span>`;
  }
  if (typeof details !== 'object') {
    return `<span>${escapeHtml(String(details))}</span>`;
  }

  const preferredOrder = [
    'reason',
    'status',
    'prevStatus',
    'nextStatus',
    'requestedStatus',
    'action',
    'ids',
    'itemIds',
    'serviceId',
    'orderId',
    'userId',
    'targetType',
    'targetId',
    'rewardType',
    'rewardValue',
    'priority',
    'confirm',
    'quote',
    'amount',
    'note',
    'adminNote',
    'source',
    'mode',
    'sameStatus',
    'successCount',
    'failedCount',
  ];

  const entries = Object.entries(details).filter(([key]) => key !== 'schema');
  entries.sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left[0]);
    const rightIndex = preferredOrder.indexOf(right[0]);
    if (leftIndex === -1 && rightIndex === -1) return left[0].localeCompare(right[0]);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });

  if (!entries.length) return '<span class="text-gray-400">-</span>';

  return `
    <div class="space-y-1">
      ${entries
        .slice(0, 8)
        .map(
          ([key, value]) => `
            <div>
              <span class="font-medium">${escapeHtml(humanizeLogKey(key))}：</span>
              <span class="break-all">${escapeHtml(formatLogValue(value, key))}</span>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function formatStatusBadge(label, type = 'default') {
  const map = {
    success: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    default: 'bg-gray-100 text-gray-700',
  };
  return `<span class="px-2 py-1 rounded text-xs ${map[type] || map.default}">${escapeHtml(label || '-')}</span>`;
}

function resolveImageUrl(image) {
  const raw = String(image || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return parsed.href;
    }
    return '';
  } catch {
    // Local object identifiers are treated as opaque data rather than a path.
    // Encoding prevents a historical value from escaping the uploads route.
    return `${API_BASE_URL}/uploads/${encodeURIComponent(raw)}`;
  }
}

function getImages(images) {
  if (!images) return [];
  if (Array.isArray(images)) return images;
  if (typeof images === 'string') {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonNotes(notes) {
  const raw = String(notes || '').trim();
  if (!raw || !raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function setInlineBanner(id, tone, message) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = String(message || '').trim();
  if (!text) {
    el.className = 'hidden';
    el.textContent = '';
    return;
  }

  const toneClass =
    tone === 'warn'
      ? 'rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800'
      : tone === 'error'
      ? 'rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700'
      : 'rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-700';

  el.className = toneClass;
  el.textContent = text;
}

function renderPlatformDeliveryNoticeBanners() {
  const enabled = Boolean(state.featureFlags.platformDeliveryEnabled);
  const backendMessage = String(state.featureFlags.platformDeliveryMessage || '').trim();
  const configMessage = enabled
    ? '平台配送当前允许新建，请先确认后端发布策略后再操作。'
    : backendMessage || '平台配送已移出当前 V1；管理端仅保留历史查看。';
  const movingMessage = enabled
    ? '平台配送当前允许运行，请确认仅在受控流程内操作。'
    : '平台配送已移出当前 V1。历史服务单只读，不可付款、指派或推进状态。';

  setInlineBanner('platformDeliveryFlagBanner', enabled ? 'info' : 'warn', configMessage);
  setInlineBanner('movingPlatformDeliveryBanner', enabled ? 'info' : 'warn', movingMessage);
}

function formatRouteDistanceKm(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance <= 0) return '未知距离';
  return `${distance.toFixed(2)} km`;
}

function formatRouteDurationMinutes(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return '未知时长';
  return `${Math.max(1, Math.round(duration))} 分钟`;
}

function formatRouteQuoteSummary(quote) {
  if (!quote || typeof quote !== 'object') return '待平台估算';
  if (typeof quote.routeSummary === 'string' && quote.routeSummary.trim()) {
    return quote.routeSummary.trim();
  }
  const provider = String(quote.provider || 'ROUTE').trim() || 'ROUTE';
  return `${provider} · ${formatRouteDistanceKm(quote.distanceKm)} · 约 ${formatRouteDurationMinutes(quote.durationMinutes)}`;
}

function formatRouteQuoteBreakdown(quote) {
  if (!quote || typeof quote !== 'object') return '待平台估算';
  const parts = [];
  if (Number(quote.baseFee) > 0) parts.push(`基础${formatMoney(quote.baseFee)}`);
  if (Number(quote.distanceFee) > 0) parts.push(`距离${formatMoney(quote.distanceFee)}`);
  if (Number(quote.stairFee) > 0) parts.push(`楼层${formatMoney(quote.stairFee)}`);
  if (Number(quote.packingFee) > 0) parts.push(`搬运${formatMoney(quote.packingFee)}`);
  const total = Number(quote.totalFee) > 0 ? formatMoney(quote.totalFee) : 'A$0.00';
  return parts.length ? `${parts.join(' · ')} · 总价 ${total}` : `总价 ${total}`;
}

function getReportEvidenceImages(report) {
  const direct = Array.isArray(report?.evidenceImages) ? report.evidenceImages : [];
  if (direct.length) return direct.filter(Boolean).slice(0, 3);

  const rawDescription = String(report?.description || '').trim();
  if (!rawDescription || !rawDescription.startsWith('{')) return [];
  try {
    const parsed = JSON.parse(rawDescription);
    if (Array.isArray(parsed?.evidenceImages)) {
      return parsed.evidenceImages.filter(Boolean).slice(0, 3);
    }
  } catch {
    // ignore
  }
  return [];
}

function trustedReportEvidenceUrl(raw) {
  try {
    if (typeof raw !== 'string' || raw.includes('%')) return null;
    const url = new URL(raw, API_BASE_URL);
    if (url.origin !== new URL(API_BASE_URL).origin || url.username || url.password || url.search || url.hash
      || !/^\/report-evidence\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(url.pathname)
      || (raw !== url.pathname && raw !== url.href)) return null;
    return url.href;
  } catch { return null; }
}

function renderReportEvidenceImages(report) {
  const images = getReportEvidenceImages(report);
  if (!images.length) return '';
  return `<div class="mt-2"><p class="text-xs text-gray-500 mb-1">私密证据图片（${images.length}）</p>
    <div class="flex gap-2 flex-wrap">${images.map((raw, index) => {
      const url = trustedReportEvidenceUrl(raw);
      if (!url) return '<span class="text-xs text-amber-700">历史附件待核查</span>';
      // Only the validated UUID enters markup; no external link or public image request.
      const id = new URL(url).pathname.split('/').pop();
      return `<button onclick="openPrivateReportEvidence('${id}')" class="btn-dark">查看证据 ${index + 1}</button>`;
    }).join('')}</div></div>`;
}

async function openPrivateReportEvidence(id) {
  const url = trustedReportEvidenceUrl('/report-evidence/' + id);
  await openAuthorizedPrivateImage(url, '举报附件');
}

function getInputValue(id) {
  const element = document.getElementById(id);
  return element ? String(element.value || '').trim() : '';
}

function pad2(value) {
  return String(Number(value) || 0).padStart(2, '0');
}

function parseMovingWorkflowDateTime(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return null;

  const matched = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (matched) {
    return {
      inputValue: `${matched[1]}T${matched[2]}:${matched[3]}`,
      previewValue: `${matched[1]} ${matched[2]}:${matched[3]}`,
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const dateValue = toLocalDateKey(parsed);
  const hourValue = pad2(parsed.getHours());
  const minuteValue = pad2(parsed.getMinutes());
  return {
    inputValue: `${dateValue}T${hourValue}:${minuteValue}`,
    previewValue: `${dateValue} ${hourValue}:${minuteValue}`,
  };
}

function updateTimeWheelPreview(fieldId) {
  const preview = document.getElementById(`${fieldId}Preview`);
  if (!preview) return;
  const parsed = parseMovingWorkflowDateTime(getInputValue(fieldId));
  preview.textContent = parsed?.previewValue || '未选择';
}

function syncTimeWheelValue(fieldId) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  const parsed = parseMovingWorkflowDateTime(input.value);
  input.value = parsed?.inputValue || '';
  updateTimeWheelPreview(fieldId);
}

function clearTimeWheel(fieldId) {
  const input = document.getElementById(fieldId);
  if (input) input.value = '';
  updateTimeWheelPreview(fieldId);
}

function setTimeWheelValue(fieldId, rawValue) {
  const parsed = parseMovingWorkflowDateTime(rawValue);
  const input = document.getElementById(fieldId);
  if (!input) return;
  input.value = parsed?.inputValue || '';
  updateTimeWheelPreview(fieldId);
}

function seedTimeWheelDate(fieldId, rawDateValue) {
  const input = document.getElementById(fieldId);
  if (!input || input.value) return;
  const dateValue = toLocalDateKey(rawDateValue);
  if (!dateValue) return;
  input.value = `${dateValue}T09:00`;
  updateTimeWheelPreview(fieldId);
}

function syncTimeWheelFromDate(fieldId) {
  syncTimeWheelValue(fieldId);
}

function initializeMovingWorkflowTimeWheels() {
  MOVING_WORKFLOW_TIME_WHEEL_IDS.forEach((fieldId) => {
    updateTimeWheelPreview(fieldId);
  });
}

function appendTextareaValues(id, values) {
  const el = document.getElementById(id);
  if (!el || !Array.isArray(values) || !values.length) return;
  const existing = String(el.value || '').trim();
  const merged = [existing, ...values.map((value) => String(value || '').trim()).filter(Boolean)].filter(Boolean).join('\n');
  el.value = merged;
}

async function uploadMovingWorkflowFile(file) {
  const formData = new FormData();
  formData.append('file', file, file.name || 'moving-workflow-upload');
  const result = await apiRequest('/upload', { method: 'POST', body: formData });
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    return String(result.url || result.data?.url || result.fileUrl || '').trim();
  }
  return '';
}

async function handleMovingWorkflowPickupUpload(event) {
  const input = event?.target;
  const files = Array.from(input?.files || []);
  if (!files.length) return;

  try {
    setMovingWorkflowMessage('info', `正在上传 ${files.length} 个文件...`);
    const uploadedUrls = [];
    for (const file of files) {
      const url = await uploadMovingWorkflowFile(file);
      if (url) uploadedUrls.push(url);
    }

    appendTextareaValues('movingWorkflowPickupPhotos', uploadedUrls);
    setMovingWorkflowMessage('success', uploadedUrls.length ? `已上传 ${uploadedUrls.length} 个文件` : '未获取到有效上传结果');
  } catch (error) {
    console.error('❌ 上传搬运/配送取货文件失败:', error);
    setMovingWorkflowMessage('error', `上传失败：${error?.message || error}`);
  } finally {
    if (input) input.value = '';
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

function setHtml(id, html) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = html;
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? '';
}

function setCheckboxValue(id, checked) {
  const element = document.getElementById(id);
  if (element) element.checked = Boolean(checked);
}

function normalizePreviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getCardPreviewLabel(card, selectors = []) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    const element = card?.querySelector(selector);
    const text = normalizePreviewText(element?.textContent || '');
    if (text) return text;
  }

  return normalizePreviewText(card?.textContent || '').slice(0, 180);
}

function collectBatchPreview(checkboxSelector, labelSelectors = [], maxItems = 5) {
  return [...document.querySelectorAll(checkboxSelector)]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => {
      const card = checkbox.closest('.card');
      return getCardPreviewLabel(card, labelSelectors) || '未命名对象';
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

async function confirmBatchPreview(actionLabel, selectedCount, previewItems, context = '') {
  const lines = previewItems.length
    ? previewItems.map((item) => `<li class="break-words">${escapeHtml(item)}</li>`).join('')
    : '<li class="text-gray-400">未找到可预览对象</li>';
  const moreText =
    selectedCount > previewItems.length
      ? `<p class="mt-2 text-xs text-gray-500">另有 ${selectedCount - previewItems.length} 条未展示</p>`
      : '';

  const result = await openAdminDialog({
    title: '批量操作预览',
    subtitle: actionLabel,
    bodyHtml: `
      <div class="space-y-3 text-sm text-slate-700">
        <p><span class="font-semibold">操作：</span>${escapeHtml(actionLabel)}</p>
        <p><span class="font-semibold">已选择：</span>${selectedCount} 条${context ? ` · ${escapeHtml(context)}` : ''}</p>
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p class="font-semibold mb-2">将处理的对象（最多显示 5 条）</p>
          <ul class="list-disc pl-5 space-y-1">${lines}</ul>
          ${moreText}
        </div>
        <p class="text-gray-500">确认后将继续填写原因并执行。</p>
      </div>
    `,
    confirmText: '继续',
    cancelText: '取消',
    confirmVariant: 'danger',
  });

  return Boolean(result.confirmed);
}

function resetSectionFilters(sectionName) {
  switch (sectionName) {
    case 'users':
      setInputValue('userSearch', '');
      setInputValue('userBannedFilter', '');
      setInputValue('userRoleFilter', '');
      setInputValue('userMemberFilter', '');
      setInputValue('userHasReportFilter', '');
      setInputValue('userHasTradeFilter', '');
      setInputValue('userDateFrom', '');
      setInputValue('userDateTo', '');
      setInputValue('userSortBy', 'createdAt');
      setInputValue('userSortOrder', 'desc');
      break;
    case 'reports':
      setInputValue('reportStatus', '');
      setInputValue('reportTargetType', '');
      setInputValue('reportSearch', '');
      setInputValue('reportDateFrom', '');
      setInputValue('reportDateTo', '');
      setInputValue('reportSortBy', 'createdAt');
      setInputValue('reportSortOrder', 'desc');
      break;
    case 'feedbacks':
      setInputValue('feedbackType', '');
      setInputValue('feedbackStatus', '');
      setInputValue('feedbackPriority', '');
      setInputValue('feedbackRewardStatus', '');
      setInputValue('feedbackHasScreenshots', '');
      setInputValue('feedbackDateFrom', '');
      setInputValue('feedbackDateTo', '');
      setInputValue('feedbackSearch', '');
      break;
    case 'items':
      setInputValue('itemSearch', '');
      setInputValue('itemSeller', '');
      setInputValue('itemCategory', '');
      setInputValue('itemCity', '');
      setInputValue('itemStatus', '');
      setInputValue('itemPinned', '');
      setInputValue('itemUrgent', '');
      setInputValue('itemHasReports', '');
      setInputValue('itemMinPrice', '');
      setInputValue('itemMaxPrice', '');
      setInputValue('itemDateFrom', '');
      setInputValue('itemDateTo', '');
      break;
    case 'orders':
      setInputValue('orderSearch', '');
      setInputValue('orderItemKeyword', '');
      setInputValue('orderBuyer', '');
      setInputValue('orderSeller', '');
      setInputValue('orderStatus', '');
      setInputValue('orderHasDispute', '');
      setInputValue('orderMinAmount', '');
      setInputValue('orderMaxAmount', '');
      setInputValue('orderDateFrom', '');
      setInputValue('orderDateTo', '');
      break;
    case 'transactions':
      setInputValue('transactionType', '');
      setInputValue('transactionSource', '');
      setInputValue('transactionDateFrom', '');
      setInputValue('transactionDateTo', '');
      setInputValue('transactionMinAmount', '');
      setInputValue('transactionMaxAmount', '');
      break;
    case 'disputes':
      setInputValue('disputeReportStatus', 'PENDING');
      setInputValue('disputeDateFrom', '');
      setInputValue('disputeDateTo', '');
      break;
    case 'offline':
      setInputValue('movingKeyword', '');
      setInputValue('movingStatus', '');
      setInputValue('movingDateFrom', '');
      setInputValue('movingDateTo', '');
      setInputValue('movingSortBy', 'appointment_asc');
      setInputValue('movingScheduleDate', '');
      setCheckboxValue('movingGroupByScheduleDate', true);
      setInputValue('storageStatus', '');
      setInputValue('storageDateFrom', '');
      setInputValue('storageDateTo', '');
      resetMovingWorkflowPanel();
      break;
    case 'logs':
      setInputValue('logAction', '');
      setInputValue('logTargetType', '');
      setInputValue('logAdminId', '');
      setInputValue('logDateFrom', '');
      setInputValue('logDateTo', '');
      setInputValue('logKeyword', '');
      break;
    case 'commercialization':
      setInputValue('pinOrderSearch', '');
      setInputValue('pinOrderStatus', '');
      setInputValue('membershipSearch', '');
      setInputValue('membershipStatus', '');
      break;
    case 'withdrawals':
      setInputValue('withdrawalSearch', '');
      setInputValue('withdrawalStatus', '');
      setInputValue('withdrawalSortOrder', 'desc');
      setInputValue('withdrawalDateFrom', '');
      setInputValue('withdrawalDateTo', '');
      break;
    default:
      break;
  }
}

async function clearSectionFilters(sectionName) {
  resetSectionFilters(sectionName);
  clearSelections();

  switch (sectionName) {
    case 'users':
      await loadUsers(1);
      break;
    case 'reports':
      await loadReports(1);
      break;
    case 'feedbacks':
      await loadFeedbacks(1);
      break;
    case 'items':
      await loadItems(1);
      break;
    case 'orders':
      await loadOrders(1);
      break;
    case 'transactions':
      await loadTransactions(1);
      break;
    case 'disputes':
      await loadDisputes(1);
      break;
    case 'offline':
      await loadOfflineSection();
      break;
    case 'logs':
      await loadLogs(1);
      break;
    case 'commercialization':
      await loadCommercializationSection();
      break;
    case 'withdrawals':
      await loadWithdrawalsSection();
      break;
    default:
      break;
  }
}

async function openSectionWithPreset(sectionName, presetKey) {
  resetSectionFilters(sectionName);

  switch (`${sectionName}:${presetKey}`) {
    case 'reports:pending':
      setInputValue('reportStatus', 'PENDING');
      break;
    case 'feedbacks:pending':
      setInputValue('feedbackStatus', 'pending');
      break;
    case 'feedbacks:highPriorityBug':
      setInputValue('feedbackType', 'BUG');
      setInputValue('feedbackStatus', 'pending');
      setInputValue('feedbackPriority', 'high');
      break;
    case 'disputes:pending':
      setInputValue('disputeReportStatus', 'PENDING');
      break;
    case 'items:pendingReview':
      setInputValue('itemStatus', 'PENDING_REVIEW');
      break;
    case 'offline:pending':
      setInputValue('movingStatus', 'PENDING');
      setInputValue('storageStatus', 'PENDING');
      break;
    case 'withdrawals:pending':
      setInputValue('withdrawalStatus', 'PENDING');
      break;
    case 'orders:pendingDispute':
      setInputValue('orderHasDispute', 'true');
      break;
    case 'commercialization:paymentExceptions':
      setInputValue('pinOrderStatus', 'FAILED');
      break;
    default:
      break;
  }

  await showSection(sectionName);
}

function showError(message) {
  showToast(message, 'error');
}

function showSuccess(message) {
  showToast(message, 'success');
}

function recoverableLoadMessage(context, error) {
  const detail = String(error?.message || '').toLowerCase();

  if (/(401|403|登录|权限|unauthorized|forbidden)/.test(detail)) {
    return '登录状态或权限已变化，请重新登录后重试';
  }
  if (/(429|频繁|rate limit)/.test(detail)) {
    return '请求过于频繁，请稍后重试';
  }
  if (/(timeout|超时)/.test(detail)) {
    return '请求超时，请检查网络后重试';
  }
  if (/(network|failed to fetch|网络|连接)/.test(detail)) {
    return '网络连接不可用，请检查网络后重试';
  }

  return `${context}暂时无法加载，请稍后重试`;
}

function renderRecoverableLoadError(containerId, message, retryAction, options = {}) {
  const retryButtonId = `${containerId}RetryButton`;
  const retryButton = `
    <button
      id="${retryButtonId}"
      type="button"
      class="btn-red mt-3"
    >重新加载</button>
  `;
  const content = `
    <div class="card text-center text-gray-600" role="alert">
      <p>${escapeHtml(message)}</p>
      ${retryButton}
    </div>
  `;
  const tableColumnCount = Number(options.tableColumnCount || 0);

  setHtml(
    containerId,
    tableColumnCount > 0
      ? `<tr><td colspan="${tableColumnCount}" class="td">${content}</td></tr>`
      : content
  );

  document.getElementById(retryButtonId)?.addEventListener('click', async () => {
    const button = document.getElementById(retryButtonId);
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.textContent = '加载中…';
    }
    try {
      await retryAction();
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = '重新加载';
      }
    }
  });
}

function ensureToastHost() {
  let host = document.getElementById('adminToastHost');
  if (host) return host;

  host = document.createElement('div');
  host.id = 'adminToastHost';
  host.className = 'fixed bottom-5 right-5 z-[95] flex w-full max-w-sm flex-col gap-3 px-4 pointer-events-none';
  document.body.appendChild(host);
  return host;
}

function showToast(message, type = 'info') {
  const host = ensureToastHost();
  const toast = document.createElement('div');
  const config = {
    success: {
      title: '成功',
      icon: 'fa-circle-check',
      container: 'border-emerald-200 bg-emerald-50 text-emerald-900 shadow-emerald-500/10',
      accent: 'from-emerald-500 to-teal-500',
    },
    error: {
      title: '错误',
      icon: 'fa-triangle-exclamation',
      container: 'border-rose-200 bg-rose-50 text-rose-900 shadow-rose-500/10',
      accent: 'from-rose-500 to-red-500',
    },
    info: {
      title: '提示',
      icon: 'fa-circle-info',
      container: 'border-slate-200 bg-slate-900 text-white shadow-slate-900/20',
      accent: 'from-slate-700 to-slate-900',
    },
  }[type] || {
    title: '提示',
    icon: 'fa-circle-info',
    container: 'border-slate-200 bg-slate-900 text-white shadow-slate-900/20',
    accent: 'from-slate-700 to-slate-900',
  };

  toast.className = `admin-toast pointer-events-auto overflow-hidden rounded-2xl border backdrop-blur-xl ${config.container}`;
  toast.innerHTML = `
    <div class="flex items-start gap-3 p-4">
      <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${config.accent} text-white shadow-lg">
        <i class="fas ${config.icon}"></i>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] ${type === 'error' ? 'text-rose-700' : type === 'success' ? 'text-emerald-700' : 'text-slate-300'}">${config.title}</p>
        <p class="mt-1 whitespace-pre-line text-sm leading-6 ${type === 'info' ? 'text-white/90' : 'text-inherit'}">${escapeHtml(message)}</p>
      </div>
      <button type="button" class="rounded-lg px-2 py-1 text-lg leading-none ${type === 'error' ? 'text-rose-700 hover:bg-rose-100' : type === 'success' ? 'text-emerald-700 hover:bg-emerald-100' : 'text-white/70 hover:bg-white/10'}" aria-label="关闭提示">×</button>
    </div>
  `;

  const close = () => {
    toast.classList.add('toast-leave');
    setTimeout(() => toast.remove(), 180);
  };
  toast.querySelector('button')?.addEventListener('click', close);
  host.appendChild(toast);
  setTimeout(close, 2800);
}

let adminResponseGeneration = 0;
async function apiRequest(endpoint, options = {}, expectBlob = false) {
  const requestToken = authToken, requestGeneration = adminResponseGeneration;
  const url = `${API_BASE_URL}${endpoint}`;
  const config = {
    method: options.method || 'GET',
    // Admin authentication is explicit Bearer auth. Omitting ambient cookies
    // keeps a cross-site request from acquiring any authentication context.
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      'Authorization': authToken ? `Bearer ${authToken}` : '',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...(options.headers || {}),
    },
    body: options.body,
  };

  if (!(config.body instanceof FormData)) {
    config.headers['Content-Type'] = config.headers['Content-Type'] || 'application/json';
  }

  const response = await fetch(url, config);

  if (!response.ok) {
    let errorMessage = `请求失败 (${response.status})`;

    try {
      const payload = await response.json();
      if (payload?.error) errorMessage = payload.error;

    } catch (_) {
      // ignore json parse error
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(errorMessage || '权限不足，请重新登录');
    }

    throw new Error(errorMessage);
  }

  const result = expectBlob ? await response.blob() : await response.json();
  if (requestToken !== authToken || requestGeneration !== adminResponseGeneration) throw new Error('登录状态已变化，请重新打开页面。');
  return result;
}

function ensureAdminDialog() {
  if (document.getElementById('adminActionModal')) return;

  const modal = document.createElement('div');
  modal.id = 'adminActionModal';
  modal.className = 'fixed inset-0 z-[80] hidden bg-slate-950/60 backdrop-blur-md';
  modal.innerHTML = `
    <div class="absolute inset-0" style="background: radial-gradient(circle at top, rgba(248,113,113,.25), rgba(15,23,42,.62));" data-admin-modal-close="true"></div>
    <div
      id="adminModalPanel"
      class="relative z-[81] flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-[0_40px_120px_rgba(15,23,42,0.5)]"
    >
      <div class="relative overflow-hidden border-b border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-rose-700 px-5 py-5 text-white">
        <div class="absolute inset-0 opacity-40" style="background: radial-gradient(circle at top right, rgba(255,255,255,.22), transparent 38%), radial-gradient(circle at bottom left, rgba(251,191,36,.12), transparent 30%);"></div>
        <div class="relative flex items-start justify-between gap-4">
          <div class="min-w-0 flex items-start gap-3">
            <div class="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-xl shadow-lg shadow-black/10">
              <i class="fas fa-shield-halved"></i>
            </div>
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">ReOwn Admin Workflow</p>
              <h3 id="adminModalTitle" class="mt-1 text-2xl font-bold tracking-tight text-white">确认操作</h3>
              <p id="adminModalSubtitle" class="mt-1 text-sm leading-6 text-white/80"></p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-lg leading-none text-white/80 transition hover:bg-white/20 hover:text-white"
            data-admin-modal-close="true"
            aria-label="关闭弹窗"
          >
            ×
          </button>
        </div>
      </div>
      <div class="overflow-y-auto bg-slate-50 px-5 py-5">
        <div id="adminModalBody" class="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700 shadow-sm"></div>
        <form id="adminModalForm" class="mt-4 space-y-3"></form>
        <p id="adminModalError" class="mt-4 hidden rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
        <button type="button" id="adminModalCancel" class="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 transition hover:bg-slate-50">取消</button>
        <button type="button" id="adminModalConfirm" class="rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 px-4 py-2.5 font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:from-rose-500 hover:to-orange-400">确认</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function buildAdminModalField(field, index) {
  const commonInputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20';
  const label = escapeHtml(field.label || `字段 ${index + 1}`);
  const placeholder = escapeHtml(field.placeholder || '');
  const value = field.value ?? '';
  const requiredBadge = field.required ? '<span class="ml-1 text-red-500">*</span>' : '';
  const helper = field.helperText
    ? `<p class="text-xs text-slate-500">${escapeHtml(field.helperText)}</p>`
    : '';

  if (field.type === 'textarea') {
    return `
      <label class="block space-y-2">
        <span class="block text-sm font-medium text-slate-700">${label}${requiredBadge}</span>
        <textarea
          data-admin-modal-field-index="${index}"
          rows="${field.rows || 4}"
          class="${commonInputClass} resize-y"
          placeholder="${placeholder}"
        >${escapeHtml(value)}</textarea>
        ${helper}
      </label>
    `;
  }

  if (field.type === 'checkbox') {
    return `
      <label class="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
        <input data-admin-modal-field-index="${index}" type="checkbox" ${field.checked ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500" />
        <div>
          <span class="block text-sm font-medium text-slate-700">${label}</span>
          ${helper}
        </div>
      </label>
    `;
  }

  return `
    <label class="block space-y-2">
      <span class="block text-sm font-medium text-slate-700">${label}${requiredBadge}</span>
      <input
        data-admin-modal-field-index="${index}"
        type="${escapeHtml(field.type || 'text')}"
        value="${escapeHtml(value)}"
        placeholder="${placeholder}"
        class="${commonInputClass}"
      />
      ${helper}
    </label>
  `;
}

function getAdminModalElements(options = {}) {
  const { ensure = true } = options;
  if (ensure) ensureAdminDialog();
  const modal = document.getElementById('adminActionModal');
  if (!modal) return null;
  return {
    modal,
    panel: modal.querySelector('#adminModalPanel'),
    title: modal.querySelector('#adminModalTitle'),
    subtitle: modal.querySelector('#adminModalSubtitle'),
    body: modal.querySelector('#adminModalBody'),
    form: modal.querySelector('#adminModalForm'),
    error: modal.querySelector('#adminModalError'),
    cancel: modal.querySelector('#adminModalCancel'),
    confirm: modal.querySelector('#adminModalConfirm'),
  };
}

function closeAdminDialog(result = { confirmed: false }) {
  const elements = getAdminModalElements({ ensure: false });
  if (elements?.modal) {
    elements.modal.classList.add('hidden');
    elements.modal.classList.remove('flex');
  }
  document.body.classList.remove('overflow-hidden');
  if (adminDialogState.escHandler) {
    document.removeEventListener('keydown', adminDialogState.escHandler);
    adminDialogState.escHandler = null;
  }
  if (adminDialogState.resolve) {
    const resolve = adminDialogState.resolve;
    adminDialogState.resolve = null;
    adminDialogState.fields = [];
    adminDialogState.config = null;
    resolve(result);
  }
}

function showAdminDialogError(message) {
  const elements = getAdminModalElements();
  if (!elements?.error) return;
  elements.error.textContent = message;
  elements.error.classList.remove('hidden');
}

function clearAdminDialogError() {
  const elements = getAdminModalElements();
  if (!elements?.error) return;
  elements.error.textContent = '';
  elements.error.classList.add('hidden');
}

async function openAdminDialog(config = {}) {
  const elements = getAdminModalElements();
  if (!elements) return { confirmed: false };

  if (adminDialogState.resolve) {
    closeAdminDialog({ confirmed: false });
  }

  adminDialogState.config = {
    title: config.title || '确认操作',
    subtitle: config.subtitle || '',
    bodyHtml: config.bodyHtml || '',
    fields: Array.isArray(config.fields) ? config.fields : [],
    confirmText: config.confirmText || '确认',
    cancelText: config.cancelText || '取消',
    confirmVariant: config.confirmVariant || 'danger',
    presentation: config.presentation || 'drawer',
  };
  adminDialogState.fields = adminDialogState.config.fields;
  adminDialogState.presentation = adminDialogState.config.presentation;

  elements.title.textContent = adminDialogState.config.title;
  elements.subtitle.textContent = adminDialogState.config.subtitle;
  elements.body.innerHTML = adminDialogState.config.bodyHtml;
  elements.form.innerHTML = adminDialogState.config.fields.map((field, index) => buildAdminModalField(field, index)).join('');
  elements.confirm.textContent = adminDialogState.config.confirmText;
  elements.cancel.textContent = adminDialogState.config.cancelText;
  elements.confirm.className =
    adminDialogState.config.confirmVariant === 'dark'
      ? 'rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:bg-slate-800'
      : 'rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 px-4 py-2.5 font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:from-rose-500 hover:to-orange-400';
  clearAdminDialogError();

  if (adminDialogState.presentation === 'modal') {
    elements.modal.className = 'fixed inset-0 z-[80] hidden items-center justify-center px-4 py-6 bg-slate-950/60 backdrop-blur-md';
    elements.panel?.classList.remove('h-full', 'max-h-none', 'max-w-xl', 'rounded-none', 'rounded-l-[28px]');
    elements.panel?.classList.add('max-h-[90vh]', 'max-w-2xl', 'rounded-[28px]');
  } else {
    elements.modal.className = 'fixed inset-0 z-[80] hidden flex items-stretch justify-end bg-slate-950/40 backdrop-blur-md';
    elements.panel?.classList.remove('max-h-[90vh]', 'max-w-2xl', 'rounded-[28px]');
    elements.panel?.classList.add('h-full', 'max-h-none', 'max-w-xl', 'rounded-none', 'rounded-l-[28px]');
  }

  elements.modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');

  return new Promise((resolve) => {
    adminDialogState.resolve = resolve;

    adminDialogState.escHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAdminDialog({ confirmed: false });
      }
    };
    document.addEventListener('keydown', adminDialogState.escHandler);

    const submit = () => {
      clearAdminDialogError();
      const values = {};

      for (const [index, field] of adminDialogState.fields.entries()) {
        const fieldElement = elements.form.querySelector(`[data-admin-modal-field-index="${index}"]`);
        if (!fieldElement) continue;

        let value;
        if (field.type === 'checkbox') {
          value = Boolean(fieldElement.checked);
        } else {
          value = String(fieldElement.value || '').trim();
        }

        if (field.required && field.type !== 'checkbox' && !value) {
          showAdminDialogError(field.requiredMessage || `${field.label || '该字段'}不能为空`);
          fieldElement.focus();
          return;
        }

        if (field.minLength && field.type !== 'checkbox' && value && String(value).length < field.minLength) {
          showAdminDialogError(field.minLengthMessage || `${field.label || '该字段'}至少需要 ${field.minLength} 个字符`);
          fieldElement.focus();
          return;
        }

        values[field.name || `field_${index}`] = value;
      }

      closeAdminDialog({ confirmed: true, values });
    };

    elements.cancel.onclick = () => closeAdminDialog({ confirmed: false });
    elements.confirm.onclick = submit;
    elements.form.onsubmit = (event) => {
      event.preventDefault();
      submit();
    };

    elements.modal.querySelectorAll('[data-admin-modal-close="true"]').forEach((button) => {
      button.onclick = () => closeAdminDialog({ confirmed: false });
    });

    const firstField = elements.form.querySelector('input, textarea, select');
    if (firstField) {
      setTimeout(() => firstField.focus(), 0);
    }
  });
}

async function promptText(message, defaultValue = '', options = {}) {
  const result = await openAdminDialog({
    title: options.title || message,
    subtitle: options.subtitle || '',
    bodyHtml: options.bodyHtml || `<p class="text-sm text-slate-600 whitespace-pre-line">${escapeHtml(message)}</p>`,
    fields: [
      {
        name: 'value',
        label: options.label || message,
        type: options.multiline ? 'textarea' : options.type || 'text',
        value: defaultValue,
        placeholder: options.placeholder || message,
        required: options.required !== false,
        minLength: options.minLength || 0,
        minLengthMessage: options.minLengthMessage,
        requiredMessage: options.requiredMessage,
        rows: options.rows || 4,
      },
    ],
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    confirmVariant: options.confirmVariant || 'danger',
    presentation: options.presentation || 'drawer',
  });

  if (!result.confirmed) return null;
  const value = String(result.values?.value ?? '').trim();
  if (options.required === false && !value) return '';
  return value;
}

async function promptReason(actionLabel, required = true, minLength = 3) {
  const text = await promptText(`${actionLabel}\n请输入处理原因${required ? '（必填）' : '（可选）'}:`, '', {
    title: actionLabel,
    label: '处理原因',
    multiline: true,
    required,
    minLength,
    confirmText: '确认提交',
    confirmVariant: 'danger',
    placeholder: required ? '请输入处理原因' : '可选备注',
  });
  if (text === null) return null;
  return text;
}

async function confirmCriticalAction(actionLabel, reason) {
  const operator = adminUser?.nickname || adminUser?.email || '管理员';
  const result = await openAdminDialog({
    title: '确认操作',
    subtitle: actionLabel,
    bodyHtml: `
      <div class="space-y-3 text-sm text-slate-700">
        <p><span class="font-semibold">请确认操作：</span>${escapeHtml(actionLabel)}</p>
        <p><span class="font-semibold">操作人：</span>${escapeHtml(operator)}</p>
        <p><span class="font-semibold">原因：</span>${escapeHtml(reason || '无')}</p>
      </div>
    `,
    confirmText: '确认执行',
    cancelText: '返回修改',
    confirmVariant: 'danger',
    presentation: 'modal',
  });
  return Boolean(result.confirmed);
}

function openDetailDrawer(title, html) {
  clearPrivateProofPreview();
  setText('detailDrawerTitle', title);
  setHtml('detailDrawerBody', html);
  document.getElementById('detailDrawerMask')?.classList.remove('hidden');
  document.getElementById('detailDrawer')?.classList.remove('hidden');
}

function closeDetailDrawer() {
  clearPrivateProofPreview();
  document.getElementById('detailDrawerMask')?.classList.add('hidden');
  document.getElementById('detailDrawer')?.classList.add('hidden');
}

function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  const createButton = (label, page, active = false, disabled = false) => {
    const button = document.createElement('button');
    button.className = `page-btn ${active ? 'active' : ''}`;
    button.textContent = label;
    button.disabled = disabled;
    if (!disabled) {
      button.addEventListener('click', () => onPageChange(page));
    }
    return button;
  };

  if (currentPage > 1) {
    container.appendChild(createButton('上一页', currentPage - 1));
  }

  const pages = new Set([1, totalPages]);
  for (let i = currentPage - 2; i <= currentPage + 2; i += 1) {
    if (i >= 1 && i <= totalPages) pages.add(i);
  }

  const sortedPages = [...pages].sort((a, b) => a - b);
  let prev = 0;
  for (const page of sortedPages) {
    if (prev && page - prev > 1) {
      const dots = document.createElement('span');
      dots.className = 'px-2 text-gray-500';
      dots.textContent = '...';
      container.appendChild(dots);
    }
    container.appendChild(createButton(String(page), page, page === currentPage));
    prev = page;
  }

  if (currentPage < totalPages) {
    container.appendChild(createButton('下一页', currentPage + 1));
  }
}

function updateSelectionCount() {
  setText('userSelectedCount', state.selectedUserIds.size);
  setText('reportSelectedCount', state.selectedReportIds.size);
  setText('itemSelectedCount', state.selectedItemIds.size);
  setText('movingSelectedCount', state.selectedMovingIds.size);
  setText('storageSelectedCount', state.selectedStorageIds.size);
}

function clearSelections() {
  state.selectedUserIds.clear();
  state.selectedReportIds.clear();
  state.selectedItemIds.clear();
  state.selectedMovingIds.clear();
  state.selectedStorageIds.clear();

  ['selectAllUsers', 'selectAllReports', 'selectAllItems', 'selectAllMoving', 'selectAllStorage'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.checked = false;
  });

  updateSelectionCount();
}

async function downloadExport(resource) {
  try {
    const blob = await apiRequest(`/admin/export/${resource}`, { method: 'GET' }, true);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `admin-${resource}-${date}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(`导出失败: ${error.message}`);
  }
}

async function login() {
  const email = getInputValue('loginEmail');
  const password = document.getElementById('loginPassword')?.value || '';

  if (!email || !password) {
    showError('请填写完整登录信息');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '登录失败');
    }

    authToken = data.token;
    adminUser = data.user || {};

    if (data.user?.isAdmin === false) {
      throw new Error('该账户不是管理员');
    }

    localStorage.setItem('adminToken', authToken);
    localStorage.setItem('adminUser', JSON.stringify(adminUser));

    // 二次验证管理员权限（兼容老后端返回字段不完整）
    try {
      await apiRequest('/admin/stats');
    } catch (error) {
      throw new Error('该账户没有管理员接口权限');
    }

    document.getElementById('loginModal')?.classList.add('hidden');
    document.getElementById('mainContent')?.classList.remove('hidden');
    setText('adminName', adminUser.nickname || adminUser.email || '管理员');

    showSection('dashboard');
  } catch (error) {
    console.error('登录失败:', error);
    // 登录响应即使携带 token，也必须在管理员接口二次验证失败时立即丢弃，
    // 防止普通用户或过期权限会话残留在浏览器存储中。
    clearAdminSession();
    renderLoggedOutState({ replaceUrl: false });
    showError(`登录失败: ${error.message}`);
  }
}

function getAdminRootUrl() {
  const url = new URL(window.location.href);
  url.hash = '';
  // Clean up the legacy override parameter when navigating back to login. It
  // is intentionally ignored by API resolution and must not look functional.
  url.searchParams.delete('apiBase');
  return `${url.pathname}${url.search}` || '/';
}

function clearAdminSession() {
  adminResponseGeneration++;
  clearPrivateProofPreview();
  clearDeletionReview();
  clearListingReview();
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  authToken = '';
  adminUser = null;
}

function renderLoggedOutState(options = {}) {
  const { replaceUrl = true, clearEmail = false } = options;

  state.currentSection = 'dashboard';
  closeDetailDrawer();
  closeAdminDialog({ confirmed: false });
  clearSelections();
  document.body.classList.remove('overflow-hidden');

  document.querySelectorAll('.section').forEach((section) => {
    section.classList.add('hidden');
  });
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.classList.remove('active');
  });

  document.getElementById('mainContent')?.classList.add('hidden');
  document.getElementById('loginModal')?.classList.remove('hidden');
  setText('adminName', '管理员');

  if (clearEmail) {
    const emailInput = document.getElementById('loginEmail');
    if (emailInput) emailInput.value = '';
  }
  const passwordInput = document.getElementById('loginPassword');
  if (passwordInput) passwordInput.value = '';

  if (replaceUrl) {
    window.history.replaceState({ loggedOut: true }, '', getAdminRootUrl());
  }
}

function renderAuthenticatedState() {
  document.getElementById('loginModal')?.classList.add('hidden');
  document.getElementById('mainContent')?.classList.remove('hidden');
  setText('adminName', adminUser?.nickname || adminUser?.email || '管理员');
}

async function logout() {
  const result = await openAdminDialog({
    title: '退出登录',
    subtitle: '确认后将清除本地管理员会话',
    bodyHtml: '<p class="text-sm text-slate-700">确定要退出登录吗？</p>',
    confirmText: '确认退出',
    cancelText: '取消',
    confirmVariant: 'dark',
    presentation: 'drawer',
  });
  if (!result.confirmed) return;
  clearAdminSession();
  renderLoggedOutState({ replaceUrl: true, clearEmail: true });
}

async function showSection(sectionName) {
  if (sectionName !== 'deletionReview') clearDeletionReview();
  if (sectionName !== 'listingReview') clearListingReview();
  state.currentSection = sectionName;
  closeDetailDrawer();
  closeAdminDialog({ confirmed: false });

  document.querySelectorAll('.section').forEach((section) => {
    section.classList.add('hidden');
  });

  const target = document.getElementById(`${sectionName}Section`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.menu-item').forEach((item) => {
    item.classList.remove('active');
  });

  const activeMenu = Array.from(document.querySelectorAll('.menu-item')).find((item) => {
    const handler = item.getAttribute('onclick') || '';
    return handler.includes(`'${sectionName}'`);
  });
  if (activeMenu) activeMenu.classList.add('active');

  clearSelections();

  switch (sectionName) {
    case 'privacyMaintenance':
      await loadPrivacyMaintenance();
      break;
    case 'listingReview':
      await loadListingReviews();
      break;
    case 'dashboard':
      await loadDashboard();
      break;
    case 'users':
      await loadUsers(1);
      break;
    case 'deletionReview':
      await loadDeletionRequests(1);
      break;
    case 'reports':
      await loadReports(1);
      break;
    case 'feedbacks':
      await loadFeedbacks(1);
      break;
    case 'items':
      await loadItems(1);
      break;
    case 'orders':
      await loadOrders(1);
      break;
    case 'transactions':
      await loadTransactions(1);
      break;
    case 'disputes':
      await loadDisputes(1);
      break;
    case 'offline':
      await loadOfflineSection();
      break;
    case 'commercialization':
      await loadCommercializationSection();
      break;
    case 'withdrawals':
      await loadWithdrawalsSection();
      break;
    case 'config':
      await loadFeatureFlags();
      break;
    case 'logs':
      await loadLogs(1);
      break;
    default:
      break;
  }
}

const deletionReview = { generation: 0, detailGeneration: 0, jobsGeneration: 0, holdsGeneration: 0, cleanupsGeneration: 0, mediaGeneration: 0, uploadsGeneration: 0, cleanups: new Map(), requests: new Map(), controllers: new Set(), policyVersion: '' };

function clearDeletionReview() {
  erasureGeneration += 1;
  erasureRows.clear();
  for (const id of ['erasureRequests', 'erasurePagination']) document.getElementById(id)?.replaceChildren();
  setText('erasureStatus', '');
  deletionReview.generation += 1;
  deletionReview.detailGeneration += 1;
  deletionReview.jobsGeneration += 1;
  deletionReview.holdsGeneration += 1;
  deletionReview.cleanupsGeneration += 1;
  deletionReview.mediaGeneration += 1;
  deletionReview.uploadsGeneration += 1;
  deletionReview.cleanups.clear();
  deletionReview.requests.clear();
  deletionReview.policyVersion = '';
  for (const controller of deletionReview.controllers) controller.abort();
  deletionReview.controllers.clear();
  for (const id of ['deletionRequestsList', 'deletionRequestsPagination', 'deletionPlanDetail', 'deletionJobsList', 'deletionJobsPagination', 'retentionHoldsList', 'retentionHoldsPagination', 'contentCleanupsList', 'contentCleanupsPagination', 'contentMediaDetail', 'mediaUploadsList', 'mediaUploadsPagination']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }
  setText('deletionReviewStatus', '');
  setText('deletionJobsStatus', '');
  setText('retentionHoldsStatus', '');
  setText('contentCleanupsStatus', '');
  setText('mediaUploadsStatus', '');
  setText('contentMediaDetail', '');
}

function deletionReviewMessage(error) {
  if (error?.message === 'DELETION_DISABLED') return '注销申请登记尚未开放。当前没有执行任何清理。';
  if (error?.message === 'DELETION_CHANGED') return '申请状态已变化，请刷新申请列表后重新查看。';
  if (error?.message === 'DELETION_AUTH') return '当前登录已失效或没有核查权限，请重新登录。';
  if (error?.message === 'DELETION_LIMITED') return '核查请求较多，请稍后重试。';
  return '暂时无法读取核查信息，请稍后刷新重试。';
}

async function readDeletionReview(endpoint, token) {
  // Callers construct only fixed-origin review paths; no payload can supply a URL.
  const controller = new AbortController();
  deletionReview.controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${API_BASE_URL}/admin/account-deletion-requests${endpoint}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error('DELETION_AUTH');
    if (response.status === 404 || response.status === 409) throw new Error('DELETION_CHANGED');
    if (response.status === 429) throw new Error('DELETION_LIMITED');
    const data = await response.json();
    if (!response.ok) {
      if (data?.code === 'ACCOUNT_DELETION_REQUESTS_DISABLED') throw new Error('DELETION_DISABLED');
      throw new Error('DELETION_UNAVAILABLE');
    }
    return data;
  } finally {
    clearTimeout(timeout);
    deletionReview.controllers.delete(controller);
  }
}

const deletionRequestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deletionCount = value => Number.isSafeInteger(value) && value >= 0;
const deletionDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

async function loadDeletionRequests(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return;
  clearDeletionReview();
  const token = authToken, generation = deletionReview.generation;
  if (!token || state.currentSection !== 'deletionReview') return;
  setText('deletionReviewStatus', '正在读取申请…');
  try {
    const data = await readDeletionReview(`?page=${page}`, token);
    if (token !== authToken || generation !== deletionReview.generation || state.currentSection !== 'deletionReview') return;
    if (!Array.isArray(data.requests) || data.requests.length > 25 || !deletionCount(data.total)
      || data.total < data.requests.length || data.page !== page || data.pageSize !== 25 || data.executionEnabled !== false
      || typeof data.policyVersion !== 'string' || !data.policyVersion || data.policyVersion.length > 80
      || data.requests.some(row => !row || !deletionRequestIdPattern.test(row.id) || row.status !== 'PENDING_REVIEW'
        || !Number.isSafeInteger(row.revision) || row.revision < 1 || !deletionDate(row.submittedAt))
      || new Set(data.requests.map(row => row.id)).size !== data.requests.length) throw new Error('DELETION_INVALID_RESPONSE');
    deletionReview.policyVersion = data.policyVersion;
    for (const row of data.requests) deletionReview.requests.set(row.id, { id: row.id, revision: row.revision });
    const host = document.getElementById('deletionRequestsList');
    host.innerHTML = data.requests.map(row => `<div class="card flex flex-wrap items-center justify-between gap-3">
      <div><p class="font-medium">申请 ${escapeHtml(row.id)}</p><p class="text-sm text-gray-600 mt-1">${escapeHtml(formatDateTime(row.submittedAt))} · 待核查</p></div>
      <button type="button" class="btn-gray" onclick="openDeletionPlan('${row.id}')">查看核查预览</button></div>`).join('');
    setText('deletionReviewStatus', data.total === 0 ? '目前没有待核查申请。'
      : data.requests.length === 0 ? '本页已无待核查申请，请刷新列表。' : `共有 ${data.total} 份待核查申请。`);
    renderPagination('deletionRequestsPagination', page, Math.min(10000, Math.ceil(data.total / 25)), loadDeletionRequests);
  } catch (error) {
    if (token !== authToken || generation !== deletionReview.generation || state.currentSection !== 'deletionReview') return;
    setText('deletionReviewStatus', deletionReviewMessage(error));
  }
}

const deletionJobStatusLabels = {
  QUEUED: '等待处理', RUNNING: '正在处理', BLOCKED: '已暂停，待核查', CANCELLED: '任务已撤回',
  ONLINE_REMOVED: '线上资料已移除，备份待核实',
};
const deletionJobReasonLabels = {
  RETRY_EXHAUSTED: '多次尝试未完成，需要核查后再处理。', REQUEST_CHANGED: '申请已撤回或版本发生变化。',
  POLICY_CHANGED: '保留规则已变化，需要重新核查。', ACCOUNT_STATE_CHANGED: '账号状态已变化，需要重新核查。',
  REAUTHENTICATION_REQUIRED: '需要重新验证账号。', SCOPE_REVIEW_REQUIRED: '存在超出当前处理范围的关联资料。',
  BACKUP_VERIFICATION_PENDING: '尚未确认备份清除，全部处理尚未完成。', TRANSIENT_RETRY: '暂时未完成，任务已安排稍后重试。',
};
async function loadDeletionJobs(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !authToken || state.currentSection !== 'deletionReview') return;
  const token = authToken, generation = deletionReview.generation, jobsGeneration = ++deletionReview.jobsGeneration;
  const current = () => token === authToken && generation === deletionReview.generation
    && jobsGeneration === deletionReview.jobsGeneration && state.currentSection === 'deletionReview';
  document.getElementById('deletionJobsList').innerHTML = '';
  document.getElementById('deletionJobsPagination').innerHTML = '';
  setText('deletionJobsStatus', '正在读取任务记录…');
  try {
    const data = await readDeletionReview(`/jobs?page=${page}`, token);
    if (!current()) return;
    if (data.readOnly !== true || data.executionEnabled !== false || data.page !== page || data.pageSize !== 25
      || !deletionCount(data.total) || !Array.isArray(data.jobs) || data.jobs.length > 25 || data.total < data.jobs.length
      || data.jobs.some(job => !job || !deletionRequestIdPattern.test(job.id) || !deletionRequestIdPattern.test(job.requestId)
        || !Object.prototype.hasOwnProperty.call(deletionJobStatusLabels, job.status)
        || !Number.isSafeInteger(job.requestRevision) || job.requestRevision < 1
        || !deletionCount(job.attempts) || job.attempts > 5 || !deletionDate(job.createdAt)
        || job.overallCompleted !== false || job.backupVerification !== 'PENDING'
        || (job.status === 'ONLINE_REMOVED' && (!deletionDate(job.onlineRemovedAt) || !deletionDate(job.backupDueAt))))
      || new Set(data.jobs.map(job => job.id)).size !== data.jobs.length) throw new Error('DELETION_INVALID_RESPONSE');
    document.getElementById('deletionJobsList').innerHTML = data.jobs.map(job => {
      const reason = Object.prototype.hasOwnProperty.call(deletionJobReasonLabels, job.reason)
        ? deletionJobReasonLabels[job.reason] : '处理情况请结合申请核查。';
      return `<div class="card"><p class="font-medium">${deletionJobStatusLabels[job.status]}</p>
        <p class="text-sm mt-2">${reason}</p><p class="text-sm text-gray-600 mt-2">申请 ${escapeHtml(job.requestId)} · 版本 ${job.requestRevision}</p>
        <p class="text-sm text-gray-600 mt-1">${escapeHtml(formatDateTime(job.createdAt))} · 已尝试 ${job.attempts} 次</p>
        ${job.status === 'ONLINE_REMOVED' ? `<p class="text-sm mt-2">备份处理目标：${escapeHtml(formatDateTime(job.backupDueAt))}（尚未核实完成）</p>` : ''}</div>`;
    }).join('');
    setText('deletionJobsStatus', data.total === 0 ? '目前没有处理任务。' : data.jobs.length === 0
      ? '本页已无任务，请返回上一页。' : `共有 ${data.total} 项任务记录。`);
    renderPagination('deletionJobsPagination', page, Math.min(10000, Math.ceil(data.total / 25)), loadDeletionJobs);
  } catch (error) { if (current()) setText('deletionJobsStatus', deletionReviewMessage(error)); }
}

const holdTargetLabels = { User: '账号资料', Message: '聊天消息', OfferMessage: '议价消息', Item: '商品资料', MovingService: '交接证明', Feedback: '反馈资料' };
const holdFieldLabels = { nickname: '昵称', bio: '个人介绍', avatarUrl: '头像引用', content: '正文', metadata: '附加资料',
  title: '标题', description: '说明', images: '图片引用', inspectionProof: '验收证明引用', deliveryProof: '送达证明引用',
  reproduceSteps: '复现步骤', expectedResult: '预期结果', actualResult: '实际结果', screenshotUrls: '截图引用' };
const holdTargetFields = { User: ['nickname', 'bio', 'avatarUrl'], Message: ['content'], OfferMessage: ['content', 'metadata'],
  Item: ['title', 'description', 'images'], MovingService: ['inspectionProof', 'deliveryProof'],
  Feedback: ['description', 'reproduceSteps', 'expectedResult', 'actualResult', 'screenshotUrls'] };
const holdReasonLabels = { DISPUTE_EVIDENCE: '案件证据', DOCUMENTED_LEGAL_DUTY: '已登记的法律义务', SECURITY_INCIDENT: '安全事件调查' };

async function loadRetentionHolds(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !authToken || state.currentSection !== 'deletionReview') return;
  const token = authToken, generation = deletionReview.generation, holdsGeneration = ++deletionReview.holdsGeneration;
  const current = () => token === authToken && generation === deletionReview.generation
    && holdsGeneration === deletionReview.holdsGeneration && state.currentSection === 'deletionReview';
  document.getElementById('retentionHoldsList').innerHTML = '';
  document.getElementById('retentionHoldsPagination').innerHTML = '';
  setText('retentionHoldsStatus', '正在读取保全登记…');
  try {
    const data = await readDeletionReview(`/holds?page=${page}`, token);
    if (!current()) return;
    if (data.readOnly !== true || data.executionEnabled !== false || data.externalRegisterVerified !== false
      || data.page !== page || data.pageSize !== 25 || !deletionCount(data.total) || !Array.isArray(data.holds)
      || data.holds.length > 25 || data.total < data.holds.length
      || new Set(data.holds.map(row => row?.id)).size !== data.holds.length
      || data.holds.some(row => !row || !deletionRequestIdPattern.test(row.id)
        || !Object.prototype.hasOwnProperty.call(holdTargetLabels, row.targetModel)
        || !Object.prototype.hasOwnProperty.call(holdReasonLabels, row.reasonCode)
        || !['ACTIVE', 'RELEASED'].includes(row.status) || typeof row.reviewDue !== 'boolean' || typeof row.ownerAvailable !== 'boolean'
        || !Number.isSafeInteger(row.revision) || row.revision < 1 || !deletionDate(row.nextReviewAt)
        || !deletionDate(row.lastReviewedAt) || (row.originalDeadline !== null && !deletionDate(row.originalDeadline))
        || (row.status === 'ACTIVE' ? row.releasedAt !== null : !deletionDate(row.releasedAt) || row.reviewDue)
        || !Array.isArray(row.fields) || row.fields.length < 1 || row.fields.length > 5 || new Set(row.fields).size !== row.fields.length
        || row.fields.some(field => !holdTargetFields[row.targetModel].includes(field))
        || !Array.isArray(row.fieldAssessments) || row.fieldAssessments.length !== row.fields.length
        || new Set(row.fieldAssessments.map(value => value?.field)).size !== row.fields.length
        || row.fieldAssessments.some(value => !value || !row.fields.includes(value.field) || value.executionAuthorized !== false
          || !['PRESERVE', 'UNKNOWN', 'ASSESS_CLEANUP'].includes(value.state)
          || (row.status === 'ACTIVE' && value.state !== 'PRESERVE')
          || (value.state === 'ASSESS_CLEANUP' ? !deletionDate(value.deadline) : value.deadline !== null)))) {
      throw new Error('DELETION_INVALID_RESPONSE');
    }
    document.getElementById('retentionHoldsList').innerHTML = data.holds.map(row => {
      const status = row.status === 'RELEASED' ? '已解除，待核查后续处理' : row.reviewDue ? '保全中，需要复核' : '保全中';
      const fields = row.fieldAssessments.map(value => {
        const timing = value.state === 'PRESERVE' ? (row.status === 'RELEASED' ? '另有有效保全，继续保留' : '继续保留')
          : value.state === 'UNKNOWN' ? '原到期时间待核实' : `清理核查期限：${escapeHtml(formatDateTime(value.deadline))}（未执行清理）`;
        return `<li>${holdFieldLabels[value.field]}：${timing}</li>`;
      }).join('');
      return `<div class="card"><p class="font-medium">${status} · ${holdTargetLabels[row.targetModel]}</p>
        <p class="text-sm mt-2">${holdReasonLabels[row.reasonCode]}</p><ul class="text-sm mt-2 space-y-1">${fields}</ul>
        <p class="text-sm text-gray-600 mt-2">${row.status === 'ACTIVE' ? '下次复核' : '解除时间'}：${escapeHtml(formatDateTime(row.status === 'ACTIVE' ? row.nextReviewAt : row.releasedAt))}</p>
        ${!row.ownerAvailable && row.status === 'ACTIVE' ? '<p class="text-sm text-amber-800 mt-2">负责人员需要重新指派；保全仍然有效。</p>' : ''}
        <p class="text-xs text-gray-500 break-all mt-2">登记 ${escapeHtml(row.id)} · 版本 ${row.revision}</p></div>`;
    }).join('');
    setText('retentionHoldsStatus', data.total === 0 ? '目前没有系统内保全登记；仍需核对外部案件。'
      : data.holds.length === 0 ? '本页已无登记，请返回上一页。' : `共有 ${data.total} 项保全登记。复核逾期不会自动解除。`);
    renderPagination('retentionHoldsPagination', page, Math.min(10000, Math.ceil(data.total / 25)), loadRetentionHolds);
  } catch (error) { if (current()) setText('retentionHoldsStatus', deletionReviewMessage(error)); }
}

const deletionReasonLabels = {
  ACTIVE_RETENTION_HOLDS: '部分资料处于有效保全中，需继续保留；复核逾期不会自动解除。',
  ACTIVE_ORDERS: '仍有未完成或状态待核实的订单。',
  ORDER_PROVENANCE_REVIEW: '部分订单的资金来源或历史性质需要核实。',
  TRANSACTION_END_TIME_REQUIRES_VERIFICATION: '需要核实交易结束时间，才能计算交易记录保留期。',
  OPEN_CASES_REQUIRE_SCOPED_ASSESSMENT: '存在未结案件，需要确认应保全的具体证据。',
  OUTSTANDING_VALUE: '存在余额、待处理提现或其他权益。',
  GOVERNANCE_RELATIONSHIPS: '存在管理权限、限制状态或治理关联。',
  PROVIDER_REVOCATION_REQUIRED: '需要完成第三方登录授权撤销。',
  FINANCIAL_BASIS_REVIEW: '需要确认哪些记录属于依法应保留的账务。',
  FULFILLMENT_AND_MEDIA_REVIEW: '存在履约、寄存或交接资料，需要核实关联与归属。',
};

function deletionPlanMarkup(plan, receipt) {
  const groups = [
    ['账号及个人设置', ['User', 'UserBlock', 'DeviceToken', 'UserNotificationPreference', 'KeywordSubscription', 'ShoppingList', 'PasswordRecoveryGrant']],
    ['商品与估价资料', ['Item', 'ItemValuation', 'PriceValuationRecord']],
    ['聊天与议价消息', ['Message', 'OfferMessage']],
    ['交易与议价', ['Order', 'Trade', 'Offer']],
    ['账务及相关流水', ['WalletLog', 'Transaction', 'WithdrawalRequest', 'PaymentRecord', 'PaymentRefund', 'Settlement', 'PaymentWebhookEvent']],
    ['反馈、举报与评价', ['Feedback', 'FeedbackReward', 'Report', 'Review']],
    ['履约、寄存与交接', ['MovingService', 'StorageOrder', 'StoragePhoto', 'DeliveryDispute']],
    ['管理与通知记录', ['AdminLog', 'DeliveryAuditLog', 'PushNotificationLog', 'KeywordMatchNotification']],
    ['会话、收藏与浏览关联', ['Conversation', 'Favorite', 'ViewHistory']],
    ['注销申请与处理记录', ['AccountDeletionRequest', 'AccountDeletionJob', 'AccountDeletionTombstone']],
    ['保全登记与核查记录', ['RetentionHold', 'RetentionHoldEvent']],
    ['消息清理与待核查图片', ['MessageContentCleanup', 'OfferMessageContentCleanup', 'DetachedMediaReference']],
    ['图片上传、引用与核验登记', ['MediaUpload', 'MediaReference', 'MediaVerification']],
  ];
  if (!plan || plan.readOnly !== true || plan.executionEnabled !== false || plan.assessment !== 'PREVIEW_ONLY'
    || plan.request?.id !== receipt.id || plan.request?.revision !== receipt.revision || plan.request?.status !== 'PENDING_REVIEW'
    || plan.policyVersion !== deletionReview.policyVersion || !deletionDate(plan.generatedAt)
    || !plan.records || groups.some(([, keys]) => keys.some(key => !deletionCount(plan.records[key])))
    || !Array.isArray(plan.reviewReasons) || plan.reviewReasons.length > 30
    || plan.reviewReasons.some(reason => typeof reason !== 'string')
    || !deletionCount(plan.ordinaryMessages?.authored) || !deletionCount(plan.ordinaryMessages?.pastOperationalWindow)
    || !deletionCount(plan.ordinaryMessages?.otherParticipantMessages) || plan.ordinaryMessages?.deletionAuthorized !== false) {
    throw new Error('DELETION_INVALID_RESPONSE');
  }
  const rows = groups.map(([label, keys]) => {
    const total = keys.reduce((sum, key) => sum + plan.records[key], 0);
    if (!deletionCount(total)) throw new Error('DELETION_INVALID_RESPONSE');
    return `<tr><td class="td">${label}</td><td class="td">${total}</td></tr>`;
  }).join('');
  const reasons = plan.reviewReasons.length
    ? `<ul class="list-disc pl-5 space-y-2">${plan.reviewReasons.map(reason => `<li>${escapeHtml(deletionReasonLabels[reason] || '存在其他待核查事项。')}</li>`).join('')}</ul>`
    : '<p>当前结构化记录未发现上述待核查事项；图片归属、法律保全和备份仍需另外核实。</p>';
  return `<div class="card"><h3 class="text-xl font-semibold">资料范围与待核查事项</h3>
    <p class="text-sm break-all mt-2">申请 ${escapeHtml(receipt.id)}</p>
    <p class="text-sm text-gray-600 mt-2">核查时间：${escapeHtml(formatDateTime(plan.generatedAt))} · 规则：${escapeHtml(plan.policyVersion)}</p>
    <p class="mt-3 text-sm">以下数量包括共享和关联记录，不代表将删除的数量。当前未安排清理，也未确认任何法律保全、图片归属或备份处理已完成。</p>
    <div class="overflow-x-auto mt-4"><table class="w-full text-left"><thead><tr><th class="th">资料类别</th><th class="th">关联记录数</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="text-sm mt-3">本人普通消息 ${plan.ordinaryMessages.authored} 条，其中超过常规保留期 ${plan.ordinaryMessages.pastOperationalWindow} 条；其他参与者消息 ${plan.ordinaryMessages.otherParticipantMessages} 条。到期不代表已获准删除。</p>
    <h4 class="font-semibold mt-5 mb-3">后续处理前需要核实</h4>${reasons}
    ${deletionFieldPlanMarkup(plan.fieldPlan)}
    <p class="text-sm text-gray-600 mt-4">实际清理还需完成字段处理、图片共享引用保护、第三方撤销和备份恢复验证。</p></div>`;
}

function deletionFieldPlanMarkup(plan) {
  if (!plan || plan.executionAuthorized !== false || !Array.isArray(plan.rules) || plan.rules.length > 20) return '';
  const actions = {
    REMOVE_DIRECT_IDENTIFIERS: '移除昵称、联系方式等直接身份资料', REVOKE_ACCESS_AND_REMOVE_CREDENTIALS: '撤销登录并移除凭据',
    REVOKE_PROVIDER_THEN_UNLINK: '确认第三方授权撤销后再解除关联', CLEAR_OWN_ORDINARY_CONTENT: '清理本人普通消息正文',
    PARTITION_SHARED_FACTS_AND_PERSONAL_TEXT: '区分共享交易事实与个人文字', DETACH_THEN_REMOVE_UNSHARED_OWNED_OBJECT: '核查图片引用后再处理对象',
    VERIFY_THEN_RETIRE_UNSUBMITTED_OBJECT: '核查未提交附件后按期处理', PARTITION_CASE_EVIDENCE_AND_PUBLIC_ATTRIBUTION: '区分案件证据与公开身份信息',
    MINIMIZE_AND_RETAIN_ONLY_REQUIRED_FINANCIAL_FACTS: '只保留有明确依据的必要财务事实', SETTLE_OBLIGATIONS_THEN_MINIMIZE: '先处理履约义务再减少资料',
    EXPIRE_MINIMAL_RECEIPT: '按期处理最小化申请回执', SUPPRESS_RESTORE_UNTIL_BACKUP_PROOF: '核实备份前保留防恢复记录',
  };
  return `<h4 class="font-semibold mt-5 mb-3">分项处理范围</h4><ul class="list-disc pl-5 space-y-2">${plan.rules
    .map(rule => `<li>${escapeHtml(actions[rule.action] || '需要另行核查的资料')}。尚不代表已获准执行或已经完成。</li>`).join('')}</ul>`;
}

async function openDeletionPlan(requestId) {
  const receipt = deletionReview.requests.get(requestId);
  if (!receipt || !authToken || state.currentSection !== 'deletionReview') return;
  const token = authToken, generation = deletionReview.generation, detailGeneration = ++deletionReview.detailGeneration;
  const host = document.getElementById('deletionPlanDetail');
  host.textContent = '正在核查资料范围…';
  try {
    const response = await readDeletionReview(`/${receipt.id}/plan?revision=${receipt.revision}`, token);
    if (token !== authToken || generation !== deletionReview.generation || detailGeneration !== deletionReview.detailGeneration
      || state.currentSection !== 'deletionReview') return;
    if (response.code !== 'ACCOUNT_DELETION_PLAN_PREVIEW') throw new Error('DELETION_INVALID_RESPONSE');
    host.innerHTML = deletionPlanMarkup(response.plan, receipt);
  } catch (error) {
    if (token !== authToken || generation !== deletionReview.generation || detailGeneration !== deletionReview.detailGeneration
      || state.currentSection !== 'deletionReview') return;
    host.textContent = deletionReviewMessage(error);
  }
}

async function loadDashboard() {
  const range = getInputValue('dashboardRange') || 'today';
  const dateFrom = getInputValue('dashboardDateFrom');
  const dateTo = getInputValue('dashboardDateTo');
  const params = new URLSearchParams();
  if (range) params.set('range', range);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const stats = await apiRequest(`/admin/stats?${params.toString()}`);
    setText('totalUsers', stats.totalUsers || 0);
    setText('activeItems', stats.activeItems || 0);
    setText('totalOrders', stats.totalOrders || 0);
    setText('totalRevenue', formatMoney(stats.totalRevenue));
    setText('pendingReports', stats.pendingReports || 0);
    setText('pendingFeedbacks', stats.pendingFeedbacks || 0);
    setText('todayUsers', stats.todayUsers || 0);
    setText('todayOrders', stats.todayOrders || 0);
    setText('pendingDisputeOrders', stats.pendingDisputeOrders || 0);
    setText('todayItems', stats.todayItems || 0);
    setText('todayDealAmount', formatMoney(stats.todayDealAmount || 0));
    setText('todayCompletedTrades', stats.todayCompletedTrades || 0);
    setText('pendingDisputes', stats.pendingDisputes || 0);
    setText('pendingReviewItems', stats.pendingReviewItems || 0);
    setText('pinnedItems', stats.pinnedItems || 0);
    setText('pinRevenue', formatMoney(stats.pinRevenue || 0));
    setText('membershipRevenue', formatMoney(stats.membershipRevenue || 0));
    setText('offlineServicePendingCount', stats.offlineServicePendingCount || 0);
    setText('pendingWithdrawals', stats.pendingWithdrawals || 0);
    setText('pendingWithdrawalAmount', formatMoney(stats.pendingWithdrawalAmount || 0));

    const todos = stats.todos || {};
    const todoHtml = `
      <button onclick="openSectionWithPreset('reports', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理举报：${todos.pendingReports || 0}</button>
      <button onclick="openSectionWithPreset('feedbacks', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理反馈：${todos.pendingFeedbacks || 0}</button>
      <button onclick="openSectionWithPreset('disputes', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理纠纷：${todos.pendingDisputes || 0}</button>
      <button onclick="openSectionWithPreset('items', 'pendingReview')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待审核商品：${todos.pendingReviewItems || 0}</button>
      <button onclick="openSectionWithPreset('offline', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理线下服务：${todos.pendingOfflineServices || 0}</button>
      <button onclick="openSectionWithPreset('orders', 'pendingDispute')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理取消订单：${todos.pendingCancelOrders || 0}</button>
      <button onclick="openSectionWithPreset('withdrawals', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理提现：${todos.pendingWithdrawals || 0}</button>
      <button onclick="openSectionWithPreset('commercialization', 'paymentExceptions')" class="w-full text-left border rounded p-2 hover:bg-gray-50">置顶支付异常：${todos.paymentExceptions || 0}</button>
      <button onclick="openSectionWithPreset('feedbacks', 'highPriorityBug')" class="w-full text-left border rounded p-2 hover:bg-gray-50">高优先级 Bug：${todos.highPriorityBugs || 0}</button>
    `;
    setHtml('dashboardTodos', todoHtml);
  } catch (error) {
    const message = recoverableLoadMessage('运营统计', error);
    showError(message);
    renderRecoverableLoadError('dashboardTodos', message, loadDashboard);
  }
}

async function loadUsers(page = 1) {
  state.currentPage.users = page;

  const params = new URLSearchParams({ page: String(page), limit: '20' });
  const search = getInputValue('userSearch');
  const isBanned = getInputValue('userBannedFilter');
  const role = getInputValue('userRoleFilter');
  const isMember = getInputValue('userMemberFilter');
  const hasReport = getInputValue('userHasReportFilter');
  const hasTrade = getInputValue('userHasTradeFilter');
  const dateFrom = getInputValue('userDateFrom');
  const dateTo = getInputValue('userDateTo');
  const sortBy = getInputValue('userSortBy');
  const sortOrder = getInputValue('userSortOrder');

  if (search) params.set('search', search);
  if (isBanned) params.set('isBanned', isBanned);
  if (role) params.set('role', role);
  if (isMember) params.set('isMember', isMember);
  if (hasReport) params.set('hasReport', hasReport);
  if (hasTrade) params.set('hasTrade', hasTrade);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (sortBy) params.set('sortBy', sortBy);
  if (sortOrder) params.set('sortOrder', sortOrder);

  try {
    const data = await apiRequest(`/admin/users?${params.toString()}`);
    setText('usersTotalCount', data.total || 0);

    if (!data.users?.length) {
      setHtml('usersList', '<tr><td colspan="13" class="td text-center text-gray-500">暂无用户</td></tr>');
      renderPagination('usersPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'usersList',
      data.users
        .map((user) => {
          const checked = state.selectedUserIds.has(user.id);
          const statusTag = user.isBanned
            ? '<span class="text-red-600 font-semibold">已封禁</span>'
            : '<span class="text-green-700 font-semibold">正常</span>';

          const roleTag = user.isAdmin
            ? '<span class="text-purple-700 font-semibold">admin</span>'
            : '<span class="text-gray-700 font-semibold">user</span>';

          const memberTag =
            user.membershipLevel && !['', 'bronze', 'Bronze'].includes(user.membershipLevel)
              ? `<span class="text-blue-700 font-semibold">${escapeHtml(user.membershipLevel)}</span>`
              : '<span class="text-gray-500">普通</span>';

          const avatar = user.avatarUrl
            ? `<img src="${escapeHtml(resolveImageUrl(user.avatarUrl))}" class="w-9 h-9 rounded-full object-cover border border-gray-200" />`
            : '<div class="w-9 h-9 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">NA</div>';

          return `
            <tr>
              <td class="td">
                <input
                  aria-label="选择用户 ${user.id}"
                  type="checkbox"
                  class="user-checkbox"
                  ${checked ? 'checked' : ''}
                  onchange="toggleUserSelection(${user.id}, this.checked)"
                />
              </td>
              <td class="td">${user.id}</td>
              <td class="td">${avatar}</td>
              <td class="td">${escapeHtml(user.nickname || '未设置')}</td>
              <td class="td">${escapeHtml(maskEmail(user.email || '-'))}</td>
              <td class="td">${roleTag}</td>
              <td class="td">${user._count?.items || 0}</td>
              <td class="td">${user.completedTrades || user._count?.buyerOrders || 0}</td>
              <td class="td">${user.targetedReportCount || 0}</td>
              <td class="td">${memberTag}</td>
              <td class="td">${formatDate(user.createdAt)}</td>
              <td class="td">${statusTag}</td>
              <td class="td">
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label="查看用户 ${user.id} 详情"
                    title="查看详情"
                    onclick="openUserDetail(${user.id})"
                    class="action-btn action-btn-blue"
                  >详情</button>
                  <button
                    type="button"
                    aria-label="修改用户 ${user.id} 角色"
                    title="修改角色"
                    onclick="changeUserRole(${user.id}, '${user.isAdmin ? 'admin' : 'user'}')"
                    class="action-btn action-btn-blue"
                  >角色</button>
                  <button
                    type="button"
                    aria-label="修改用户 ${user.id} 的发布权限"
                    title="修改发布权限"
                    onclick="changeUserPublishPermission(${user.id}, '${(user.publishPermission?.status || 'ACTIVE')}')"
                    class="action-btn action-btn-amber"
                  >发布权限</button>
                  <button
                    type="button"
                    aria-label="添加用户 ${user.id} 管理员备注"
                    title="添加备注"
                    onclick="addUserAdminNote(${user.id})"
                    class="action-btn action-btn-blue"
                  >备注</button>
                  ${user.isAdmin
                    ? '<span class="action-btn action-btn-amber" aria-label="管理员账号，不能封禁">管理员</span>'
                    : `
                      <button
                        type="button"
                        aria-label="${user.isBanned ? `解封用户 ${user.id}` : `封禁用户 ${user.id}`}"
                        title="${user.isBanned ? '解封用户' : '封禁用户'}"
                        onclick="toggleUserBan(${user.id}, ${!user.isBanned})"
                        class="action-btn ${user.isBanned ? 'action-btn-green' : 'action-btn-red'}"
                      >${user.isBanned ? '解封' : '封禁'}</button>
                    `}
                </div>
              </td>
            </tr>
          `;
        })
        .join('')
    );

    renderPagination('usersPagination', page, data.totalPages || 1, loadUsers);
  } catch (error) {
    const message = recoverableLoadMessage('用户列表', error);
    showError(message);
    renderRecoverableLoadError('usersList', message, () => loadUsers(page), { tableColumnCount: 13 });
  }
}

async function toggleUserBan(userId, willBan) {
  let reason = '';
  if (willBan) {
    reason = (await promptReason('封禁用户', true)) || '';
    if (!reason) return;
  } else {
    reason = (await promptReason('解封用户（可选备注）', false)) ?? '';
  }

  if (!(await confirmCriticalAction(willBan ? '封禁用户' : '解封用户', reason))) return;

  try {
    await apiRequest(`/admin/users/${userId}/ban`, {
      method: 'PATCH',
      body: JSON.stringify({ isBanned: willBan, reason }),
    });
    await loadUsers(state.currentPage.users);
  } catch (error) {
    showError(`${willBan ? '封禁' : '解封'}失败: ${error.message}`);
  }
}

function toggleUserSelection(userId, checked) {
  if (checked) state.selectedUserIds.add(userId);
  else state.selectedUserIds.delete(userId);
  updateSelectionCount();
}

function toggleSelectAllUsers(checked) {
  document.querySelectorAll('.user-checkbox').forEach((checkbox) => {
    checkbox.checked = checked;
    const row = checkbox.closest('tr');
    const idText = row?.querySelector('td:nth-child(2)')?.textContent || '';
    const userId = Number(String(idText).trim());
    if (!Number.isInteger(userId) || userId <= 0) return;
    if (checked) state.selectedUserIds.add(userId);
    else state.selectedUserIds.delete(userId);
  });
  updateSelectionCount();
}

async function changeUserRole(userId, currentRole) {
  const nextRole = (await promptText('输入角色（admin/user）', currentRole || 'user', {
    title: '修改用户角色',
    label: '角色',
    confirmText: '继续',
    confirmVariant: 'dark',
  }))?.toLowerCase?.() || '';
  if (!nextRole) return;
  if (!['admin', 'user'].includes(nextRole)) {
    showError('角色仅支持 admin 或 user');
    return;
  }
  const reason = await promptReason('修改用户角色', true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`修改用户角色为 ${nextRole}`, reason))) return;

  try {
    await apiRequest(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: nextRole, reason }),
    });
    await loadUsers(state.currentPage.users);
  } catch (error) {
    showError(`角色修改失败: ${error.message}`);
  }
}

async function changeUserPublishPermission(userId, currentStatus) {
  const input = (await promptText('输入发布权限状态（ACTIVE/PAUSED）', currentStatus || 'ACTIVE', {
    title: '修改发布权限',
    label: '发布权限状态',
    confirmText: '继续',
    confirmVariant: 'dark',
  }))?.toUpperCase?.() || '';
  if (!input) return;
  if (!['ACTIVE', 'PAUSED'].includes(input)) {
    showError('仅支持 ACTIVE / PAUSED');
    return;
  }
  const reason = await promptReason(input === 'PAUSED' ? '暂停发布权限' : '恢复发布权限', true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`发布权限改为 ${input}`, reason))) return;

  try {
    await apiRequest(`/admin/users/${userId}/publish-permission`, {
      method: 'PATCH',
      body: JSON.stringify({ status: input, reason }),
    });
    await loadUsers(state.currentPage.users);
  } catch (error) {
    showError(`发布权限更新失败: ${error.message}`);
  }
}

async function addUserAdminNote(userId) {
  const note = (await promptText('输入管理员备注：', '', {
    title: '添加管理员备注',
    label: '管理员备注',
    multiline: true,
    confirmText: '保存',
    confirmVariant: 'dark',
  })) || '';
  if (!note.trim()) return;
  if (!(await confirmCriticalAction('添加管理员备注', note.trim()))) return;

  try {
    await apiRequest(`/admin/users/${userId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note: note.trim() }),
    });
    showSuccess('备注已保存');
  } catch (error) {
    showError(`保存备注失败: ${error.message}`);
  }
}

async function openUserDetail(userId) {
  try {
    const data = await apiRequest(`/admin/users/${userId}`);
    const user = data.user;

    const recentBuy = (data.recentBuyOrders || [])
      .map((order) => `<li>#${order.id} · ${escapeHtml(order.item?.title || '未知商品')} · ${order.status}</li>`)
      .join('');

    const recentSell = (data.recentSellOrders || [])
      .map((order) => `<li>#${order.id} · ${escapeHtml(order.item?.title || '未知商品')} · ${order.status}</li>`)
      .join('');

    const reportsSubmitted = (data.reportsSubmitted || [])
      .map((report) => `<li>#${report.id} · ${escapeHtml(report.reason || '-')} · ${report.status}</li>`)
      .join('');

    const reportsTargeted = (data.reportsTargeted || [])
      .map((report) => `<li>#${report.id} · ${escapeHtml(report.reason || '-')} · ${report.status}</li>`)
      .join('');

    const feedbacks = (data.feedbacks || [])
      .map((feedback) => `<li>#${feedback.id} · ${escapeHtml(feedback.title || '-')} · ${feedback.status}</li>`)
      .join('');

    const publishPermission = data.publishPermission || {};
    const adminLogs = (data.adminLogs || [])
      .slice(0, 12)
      .map((log) => `<li>${formatDateTime(log.createdAt)} · ${escapeHtml(log.action)} · ${escapeHtml(log.admin?.nickname || maskEmail(log.admin?.email) || '-')}</li>`)
      .join('');

    const html = `
      <div class="space-y-3">
        <div><span class="font-semibold">用户ID：</span>${user.id}</div>
        <div><span class="font-semibold">昵称：</span>${escapeHtml(user.nickname || '-')}</div>
        <div><span class="font-semibold">邮箱：</span>${escapeHtml(maskEmail(user.email || '-'))}</div>
        <div><span class="font-semibold">注册时间：</span>${formatDateTime(user.createdAt)}</div>
        <div><span class="font-semibold">更新时间：</span>${formatDateTime(user.updatedAt)}</div>
        <div><span class="font-semibold">角色：</span>${user.isAdmin ? 'admin' : 'user'}</div>
        <div><span class="font-semibold">封禁状态：</span>${user.isBanned ? '已封禁' : '正常'}</div>
        <div><span class="font-semibold">发布权限：</span>${escapeHtml(publishPermission.status || 'ACTIVE')} ${publishPermission.reason ? `（${escapeHtml(publishPermission.reason)}）` : ''}</div>
        <div><span class="font-semibold">商品数：</span>${user._count?.items || 0}</div>
        <div><span class="font-semibold">收藏数：</span>${user._count?.favorites || 0}</div>
        <div><span class="font-semibold">反馈数：</span>${user._count?.feedbacks || 0}</div>
        <div><span class="font-semibold">会员等级：</span>${escapeHtml(user.membershipLevel || 'Bronze')}</div>
        <div><span class="font-semibold">积分：</span>${user.points || 0} · 余额：${formatMoney(user.balance || 0)}</div>
        <hr />
        <div>
          <p class="font-semibold mb-1">最近买单</p>
          <ul class="list-disc pl-5 text-gray-700">${recentBuy || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">最近卖单</p>
          <ul class="list-disc pl-5 text-gray-700">${recentSell || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">提交举报</p>
          <ul class="list-disc pl-5 text-gray-700">${reportsSubmitted || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">被举报记录</p>
          <ul class="list-disc pl-5 text-gray-700">${reportsTargeted || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">反馈记录</p>
          <ul class="list-disc pl-5 text-gray-700">${feedbacks || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">管理员操作日志</p>
          <ul class="list-disc pl-5 text-gray-700">${adminLogs || '<li>暂无</li>'}</ul>
        </div>
      </div>
    `;

    openDetailDrawer(`用户详情 #${user.id}`, html);
  } catch (error) {
    showError(`加载用户详情失败: ${error.message}`);
  }
}

function renderSlaBadge(status) {
  if (status === 'OVERDUE') return '<span class="px-2 py-1 rounded bg-red-100 text-red-700 text-xs">OVERDUE</span>';
  if (status === 'NEAR_DUE') return '<span class="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs">NEAR_DUE</span>';
  if (status === 'ON_TRACK') return '<span class="px-2 py-1 rounded bg-green-100 text-green-700 text-xs">ON_TRACK</span>';
  return '<span class="px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs">NO_SLA</span>';
}

function feedbackStatusBadge(status) {
  const value = String(status || '').toLowerCase();
  const styleMap = {
    pending: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-blue-100 text-blue-700',
    need_more_info: 'bg-purple-100 text-purple-700',
    confirmed: 'bg-emerald-100 text-emerald-700',
    duplicate: 'bg-slate-100 text-slate-700',
    invalid: 'bg-slate-100 text-slate-700',
    fixed: 'bg-green-100 text-green-700',
    accepted: 'bg-lime-100 text-lime-700',
    closed: 'bg-gray-100 text-gray-700',
  };
  const cls = styleMap[value] || 'bg-gray-100 text-gray-700';
  return `<span class="px-2 py-1 rounded text-xs ${cls}">${escapeHtml(value || '-')}</span>`;
}

function feedbackPriorityBadge(priority) {
  const value = String(priority || '').toLowerCase();
  const styleMap = {
    low: 'bg-slate-100 text-slate-700',
    medium: 'bg-blue-100 text-blue-700',
    high: 'bg-orange-100 text-orange-700',
    critical: 'bg-red-100 text-red-700',
  };
  const cls = styleMap[value] || 'bg-gray-100 text-gray-700';
  return `<span class="px-2 py-1 rounded text-xs ${cls}">${escapeHtml(value || '-')}</span>`;
}

function feedbackRewardBadge(rewardStatus) {
  const value = String(rewardStatus || '').toLowerCase();
  const styleMap = {
    granted: 'bg-green-100 text-green-700',
    not_granted: 'bg-gray-100 text-gray-700',
    none: 'bg-slate-100 text-slate-600',
  };
  const cls = styleMap[value] || 'bg-slate-100 text-slate-600';
  return `<span class="px-2 py-1 rounded text-xs ${cls}">${escapeHtml(value || 'none')}</span>`;
}

function renderOrderActionButtons(order) {
  const status = String(order?.status || '').toUpperCase();
  if (status === 'PAID' || status === 'SHIPPED') {
    return `<button onclick="openOrderDispute(${order.id})" class="btn-red">转入纠纷处理</button>`;
  }
  if (status === 'DISPUTED') {
    return '<span class="text-xs text-amber-700">请在纠纷工作台使用具名处理动作</span>';
  }
  return '<span class="text-xs text-gray-500">订单状态由买家流程或受审计的纠纷流程管理</span>';
}

function renderStorageActionButtons(order) {
  return '<span class="text-xs text-gray-500">当前 V1 对仓储记录仅提供只读查看</span>';
}

async function loadReports(page = 1) {
  state.currentPage.reports = page;

  const params = new URLSearchParams({ page: String(page), limit: '10' });
  const status = getInputValue('reportStatus');
  const targetType = getInputValue('reportTargetType');
  const search = getInputValue('reportSearch');
  const dateFrom = getInputValue('reportDateFrom');
  const dateTo = getInputValue('reportDateTo');
  const sortBy = getInputValue('reportSortBy');
  const sortOrder = getInputValue('reportSortOrder');

  if (status) params.set('status', status);
  if (targetType) params.set('targetType', targetType);
  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (sortBy) params.set('sortBy', sortBy);
  if (sortOrder) params.set('sortOrder', sortOrder);

  try {
    const data = await apiRequest(`/admin/reports?${params.toString()}`);
    setText('reportsTotalCount', data.total || 0);

    if (!data.reports?.length) {
      setHtml('reportsList', '<div class="card text-center text-gray-500">暂无举报</div>');
      renderPagination('reportsPagination', 1, 1, () => {});
      updateSelectionCount();
      return;
    }

    const reportHtml = data.reports
      .map((report) => {
        const isChecked = state.selectedReportIds.has(report.id);
        const assignment = report.assignment
          ? `<div class="text-xs text-gray-700">负责人：${escapeHtml(report.assignment.assigneeName)} · 优先级：${report.assignment.priority} · 截止：${
              report.assignment.dueAt ? formatDateTime(report.assignment.dueAt) : '-'
            }</div>`
          : '<div class="text-xs text-gray-500">未指派</div>';

        return `
          <div class="card">
            <div class="flex justify-between items-start gap-3 mb-2">
              <div class="flex items-start gap-2">
                <input type="checkbox" class="report-checkbox mt-1" ${isChecked ? 'checked' : ''} onchange="toggleReportSelection(${report.id}, this.checked)" />
                <div>
                  <p class="font-semibold">举报 #${report.id} · ${report.targetType}#${report.targetId}</p>
                  <p class="text-sm text-gray-700">举报理由：${escapeHtml(report.reason || '-')}</p>
                  <p class="text-sm text-gray-700">详情：${escapeHtml(report.description || '-')}</p>
                  <p class="text-sm text-gray-700">举报人：${escapeHtml(report.reporter?.nickname || '未知')} (${escapeHtml(
          maskEmail(report.reporter?.email || '-')
        )})</p>
                  <p class="text-xs text-gray-500 mt-1">创建于 ${formatDateTime(report.createdAt)}</p>
                </div>
              </div>
              <div class="flex flex-col gap-1 items-end">
                <span class="px-2 py-1 rounded text-xs ${
                  report.status === 'PENDING'
                    ? 'bg-amber-100 text-amber-700'
                    : report.status === 'HANDLED'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
                }">${report.status}</span>
                ${renderSlaBadge(report.slaStatus)}
              </div>
            </div>
            ${assignment}
            ${renderReportEvidenceImages(report)}
            <div class="flex flex-wrap gap-2 mt-3">
              <button onclick="openReportDetail(${report.id})" class="btn-gray">详情</button>
              <button onclick="assignReport(${report.id})" class="btn-gray">指派</button>
              <button onclick="resolveReport(${report.id}, 'DELETE_CONTENT')" class="btn-red">删除内容</button>
              <button onclick="resolveReport(${report.id}, 'BAN_USER')" class="btn-red">封禁用户</button>
              <button onclick="resolveReport(${report.id}, 'REJECT')" class="btn-gray">驳回</button>
            </div>
          </div>
        `;
      })
      .join('');

    setHtml('reportsList', reportHtml);
    renderPagination('reportsPagination', page, data.totalPages || 1, loadReports);
    updateSelectionCount();
  } catch (error) {
    const message = recoverableLoadMessage('举报列表', error);
    showError(message);
    renderRecoverableLoadError('reportsList', message, () => loadReports(page));
  }
}

function toggleReportSelection(reportId, checked) {
  if (checked) state.selectedReportIds.add(reportId);
  else state.selectedReportIds.delete(reportId);
  updateSelectionCount();
}

function toggleSelectAllReports(checked) {
  document.querySelectorAll('.report-checkbox').forEach((checkbox) => {
    checkbox.checked = checked;
    const card = checkbox.closest('.card');
    if (!card) return;
    const match = card.querySelector('p.font-semibold')?.textContent || '';
    const idMatch = match.match(/举报 #(\d+)/);
    if (!idMatch) return;
    const reportId = Number(idMatch[1]);
    if (checked) state.selectedReportIds.add(reportId);
    else state.selectedReportIds.delete(reportId);
  });
  updateSelectionCount();
}

async function assignReport(reportId) {
  const assigneeRaw = (await promptText('输入要指派的管理员ID（留空=指派给自己）：', '', {
    title: '指派举报',
    label: '管理员ID',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const priorityRaw = ((await promptText('输入优先级（LOW/MEDIUM/HIGH）', 'MEDIUM', {
    title: '指派举报',
    label: '优先级',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || 'MEDIUM').toUpperCase();
  const dueAtRaw = (await promptText('输入SLA截止时间（可选，例如 2026-05-01 18:00）：', '', {
    title: '指派举报',
    label: 'SLA 截止时间',
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const note = (await promptText('输入指派备注（可选）：', '', {
    title: '指派举报',
    label: '指派备注',
    multiline: true,
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';

  let dueAt;
  if (dueAtRaw.trim()) {
    const parsed = new Date(dueAtRaw.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) {
      showError('SLA时间格式无效');
      return;
    }
    dueAt = parsed.toISOString();
  }

  try {
    await apiRequest(`/admin/reports/${reportId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({
        assigneeAdminId: assigneeRaw ? Number(assigneeRaw) : undefined,
        priority: priorityRaw,
        dueAt,
        note,
      }),
    });

    await loadReports(state.currentPage.reports);
  } catch (error) {
    showError(`指派失败: ${error.message}`);
  }
}

async function resolveReport(reportId, action) {
  const actionLabel =
    action === 'DELETE_CONTENT' ? '删除举报内容' : action === 'BAN_USER' ? '封禁被举报用户' : '驳回举报';
  const reason = await promptReason(actionLabel, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(actionLabel, reason))) return;

  try {
    await apiRequest(`/admin/reports/${reportId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    });

    state.selectedReportIds.delete(reportId);
    await loadReports(state.currentPage.reports);
  } catch (error) {
    showError(`处理失败: ${error.message}`);
  }
}

async function openReportDetail(reportId) {
  try {
    const data = await apiRequest(`/admin/reports/${reportId}`);
    const report = data.report;
    const target = data.target;
    const logs = data.logs || [];
    const evidenceHtml = renderReportEvidenceImages(report) || '<p class="text-gray-500">无证据图片</p>';

    const logsHtml = logs.length
      ? `<ul class="list-disc pl-5">${logs
          .map((log) => {
            const auditDetails = formatReportAuditDetails(log.details);
            return `<li>${formatDateTime(log.createdAt)} · ${escapeHtml(log.action)} · ${escapeHtml(
              log.admin?.nickname || maskEmail(log.admin?.email) || '-'
            )}${auditDetails ? ` · ${auditDetails}` : ''}</li>`;
          })
          .join('')}</ul>`
      : '<p class="text-gray-500">暂无日志</p>';

    openDetailDrawer(
      `举报详情 #${report.id}`,
      `
      <div class="space-y-3">
        <div><span class="font-semibold">状态：</span>${escapeHtml(report.status)}</div>
        <div><span class="font-semibold">举报类型：</span>${escapeHtml(report.reason || '-')}</div>
        <div><span class="font-semibold">对象：</span>${escapeHtml(report.targetType)}#${report.targetId}</div>
        <div><span class="font-semibold">描述：</span>${escapeHtml(report.description || '-')}</div>
        <div><span class="font-semibold">举报人：</span>${escapeHtml(data.reporter?.nickname || maskEmail(data.reporter?.email) || '-')}</div>
        <div><span class="font-semibold">被举报对象：</span>${escapeHtml(target?.title || target?.nickname || maskEmail(target?.email) || '-')}</div>
        <div><span class="font-semibold">创建时间：</span>${formatDateTime(report.createdAt)}</div>
        <div><span class="font-semibold">更新时间：</span>${formatDateTime(report.updatedAt)}</div>
        <hr />
        <div>
          <p class="font-semibold mb-1">证据</p>
          ${evidenceHtml}
        </div>
        <hr />
        <div>
          <p class="font-semibold mb-1">处理日志</p>
          ${logsHtml}
        </div>
      </div>
      `
    );
  } catch (error) {
    showError(`加载举报详情失败: ${error.message}`);
  }
}

function formatReportAuditDetails(details) {
  if (!details || typeof details !== 'object') return '';

  const parts = [];
  if (details.reason) parts.push(`原因：${details.reason}`);
  if (details.previousStatus || details.nextStatus) {
    parts.push(`举报状态：${details.previousStatus || '-'} → ${details.nextStatus || '-'}`);
  }

  const effect = details.effect;
  if (effect?.kind === 'ITEM_WITHDRAWN') {
    parts.push(`商品状态：${effect.previousStatus || '-'} → ${effect.nextStatus || '-'}`);
  } else if (effect?.kind === 'USER_BANNED') {
    parts.push(
      `用户封禁：${effect.previousState?.isBanned ? '已封禁' : '正常'} → ${
        effect.nextState?.isBanned ? '已封禁' : '正常'
      }`
    );
  }

  return parts.map((part) => escapeHtml(part)).join(' · ');
}

async function batchResolveReports(action) {
  const ids = [...state.selectedReportIds];
  if (!ids.length) {
    showError('请先勾选至少一条举报');
    return;
  }

  const actionLabel =
    action === 'DELETE_CONTENT' ? '批量删除内容' : action === 'BAN_USER' ? '批量封禁用户' : '批量驳回举报';
  const previewItems = collectBatchPreview('.report-checkbox', ['p.font-semibold'], 5);
  if (!(await confirmBatchPreview(actionLabel, ids.length, previewItems, '举报处理'))) return;

  const reason = await promptReason(actionLabel, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`${actionLabel}（${ids.length}条）`, reason))) return;

  try {
    const result = await apiRequest('/admin/reports/batch-resolve', {
      method: 'PATCH',
      body: JSON.stringify({ reportIds: ids, action, reason }),
    });

    showSuccess(`批量处理完成：成功 ${result.successIds?.length || 0} 条，失败 ${result.failed?.length || 0} 条`);
    state.selectedReportIds.clear();
    await loadReports(state.currentPage.reports);
  } catch (error) {
    showError(`批量处理失败: ${error.message}`);
  }
}

async function loadFeedbacks(page = 1) {
  state.currentPage.feedbacks = page;

  const params = new URLSearchParams({ page: String(page), limit: '10' });
  const type = getInputValue('feedbackType');
  const status = getInputValue('feedbackStatus');
  const priority = getInputValue('feedbackPriority');
  const rewardStatus = getInputValue('feedbackRewardStatus');
  const hasScreenshots = getInputValue('feedbackHasScreenshots');
  const search = getInputValue('feedbackSearch');
  const dateFrom = getInputValue('feedbackDateFrom');
  const dateTo = getInputValue('feedbackDateTo');

  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (rewardStatus) params.set('rewardStatus', rewardStatus);
  if (hasScreenshots) params.set('hasScreenshots', hasScreenshots);
  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const data = await apiRequest(`/admin/feedbacks?${params.toString()}`);
    setText('feedbackTotalCount', data.total || 0);

    if (!data.items?.length) {
      setHtml('feedbackList', '<div class="card text-center text-gray-500">暂无反馈记录</div>');
      renderPagination('feedbackPagination', 1, 1, () => {});
      return;
    }

    const html = data.items
      .map((feedback) => {
        const latestReward = feedback.latestReward
          ? `<p class="text-xs text-gray-600 mt-1">最近奖励：${escapeHtml(feedback.latestReward.rewardType || '-')} ${
              feedback.latestReward.rewardValue ? `(${escapeHtml(feedback.latestReward.rewardValue)})` : ''
            }</p>`
          : '';

        return `
          <div class="card">
            <div class="flex justify-between items-start gap-3 mb-2">
              <div>
                <p class="font-semibold">#${feedback.id} · ${escapeHtml(feedback.title || '-')}</p>
                <p class="text-sm text-gray-700">${escapeHtml(feedback.type || '-')} · 用户：${escapeHtml(
          feedback.user?.nickname || maskEmail(feedback.user?.email) || `#${feedback.user?.id || '-'}`
        )}</p>
                <p class="text-xs text-gray-500">提交时间：${formatDateTime(feedback.createdAt)} · App版本：${escapeHtml(
          feedback.appVersion || '-'
        )}</p>
              </div>
              <div class="flex flex-col items-end gap-1">
                ${feedbackStatusBadge(feedback.status)}
                ${feedbackPriorityBadge(feedback.priority)}
                ${feedbackRewardBadge(feedback.rewardStatus)}
              </div>
            </div>

            <div class="flex flex-wrap gap-2 text-xs mb-2">
              <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">截图：${feedback.hasScreenshots ? `有 (${feedback.screenshotCount})` : '无'}</span>
              <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">奖励状态：${escapeHtml(feedback.rewardStatus || 'none')}</span>
            </div>

            ${latestReward}

            <div class="flex flex-wrap gap-2 mt-3">
              <button type="button" aria-label="查看反馈 ${feedback.id} 详情" onclick="openFeedbackDetail(${feedback.id})" class="btn-gray">详情</button>
              <button type="button" aria-label="修改反馈 ${feedback.id} 状态和优先级" onclick="updateFeedbackStatus(${feedback.id}, '${escapeHtml(feedback.status)}', '${escapeHtml(
          feedback.priority
        )}')" class="btn-gray">改状态/优先级</button>
              <button type="button" aria-label="管理员回复反馈 ${feedback.id}" onclick="replyFeedback(${feedback.id})" class="btn-gray">管理员回复</button>
              <button type="button" aria-label="发放反馈 ${feedback.id} 奖励" onclick="rewardFeedback(${feedback.id})" class="btn-red">发放奖励</button>
            </div>
          </div>
        `;
      })
      .join('');

    setHtml('feedbackList', html);
    renderPagination('feedbackPagination', page, data.totalPages || 1, loadFeedbacks);
  } catch (error) {
    showError(`加载反馈失败: ${error.message}`);
  }
}

async function openFeedbackDetail(feedbackId) {
  try {
    const data = await apiRequest(`/admin/feedbacks/${feedbackId}`);
    const feedback = data.feedback;
    const screenshots = Array.isArray(feedback.screenshotUrls) ? feedback.screenshotUrls : [];
    const rewards = Array.isArray(feedback.rewards) ? feedback.rewards : [];

    const screenshotHtml = screenshots.length
      ? `<div class="mt-2">
          <p class="font-semibold mb-1">截图（${screenshots.length}）</p>
          <div class="flex gap-2 flex-wrap">
            ${screenshots
              .map((url) => {
                const src = resolveImageUrl(url);
                return src
                  ? `<a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">
                      <img src="${escapeHtml(src)}" class="w-20 h-20 object-cover rounded border border-gray-200" />
                    </a>`
                  : '';
              })
              .join('')}
          </div>
        </div>`
      : '<p class="text-gray-500">无截图</p>';

    const rewardsHtml = rewards.length
      ? `<ul class="list-disc pl-5">${rewards
          .map(
            (reward) =>
              `<li>${formatDateTime(reward.createdAt)} · ${escapeHtml(reward.rewardType)} ${
                reward.rewardValue ? `(${escapeHtml(reward.rewardValue)})` : ''
              } · 操作人：${escapeHtml(reward.admin?.nickname || maskEmail(reward.admin?.email) || '-')} · 备注：${escapeHtml(
                reward.note || '-'
              )}</li>`
          )
          .join('')}</ul>`
      : '<p class="text-gray-500">暂无奖励记录</p>';

    const html = `
      <div class="space-y-3">
        <div><span class="font-semibold">反馈ID：</span>${feedback.id}</div>
        <div><span class="font-semibold">类型：</span>${escapeHtml(feedback.type)}</div>
        <div><span class="font-semibold">标题：</span>${escapeHtml(feedback.title)}</div>
        <div><span class="font-semibold">描述：</span>${escapeHtml(feedback.description || '-')}</div>
        <div><span class="font-semibold">发生页面：</span>${escapeHtml(feedback.occurredPage || '-')}</div>
        <div><span class="font-semibold">期望结果：</span>${escapeHtml(feedback.expectedResult || '-')}</div>
        <div><span class="font-semibold">实际结果：</span>${escapeHtml(feedback.actualResult || '-')}</div>
        <div><span class="font-semibold">复现步骤：</span>${escapeHtml(feedback.reproduceSteps || '-')}</div>
        <div><span class="font-semibold">重复出现：</span>${feedback.isRecurring === null || feedback.isRecurring === undefined ? '-' : feedback.isRecurring ? '是' : '否'}</div>
        <div><span class="font-semibold">联系方式：</span>${escapeHtml(maskContact(feedback.contact || '-'))}</div>
        <div><span class="font-semibold">状态：</span>${feedbackStatusBadge(feedback.status)}</div>
        <div><span class="font-semibold">优先级：</span>${feedbackPriorityBadge(feedback.priority)}</div>
        <div><span class="font-semibold">奖励状态：</span>${feedbackRewardBadge(feedback.rewardStatus)}</div>
        <div><span class="font-semibold">管理员回复：</span>${escapeHtml(feedback.adminReply || '-')}</div>
        <div><span class="font-semibold">管理员备注：</span>${escapeHtml(feedback.adminNote || '-')}</div>
        <hr />
        <div>
          <p class="font-semibold">设备与版本信息</p>
          <p>App版本：${escapeHtml(feedback.appVersion || '-')}</p>
          <p>iOS版本：${escapeHtml(feedback.iosVersion || '-')}</p>
          <p>设备型号：${escapeHtml(feedback.deviceModel || '-')}</p>
          <p>当前页面：${escapeHtml(feedback.currentPage || '-')}</p>
          <p>最近错误：${escapeHtml(feedback.recentErrorMessage || '-')}</p>
        </div>
        <hr />
        <div>
          <p class="font-semibold">关联信息</p>
          <p>用户：${escapeHtml(feedback.user?.nickname || '-')} (${escapeHtml(maskEmail(feedback.user?.email || '-'))})</p>
          <p>关联商品：${feedback.relatedItem ? `#${feedback.relatedItem.id} ${escapeHtml(feedback.relatedItem.title || '-')}` : '-'}</p>
          <p>关联订单：${feedback.relatedOrder ? `#${feedback.relatedOrder.id} ${feedback.relatedOrder.status}` : '-'}</p>
        </div>
        <hr />
        ${screenshotHtml}
        <hr />
        <div>
          <p class="font-semibold mb-1">奖励记录</p>
          ${rewardsHtml}
        </div>
      </div>
    `;

    openDetailDrawer(`反馈详情 #${feedback.id}`, html);
  } catch (error) {
    showError(`加载反馈详情失败: ${error.message}`);
  }
}

async function updateFeedbackStatus(feedbackId, currentStatus, currentPriority) {
  const status = await promptText(
    '输入新状态（pending/in_progress/need_more_info/confirmed/duplicate/invalid/fixed/accepted/closed）',
    currentStatus || 'pending',
    {
      title: '更新反馈状态',
      label: '新状态',
      confirmText: '继续',
      confirmVariant: 'dark',
    }
  );
  if (status === null) return;
  const priority = await promptText('输入优先级（low/medium/high/critical）', currentPriority || 'medium', {
    title: '更新反馈状态',
    label: '优先级',
    confirmText: '继续',
    confirmVariant: 'dark',
  });
  if (priority === null) return;
  const reason = await promptReason('更新反馈状态原因', true);
  if (reason === null) return;
  const adminNote = (await promptText('管理员备注（可选）', '', {
    title: '更新反馈状态',
    label: '管理员备注',
    multiline: true,
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  if (!(await confirmCriticalAction(`更新反馈状态为 ${status.trim()}`, reason))) return;

  try {
    await apiRequest(`/admin/feedbacks/${feedbackId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: status.trim(),
        priority: priority.trim(),
        adminNote: adminNote.trim(),
        reason,
      }),
    });
    await loadFeedbacks(state.currentPage.feedbacks);
  } catch (error) {
    showError(`更新反馈失败: ${error.message}`);
  }
}

async function replyFeedback(feedbackId) {
  const adminReply = (await promptText('请输入回复内容（会显示给用户）:', '', {
    title: '回复反馈',
    label: '回复内容',
    multiline: true,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  if (!adminReply.trim()) {
    showError('回复内容不能为空');
    return;
  }
  const reason = await promptReason('管理员回复原因', true);
  if (reason === null) return;
  if (!(await confirmCriticalAction('回复反馈', reason))) return;

  try {
    await apiRequest(`/admin/feedbacks/${feedbackId}`, {
      method: 'PATCH',
      body: JSON.stringify({ adminReply: adminReply.trim(), reason }),
    });
    await loadFeedbacks(state.currentPage.feedbacks);
  } catch (error) {
    showError(`回复失败: ${error.message}`);
  }
}

async function rewardFeedback(feedbackId) {
  const rewardType = normalizeFeedbackRewardType((await promptText(paymentsAreEnabled() ? '奖励类型（不发放 / 置顶 / 代金券 / 会员天数 / 积分 / 余额）' : '奖励类型（不发放 / 置顶 / 代金券 / 会员天数 / 积分；余额暂未开放）', '不发放', {
    title: '发放反馈奖励',
    label: '奖励类型',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '不发放');
  if (!rewardType) return;
  if (rewardType === 'BALANCE' && !paymentsAreEnabled()) {
    showError(paymentsUnavailableMessage);
    return;
  }

  const rewardValue = (await promptText('奖励值（例如 24h / 7 / 100 / 10.00，可选）', '', {
    title: '发放反馈奖励',
    label: '奖励值',
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const note = (await promptText('奖励备注（可选）', '', {
    title: '发放反馈奖励',
    label: '奖励备注',
    multiline: true,
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const reason = await promptReason('发放反馈奖励原因', true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`发放反馈奖励：${rewardType}`, reason))) return;

  try {
    await apiRequest(`/admin/feedbacks/${feedbackId}/rewards`, {
      method: 'POST',
      body: JSON.stringify({
        rewardType,
        rewardValue,
        note,
        confirm: true,
        reason,
      }),
    });
    showSuccess('奖励处理成功');
    await loadFeedbacks(state.currentPage.feedbacks);
  } catch (error) {
    showError(`奖励发放失败: ${error.message}`);
  }
}

async function loadItems(page = 1) {
  state.currentPage.items = page;

  const params = new URLSearchParams({ page: String(page), limit: '12' });
  const status = getInputValue('itemStatus');
  const search = getInputValue('itemSearch');
  const category = getInputValue('itemCategory');
  const city = getInputValue('itemCity');
  const sellerKeyword = getInputValue('itemSeller');
  const minPrice = getInputValue('itemMinPrice');
  const maxPrice = getInputValue('itemMaxPrice');
  const isPinned = getInputValue('itemPinned');
  const isUrgent = getInputValue('itemUrgent');
  const hasReports = getInputValue('itemHasReports');
  const dateFrom = getInputValue('itemDateFrom');
  const dateTo = getInputValue('itemDateTo');

  if (status) params.set('status', status);
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (city) params.set('city', city);
  if (sellerKeyword) params.set('sellerKeyword', sellerKeyword);
  if (minPrice) params.set('minPrice', minPrice);
  if (maxPrice) params.set('maxPrice', maxPrice);
  if (isPinned) params.set('isPinned', isPinned);
  if (isUrgent) params.set('isUrgent', isUrgent);
  if (hasReports) params.set('hasReports', hasReports);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const data = await apiRequest(`/admin/items?${params.toString()}`);
    setText('itemsTotalCount', data.total || 0);

    if (!data.items?.length) {
      setHtml('itemsList', '<div class="card text-center text-gray-500">暂无商品</div>');
      renderPagination('itemsPagination', 1, 1, () => {});
      updateSelectionCount();
      return;
    }

    setHtml(
      'itemsList',
      data.items
        .map((item) => {
          const images = getImages(item.images);
          const thumb = images[0] ? resolveImageUrl(images[0]) : '';
          const checked = state.selectedItemIds.has(item.id);

          return `
            <div class="card">
              <div class="flex justify-between items-start mb-2">
                <div class="flex items-start gap-2">
                  <input type="checkbox" class="item-checkbox mt-1" ${checked ? 'checked' : ''} onchange="toggleItemSelection(${item.id}, this.checked)" />
                  <div>
                    <h4 class="font-semibold">#${item.id} · ${escapeHtml(item.title)}</h4>
                    <p class="text-sm text-gray-600">${escapeHtml(item.category || '-')} · ${escapeHtml(item.pickupCity || '-')}</p>
                  </div>
                </div>
                <span class="px-2 py-1 rounded text-xs ${
                  item.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-700'
                    : item.status === 'WITHDRAWN'
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-amber-100 text-amber-700'
                }">${item.status}</span>
              </div>
              ${
                thumb
                  ? `<img src="${escapeHtml(thumb)}" class="w-full h-36 object-cover rounded mb-3" />`
                  : '<div class="h-36 bg-gray-100 rounded mb-3 flex items-center justify-center text-gray-400">无图片</div>'
              }
              <p class="text-sm text-gray-700 mb-1">卖家：${escapeHtml(item.seller?.nickname || '未知')} (${escapeHtml(maskEmail(item.seller?.email || '-'))})</p>
              <p class="text-sm text-gray-700 mb-1">价格：${formatMoney(item.expectedPrice)} · 浏览 ${item.viewCount || 0} · 收藏 ${item.favoritesCount || 0}</p>
              <p class="text-sm text-gray-700 mb-3">置顶：${item.isPinned ? '是' : '否'} · 置顶到期：${formatDateTime(item.pinnedAt)} · 举报 ${item.reportCount || 0}</p>
              <div class="flex gap-2 flex-wrap">
                <button onclick="openItemDetail(${item.id})" class="btn-gray">详情</button>
                <button onclick="setItemStatus(${item.id}, 'ACTIVE')" class="btn-gray">恢复</button>
                <button onclick="setItemStatus(${item.id}, 'WITHDRAWN')" class="btn-red">下架</button>
                <button onclick="setItemStatus(${item.id}, 'REJECTED')" class="btn-red">审核拒绝</button>
                <button onclick="adjustItemPin(${item.id}, 'EXTEND_24H')" class="btn-gray">补偿置顶</button>
              </div>
            </div>
          `;
        })
        .join('')
    );

    renderPagination('itemsPagination', page, data.totalPages || 1, loadItems);
    updateSelectionCount();
  } catch (error) {
    const message = recoverableLoadMessage('商品列表', error);
    showError(message);
    renderRecoverableLoadError('itemsList', message, () => loadItems(page));
  }
}

function toggleItemSelection(itemId, checked) {
  if (checked) state.selectedItemIds.add(itemId);
  else state.selectedItemIds.delete(itemId);
  updateSelectionCount();
}

function toggleSelectAllItems(checked) {
  document.querySelectorAll('.item-checkbox').forEach((checkbox) => {
    checkbox.checked = checked;
    const card = checkbox.closest('.card');
    const title = card?.querySelector('h4')?.textContent || '';
    const idMatch = title.match(/#(\d+)/);
    if (!idMatch) return;
    const id = Number(idMatch[1]);
    if (checked) state.selectedItemIds.add(id);
    else state.selectedItemIds.delete(id);
  });
  updateSelectionCount();
}

async function batchUpdateItemsStatus(status) {
  const itemIds = [...state.selectedItemIds];
  if (!itemIds.length) {
    showError('请先勾选商品');
    return;
  }

  const previewItems = collectBatchPreview('.item-checkbox', ['h4.font-semibold'], 5);
  if (!(await confirmBatchPreview(`批量更新商品状态为 ${status}`, itemIds.length, previewItems, '商品管理'))) return;

  let reason = '';
  if (status === 'WITHDRAWN') {
    reason = (await promptReason('批量下架商品', true)) || '';
    if (!reason) return;
  } else {
    reason = (await promptReason(`批量改状态为 ${status}（可选备注）`, false)) ?? '';
  }

  if (!(await confirmCriticalAction(`批量更新商品状态为 ${status}（${itemIds.length}条）`, reason))) return;

  try {
    await apiRequest('/admin/items/batch-status', {
      method: 'PATCH',
      body: JSON.stringify({ itemIds, status, reason }),
    });

    state.selectedItemIds.clear();
    await loadItems(state.currentPage.items);
  } catch (error) {
    showError(`批量更新失败: ${error.message}`);
  }
}

async function deleteItem(itemId) {
  const reason = await promptReason('下架商品', true);
  if (reason === null) return;
  if (!(await confirmCriticalAction('下架商品', reason))) return;

  try {
    await apiRequest(`/admin/items/${itemId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
    state.selectedItemIds.delete(itemId);
    await loadItems(state.currentPage.items);
  } catch (error) {
    showError(`下架失败: ${error.message}`);
  }
}

async function setItemStatus(itemId, status) {
  const needsReason = ['WITHDRAWN', 'REJECTED', 'REMOVED_BY_ADMIN', 'DELETED', 'PAUSED'].includes(status);
  const reason = needsReason
    ? await promptReason(`将商品状态改为 ${status}`, true)
    : await promptReason(`将商品状态改为 ${status}（可选备注）`, false);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`更新商品状态为 ${status}`, reason || '无'))) return;

  try {
    await apiRequest(`/admin/items/${itemId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
    await loadItems(state.currentPage.items);
  } catch (error) {
    showError(`更新商品状态失败: ${error.message}`);
  }
}

async function adjustItemPin(itemId, action) {
  const reason = await promptReason(`执行 ${action}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`调整商品置顶：${action}`, reason))) return;

  try {
    await apiRequest(`/admin/items/${itemId}/pin-adjust`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    });
    await loadItems(state.currentPage.items);
  } catch (error) {
    showError(`调整置顶失败: ${error.message}`);
  }
}

async function openItemDetail(itemId) {
  try {
    const data = await apiRequest(`/admin/items/${itemId}`);
    const item = data.item;
    const reports = data.reports || [];
    const adminLogs = data.adminLogs || [];
    const orderRows = (item.orders || [])
      .map((order) => `<li>订单 #${order.id} · ${order.status} · ${formatMoney(order.amount)}</li>`)
      .join('');

    const reportRows = reports
      .map((report) => `<li>#${report.id} · ${escapeHtml(report.reason || '-')} · ${report.status} · ${formatDateTime(report.createdAt)}</li>`)
      .join('');

    const logRows = adminLogs
      .slice(0, 20)
      .map((log) => `<li>${formatDateTime(log.createdAt)} · ${escapeHtml(log.action)} · ${escapeHtml(log.admin?.nickname || maskEmail(log.admin?.email) || '-')}</li>`)
      .join('');

    const html = `
      <div class="space-y-2">
        <div><span class="font-semibold">商品ID：</span>${item.id}</div>
        <div><span class="font-semibold">标题：</span>${escapeHtml(item.title)}</div>
        <div><span class="font-semibold">分类：</span>${escapeHtml(item.category || '-')}</div>
        <div><span class="font-semibold">状态：</span>${item.status}</div>
        <div><span class="font-semibold">卖家：</span>${escapeHtml(item.seller?.nickname || '-')} (${escapeHtml(maskEmail(item.seller?.email || '-'))})</div>
        <div><span class="font-semibold">城市：</span>${escapeHtml(item.pickupCity || '-')}</div>
        <div><span class="font-semibold">价格：</span>${formatMoney(item.expectedPrice)}</div>
        <div><span class="font-semibold">置顶：</span>${item.isPinned ? '是' : '否'}，到期：${formatDateTime(item.pinnedAt)}</div>
        <div><span class="font-semibold">浏览：</span>${item.viewCount || 0}，收藏：${item.favoritesCount || 0}，举报：${reports.length}</div>
        <div><span class="font-semibold">发布时间：</span>${formatDateTime(item.createdAt)}</div>
        <hr />
        <div>
          <p class="font-semibold mb-1">关联订单（最近10条）</p>
          <ul class="list-disc pl-5 text-gray-700">${orderRows || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">关联举报</p>
          <ul class="list-disc pl-5 text-gray-700">${reportRows || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">操作日志</p>
          <ul class="list-disc pl-5 text-gray-700">${logRows || '<li>暂无</li>'}</ul>
        </div>
      </div>
    `;

    openDetailDrawer(`商品详情 #${item.id}`, html);
  } catch (error) {
    showError(`加载商品详情失败: ${error.message}`);
  }
}

async function loadOrders(page = 1) {
  state.currentPage.orders = page;

  const params = new URLSearchParams({ page: String(page), limit: '10' });
  const status = getInputValue('orderStatus');
  const search = getInputValue('orderSearch');
  const itemKeyword = getInputValue('orderItemKeyword');
  const buyerKeyword = getInputValue('orderBuyer');
  const sellerKeyword = getInputValue('orderSeller');
  const hasDispute = getInputValue('orderHasDispute');
  const dateFrom = getInputValue('orderDateFrom');
  const dateTo = getInputValue('orderDateTo');
  const minAmount = getInputValue('orderMinAmount');
  const maxAmount = getInputValue('orderMaxAmount');

  if (status) params.set('status', status);
  if (search) params.set('search', search);
  if (itemKeyword) params.set('itemKeyword', itemKeyword);
  if (buyerKeyword) params.set('buyerKeyword', buyerKeyword);
  if (sellerKeyword) params.set('sellerKeyword', sellerKeyword);
  if (hasDispute) params.set('hasDispute', hasDispute);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (minAmount) params.set('minAmount', minAmount);
  if (maxAmount) params.set('maxAmount', maxAmount);

  try {
    const data = await apiRequest(`/admin/orders?${params.toString()}`);
    setText('ordersTotalCount', data.total || 0);

    if (!data.orders?.length) {
      setHtml('ordersList', '<div class="card text-center text-gray-500">暂无订单</div>');
      renderPagination('ordersPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'ordersList',
      data.orders
        .map(
          (order) => `
            <div class="card">
              <div class="flex justify-between items-center mb-2">
                <div class="font-semibold">订单 #${order.id}</div>
                <span class="px-2 py-1 rounded text-xs ${
                  order.status === 'COMPLETED'
                    ? 'bg-green-100 text-green-700'
                    : order.status === 'CANCELED'
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-amber-100 text-amber-700'
                }">${order.status}</span>
              </div>
              <p class="text-sm text-gray-700">商品：${escapeHtml(order.item?.title || '-')}</p>
              <p class="text-sm text-gray-700">买家：${escapeHtml(order.buyer?.nickname || '-')}（${escapeHtml(maskEmail(order.buyer?.email || '-'))}）</p>
              <p class="text-sm text-gray-700">卖家：${escapeHtml(order.seller?.nickname || '-')}（${escapeHtml(maskEmail(order.seller?.email || '-'))}）</p>
              <p class="text-sm text-gray-700 mb-1">金额：${formatMoney(order.amount)} · 时间：${formatDateTime(order.createdAt)}</p>
              <p class="text-sm text-gray-700 mb-3">纠纷：${order.hasDispute ? '是' : '否'} · 交易流水：${order.transactionCount || 0}</p>
              <div class="flex flex-wrap gap-2">
                <button onclick="openOrderDetail(${order.id})" class="btn-gray">查看详情</button>
                ${renderOrderActionButtons(order)}
              </div>
            </div>
          `
        )
        .join('')
    );

    renderPagination('ordersPagination', page, data.totalPages || 1, loadOrders);
  } catch (error) {
    const message = recoverableLoadMessage('订单列表', error);
    showError(message);
    renderRecoverableLoadError('ordersList', message, () => loadOrders(page));
  }
}

async function openOrderDetail(orderId) {
  try {
    const data = await apiRequest(`/admin/orders/${orderId}`);
    const order = data.order;

    const transactions = (order.transactions || [])
      .map((tx) => `<li>#${tx.id} · ${tx.type} · ${formatMoney(tx.amount)} · ${formatDateTime(tx.createdAt)}</li>`)
      .join('');

    const movingServices = (order.movingServices || [])
      .map((svc) => `<li>#${svc.id} · ${svc.status} · ${escapeHtml(svc.fromAddress)} → ${escapeHtml(svc.toAddress)}</li>`)
      .join('');

    const html = `
      <div class="space-y-2">
        <div><span class="font-semibold">订单ID：</span>${order.id}</div>
        <div><span class="font-semibold">状态：</span>${order.status}</div>
        <div><span class="font-semibold">金额：</span>${formatMoney(order.amount)}</div>
        <div><span class="font-semibold">支付方式：</span>${escapeHtml(order.payMethod || '-')}</div>
        <div><span class="font-semibold">买家：</span>${escapeHtml(order.buyer?.nickname || '-')} (${escapeHtml(maskEmail(order.buyer?.email || '-'))})</div>
        <div><span class="font-semibold">卖家：</span>${escapeHtml(order.seller?.nickname || '-')} (${escapeHtml(maskEmail(order.seller?.email || '-'))})</div>
        <div><span class="font-semibold">商品：</span>${escapeHtml(order.item?.title || '-')}</div>
        <div><span class="font-semibold">创建时间：</span>${formatDateTime(order.createdAt)}</div>
        <hr />
        <div>
          <p class="font-semibold mb-1">交易流水</p>
          <ul class="list-disc pl-5 text-gray-700">${transactions || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <p class="font-semibold mb-1">搬运服务</p>
          <ul class="list-disc pl-5 text-gray-700">${movingServices || '<li>暂无</li>'}</ul>
        </div>
      </div>
    `;

    openDetailDrawer(`订单详情 #${order.id}`, html);
  } catch (error) {
    showError(`加载订单详情失败: ${error.message}`);
  }
}

async function openOrderDispute(orderId) {
  const reason = await promptReason(`将订单 #${orderId} 转入争议处理`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`开启订单争议 #${orderId}`, reason))) return;

  try {
    await apiRequest(`/admin/disputes/orders/${orderId}/open`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
    await loadOrders(state.currentPage.orders);
    await loadDisputes(state.currentPage.disputes);
  } catch (error) {
    showError(`开启订单争议失败: ${error.message}`);
  }
}

async function loadTransactions(page = 1) {
  state.currentPage.transactions = page;

  const params = new URLSearchParams({ page: String(page), limit: '12' });
  const type = getInputValue('transactionType');
  const source = getInputValue('transactionSource');
  const dateFrom = getInputValue('transactionDateFrom');
  const dateTo = getInputValue('transactionDateTo');
  const minAmount = getInputValue('transactionMinAmount');
  const maxAmount = getInputValue('transactionMaxAmount');

  if (type) params.set('type', type);
  if (source) params.set('source', source);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (minAmount) params.set('minAmount', minAmount);
  if (maxAmount) params.set('maxAmount', maxAmount);

  try {
    const data = await apiRequest(`/admin/transactions?${params.toString()}`);
    setText('transactionsTotalCount', data.total || 0);

    if (!data.transactions?.length) {
      setHtml('transactionsList', '<tr><td colspan="8" class="td text-center text-gray-500">暂无流水</td></tr>');
      renderPagination('transactionsPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'transactionsList',
      data.transactions
        .map(
          (tx) => `
            <tr>
              <td class="td">${escapeHtml(tx.ledgerId || String(tx.id || '-'))}</td>
              <td class="td">${escapeHtml(tx.source || '-')}<br /><span class="text-xs text-gray-500">${escapeHtml(
            formatPaymentChannelLabel(tx.paymentChannel)
          )}</span></td>
              <td class="td">${tx.type}</td>
              <td class="td">${formatMoney(tx.amount)}</td>
              <td class="td">${escapeHtml(tx.user?.nickname || '-')}<br /><span class="text-xs text-gray-500">${escapeHtml(maskEmail(tx.user?.email || '-'))}</span></td>
              <td class="td">${tx.order ? `#${tx.order.id} (${tx.order.status})` : '-'}</td>
              <td class="td">${escapeHtml(tx.description || '-')}</td>
              <td class="td">${formatDateTime(tx.createdAt)}</td>
            </tr>
          `
        )
        .join('')
    );

    renderPagination('transactionsPagination', page, data.totalPages || 1, loadTransactions);
  } catch (error) {
    showError(`加载交易流水失败: ${error.message}`);
  }
}

async function loadDisputes(page = 1) {
  state.currentPage.disputes = page;

  const params = new URLSearchParams({ page: String(page), limit: '10' });
  const status = getInputValue('disputeReportStatus');
  const dateFrom = getInputValue('disputeDateFrom');
  const dateTo = getInputValue('disputeDateTo');

  if (status) params.set('status', status);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const data = await apiRequest(`/admin/disputes?${params.toString()}`);

    setText('disputesTotalCount', data.total || 0);

    const reportsHtml = (data.reports || [])
      .map(
        (report) => `
          <div class="card">
            <div class="flex justify-between items-start gap-3 mb-2">
              <div>
                <p class="font-semibold">举报 #${report.id} · ${report.targetType}#${report.targetId}</p>
                <p class="text-sm text-gray-700">${escapeHtml(report.reason || '-')}</p>
                <p class="text-sm text-gray-700">${escapeHtml(report.description || '-')}</p>
                <p class="text-xs text-gray-500">${formatDateTime(report.createdAt)}</p>
              </div>
              <div class="text-right">
                <span class="px-2 py-1 rounded text-xs ${
                  report.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                }">${report.status}</span>
                <div class="mt-1">${renderSlaBadge(report.slaStatus)}</div>
              </div>
            </div>
            <p class="text-xs text-gray-600 mb-2">负责人：${escapeHtml(report.assignment?.assigneeName || '未指派')}</p>
            ${renderReportEvidenceImages(report)}
            <div class="flex gap-2 flex-wrap">
              <button onclick="assignReport(${report.id})" class="btn-gray">指派</button>
              <button onclick="resolveReport(${report.id}, 'DELETE_CONTENT')" class="btn-red">删内容</button>
              <button onclick="resolveReport(${report.id}, 'BAN_USER')" class="btn-red">封禁</button>
              <button onclick="resolveReport(${report.id}, 'REJECT')" class="btn-gray">驳回</button>
            </div>
          </div>
        `
      )
      .join('');

    setHtml('disputesReportsList', reportsHtml || '<div class="card text-gray-500 text-center">暂无举报纠纷</div>');

    const ordersHtml = (data.canceledOrders || [])
      .map(
        (order) => {
          const actionsHtml = renderDisputeOrderActions(order);
          const issuesHtml = (order.feedbacks || []).map((issue) => `
            <div class="border rounded p-2 my-2">
              <p class="text-sm font-semibold">自取问题 #${Number(issue.id)} · ${issue.userId === order.buyerId ? '买家' : '卖家'} · ${escapeHtml(issue.status)}</p>
              <p class="text-sm whitespace-pre-wrap">${escapeHtml(issue.description || '')}</p>
              ${issue.adminReply ? `<p class="text-xs">处理回复：${escapeHtml(issue.adminReply)}</p>` : ''}
            </div>`).join('');
          return `
          <div class="card">
            <div class="flex justify-between items-start gap-3 mb-2">
              <div>
                <p class="font-semibold">订单 #${order.id} · ${order.status}</p>
                <p class="text-sm text-gray-700">商品：${escapeHtml(order.item?.title || '-')}</p>
                <p class="text-sm text-gray-700">买家：${escapeHtml(order.buyer?.nickname || '-')} · 卖家：${escapeHtml(
            order.seller?.nickname || '-'
          )}</p>
              </div>
              <div class="text-right">
                ${renderSlaBadge(order.slaStatus)}
                <p class="text-xs text-gray-500 mt-1">${formatDateTime(order.updatedAt)}</p>
              </div>
            </div>
            <p class="text-xs text-gray-600 mb-2">负责人：${escapeHtml(order.assignment?.assigneeName || '未指派')}</p>
            ${issuesHtml}
            <div class="flex gap-2 flex-wrap">
              <button onclick="assignDisputeOrder(${order.id})" class="btn-gray">指派</button>
              ${actionsHtml}
            </div>
          </div>
        `;
        }
      )
      .join('');

    setHtml('disputesOrdersList', ordersHtml || '<div class="card text-gray-500 text-center">暂无订单纠纷</div>');

    const refundsHtml = (data.refunds || [])
      .map(
        (tx) => `
          <div class="card">
            <p class="font-semibold">退款 #${tx.id} · ${formatMoney(tx.amount)}</p>
            <p class="text-sm text-gray-700">用户：${escapeHtml(tx.user?.nickname || '-')} (${escapeHtml(maskEmail(tx.user?.email || '-'))})</p>
            <p class="text-sm text-gray-700">订单：${tx.order ? `#${tx.order.id} (${tx.order.status})` : '-'}</p>
            <p class="text-xs text-gray-500">${formatDateTime(tx.createdAt)}</p>
          </div>
        `
      )
      .join('');

    setHtml('disputesRefundsList', refundsHtml || '<div class="card text-gray-500 text-center">暂无退款流水</div>');

    renderPagination('disputesPagination', page, data.totalPages || 1, loadDisputes);
  } catch (error) {
    const message = recoverableLoadMessage('订单纠纷', error);
    showError(message);
    renderRecoverableLoadError('disputesReportsList', message, () => loadDisputes(page));
    renderRecoverableLoadError('disputesOrdersList', message, () => loadDisputes(page));
    renderRecoverableLoadError('disputesRefundsList', message, () => loadDisputes(page));
  }
}

function renderDisputeOrderActions(order) {
  const actionDefinitions = {
    MARK_COMPLETED: { label: '核验后完成', className: 'btn-red' },
    CLOSE_CANCELED: { label: '取消结案（不执行退款）', className: 'btn-red' },
    KEEP_DISPUTED: { label: '保持争议', className: 'btn-gray' },
    KEEP_CANCELED: { label: '保持取消', className: 'btn-gray' },
  };
  const orderId = Number(order?.id);
  const allowedActions = Array.isArray(order?.allowedActions) ? order.allowedActions : [];

  if (!Number.isInteger(orderId) || orderId <= 0) return '';

  return allowedActions
    .filter((action) => Object.prototype.hasOwnProperty.call(actionDefinitions, action))
    .map((action) => {
      const definition = actionDefinitions[action];
      return `<button onclick="resolveDisputeOrder(${orderId}, '${action}')" class="${definition.className}">${definition.label}</button>`;
    })
    .join('');
}

async function assignDisputeOrder(orderId) {
  const assigneeRaw = (await promptText('输入要指派的管理员ID（留空=自己）：', '', {
    title: '指派纠纷订单',
    label: '管理员ID',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const priorityRaw = ((await promptText('输入优先级（LOW/MEDIUM/HIGH）', 'MEDIUM', {
    title: '指派纠纷订单',
    label: '优先级',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || 'MEDIUM').toUpperCase();
  const dueAtRaw = (await promptText('输入SLA截止时间（可选，例如 2026-05-01 18:00）：', '', {
    title: '指派纠纷订单',
    label: 'SLA 截止时间',
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const note = (await promptText('输入备注（可选）：', '', {
    title: '指派纠纷订单',
    label: '备注',
    multiline: true,
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';

  let dueAt;
  if (dueAtRaw.trim()) {
    const parsed = new Date(dueAtRaw.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) {
      showError('SLA时间格式无效');
      return;
    }
    dueAt = parsed.toISOString();
  }

  try {
    await apiRequest(`/admin/disputes/orders/${orderId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({
        assigneeAdminId: assigneeRaw ? Number(assigneeRaw) : undefined,
        priority: priorityRaw,
        dueAt,
        note,
      }),
    });

    await loadDisputes(state.currentPage.disputes);
  } catch (error) {
    showError(`指派失败: ${error.message}`);
  }
}

async function resolveDisputeOrder(orderId, action) {
  const actionLabel =
    action === 'MARK_COMPLETED'
      ? '核验后完成争议订单'
      : action === 'CLOSE_CANCELED'
        ? '取消结案（请填写给双方的处理说明；不执行退款，已声明付款的商品不会自动重新出售）'
      : action === 'KEEP_DISPUTED'
        ? '保持订单为争议中'
        : '保持订单为已取消';
  const reason = await promptReason(actionLabel, true);
  if (reason === null) return;
  if (action === 'CLOSE_CANCELED' && (reason.trim().length < 5 || reason.trim().length > 1000)) {
    showError('请填写 5–1000 个字的处理说明。');
    return;
  }
  if (!(await confirmCriticalAction(actionLabel, reason))) return;

  try {
    await apiRequest(`/admin/disputes/orders/${orderId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    });

    await loadDisputes(state.currentPage.disputes);
    await loadOrders(state.currentPage.orders);
  } catch (error) {
    showError(`处理失败: ${error.message}`);
  }
}

async function loadOfflineSection() {
  await Promise.all([loadFeatureFlags(), loadOfflineOverview(), loadMovingServices(1), loadStorageOrders(1), loadRecycleConsign()]);
}

async function loadOfflineOverview() {
  try {
    const data = await apiRequest('/admin/offline-services/overview');
    setText('offlineMovingCount', data.movingCount || 0);
    setText('offlineStorageCount', data.storageCount || 0);
    setText('offlineRecycleCount', data.recycleCount || 0);
    setText('offlineConsignmentCount', data.consignmentCount || 0);
  } catch (error) {
    showError(`加载线下服务总览失败: ${error.message}`);
  }
}

function formatMovingStatusLabel(rawStatus) {
  const status = String(rawStatus || '').toUpperCase();
  const labels = {
    WAITING_PLATFORM_DELIVERY_QUOTE: '待平台确认报价',
    DELIVERY_QUOTE_CONFIRMED: '待买家支付',
    BUYER_PAID_WAITING_DRIVER: '待分配配送员',
    DRIVER_ASSIGNED: '配送员已接单',
    PICKED_UP: '已取货',
    IN_TRANSIT: '配送中',
    DELIVERED_WAITING_BUYER_INSPECTION: '待买家验货',
    BUYER_CONFIRMED_RECEIPT: '买家已确认收货',
    COMPLETED: '交易完成',
    DISPUTED: '纠纷中',
    CANCELED: '已取消',
    CONFIRMED: '已确认',
    PENDING: '待处理',
  };
  return labels[status] || status;
}

function movingStatusBadgeClass(rawStatus) {
  const status = String(rawStatus || '').toUpperCase();
  if (status === 'COMPLETED' || status === 'BUYER_CONFIRMED_RECEIPT') return 'bg-green-100 text-green-700';
  if (status === 'DISPUTED') return 'bg-red-100 text-red-700';
  if (status === 'CANCELED') return 'bg-gray-100 text-gray-600';
  if (status === 'PICKED_UP' || status === 'IN_TRANSIT' || status === 'DRIVER_ASSIGNED') return 'bg-blue-100 text-blue-700';
  if (status === 'DELIVERY_QUOTE_CONFIRMED' || status === 'DELIVERED_WAITING_BUYER_INSPECTION') return 'bg-indigo-100 text-indigo-700';
  return 'bg-amber-100 text-amber-700';
}

function isPlatformMovingServiceRecord(service, meta) {
  const status = String(service?.status || '').toUpperCase();
  return (
    meta?.schema === 'platform_delivery_trade_v1' ||
    [
      'WAITING_PLATFORM_DELIVERY_QUOTE',
      'DELIVERY_QUOTE_CONFIRMED',
      'BUYER_PAID_WAITING_DRIVER',
      'DRIVER_ASSIGNED',
      'PICKED_UP',
      'IN_TRANSIT',
      'DELIVERED_WAITING_BUYER_INSPECTION',
      'BUYER_CONFIRMED_RECEIPT',
      'DISPUTED',
    ].includes(status)
  );
}

function isPlatformDeliveryManualHandlingState(service, meta) {
  return false;
}

function isPlatformDeliveryFrozenState(service, meta) {
  if (!isPlatformMovingServiceRecord(service, meta) || state.featureFlags.platformDeliveryEnabled) return false;
  return true;
}

function deliveryPayerLabel(payer) {
  const normalized = String(payer || '').toUpperCase();
  if (normalized === 'SELLER') return '卖家';
  if (normalized === 'SHARED') return '双方';
  return '买家';
}

function deliveryPayerResponsibilityText(payer) {
  const normalized = String(payer || '').toUpperCase();
  if (normalized === 'SELLER') return '卖家承担配送费';
  if (normalized === 'SHARED') return '双方分摊配送费';
  return '买家承担配送费';
}

function formatOptionalMoney(value, fallback = '待确认') {
  if (value === null || value === undefined || value === '') return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return formatMoney(amount);
}

function movingStatusActionLabel(status) {
  const map = {
    CONFIRMED: '确认服务',
    IN_PROGRESS: '开始服务',
    COMPLETED: '完成服务',
    CANCELED: '取消服务',
    DELIVERY_QUOTE_CONFIRMED: '确认配送报价',
    DRIVER_ASSIGNED: '分配配送员',
    PICKED_UP: '标记已取货',
    IN_TRANSIT: '标记配送中',
    DELIVERED_WAITING_BUYER_INSPECTION: '标记已送达（待买家验货）',
    BUYER_CONFIRMED_RECEIPT: '买家已确认收货',
  };
  return map[String(status || '').toUpperCase()] || String(status || '').toUpperCase();
}

function getMovingWorkflowSteps(isPlatform) {
  if (!isPlatform) return ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
  return [
    'WAITING_PLATFORM_DELIVERY_QUOTE',
    'DELIVERY_QUOTE_CONFIRMED',
    'BUYER_PAID_WAITING_DRIVER',
    'DRIVER_ASSIGNED',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED_WAITING_BUYER_INSPECTION',
    'BUYER_CONFIRMED_RECEIPT',
    'COMPLETED',
  ];
}

function getMovingNextActions(service, meta) {
  // Moving, delivery, and storage products are not writable V1 workflows.
  // Their historical records remain visible, but only a future approved,
  // dedicated workflow may re-enable state transitions.
  return [];
}

function renderMovingWorkflowTimeline(currentStatus, isPlatform) {
  const steps = getMovingWorkflowSteps(isPlatform);
  const normalizedCurrent = String(currentStatus || '').toUpperCase();
  const currentIndex = steps.indexOf(normalizedCurrent);

  return steps
    .map((step, index) => {
      const isCurrent = step === normalizedCurrent;
      const isDone = currentIndex >= 0 && index < currentIndex;
      const styleClass = isCurrent
        ? 'bg-red-100 border-red-300 text-red-700'
        : isDone
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-gray-50 border-gray-200 text-gray-500';
      return `<span class="inline-flex items-center px-2 py-1 rounded border text-xs ${styleClass}">${index + 1}. ${escapeHtml(
        formatMovingStatusLabel(step)
      )}</span>`;
    })
    .join('');
}

function setMovingWorkflowMessage(type, message) {
  const box = document.getElementById('movingWorkflowMessage');
  if (!box) return;
  const text = String(message || '').trim();
  if (!text) {
    box.className = 'hidden';
    box.textContent = '';
    return;
  }
  if (type === 'success') {
    box.className = 'mt-3 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm';
  } else if (type === 'error') {
    box.className = 'mt-3 rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm';
  } else {
    box.className = 'mt-3 rounded border border-sky-300 bg-sky-50 text-sky-700 px-3 py-2 text-sm';
  }
  box.textContent = text;
}

function setFieldVisible(id, visible) {
  const field = document.getElementById(id);
  if (!field) return;
  if (visible) field.classList.remove('hidden');
  else field.classList.add('hidden');
}

function applyMovingWorkflowFieldVisibility(status) {
  const normalized = String(status || '').toUpperCase();
  const showMoverFields = ['CONFIRMED', 'DELIVERY_QUOTE_CONFIRMED', 'DRIVER_ASSIGNED'].includes(normalized);
  const showQuote = ['CONFIRMED', 'DELIVERY_QUOTE_CONFIRMED'].includes(normalized);
  const showSchedule = normalized === 'CONFIRMED';
  const showEstimate = ['DELIVERY_QUOTE_CONFIRMED', 'DRIVER_ASSIGNED'].includes(normalized);
  const showPickupPhotos = normalized === 'PICKED_UP';
  const showDeliveryPhotos = normalized === 'DELIVERED_WAITING_BUYER_INSPECTION';

  setFieldVisible('movingWorkflowMoverNameRow', showMoverFields);
  setFieldVisible('movingWorkflowMoverPhoneRow', showMoverFields);
  setFieldVisible('movingWorkflowQuoteRow', showQuote);
  setFieldVisible('movingWorkflowMovingDateRow', showSchedule);
  setFieldVisible('movingWorkflowMovingTimeRow', showSchedule);
  setFieldVisible('movingWorkflowEstimatedPickupAtRow', showEstimate);
  setFieldVisible('movingWorkflowEstimatedDeliveryAtRow', showEstimate);
  setFieldVisible('movingWorkflowPickupPhotosRow', showPickupPhotos);
  setFieldVisible('movingWorkflowDeliveryPhotosRow', showDeliveryPhotos);

  const hint = document.getElementById('movingWorkflowHint');
  if (hint) {
    hint.textContent = normalized ? `将执行：${movingStatusActionLabel(normalized)}。` : '请选择服务和动作后提交。';
  }
}

function clearMovingWorkflowInputs() {
  [
    'movingWorkflowReason',
    'movingWorkflowMoverName',
    'movingWorkflowMoverPhone',
    'movingWorkflowMovingDate',
    'movingWorkflowMovingTime',
    'movingWorkflowQuote',
    'movingWorkflowEstimatedPickupAt',
    'movingWorkflowEstimatedDeliveryAt',
    'movingWorkflowPickupPhotos',
    'movingWorkflowDeliveryPhotos',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const pickupUpload = document.getElementById('movingWorkflowPickupUploadFiles');
  if (pickupUpload) pickupUpload.value = '';
  MOVING_WORKFLOW_TIME_WHEEL_IDS.forEach((fieldId) => clearTimeWheel(fieldId));
}

function resetMovingWorkflowPanel() {
  state.selectedMovingServiceId = null;
  state.movingWorkflowDefaultQuote = 0;
  clearMovingWorkflowInputs();
  setMovingWorkflowMessage('info', '');
  renderMovingWorkflowPanel();
}

function renderMovingWorkflowPanel(preferredStatus = '') {
  const summary = document.getElementById('movingWorkflowSummary');
  const timeline = document.getElementById('movingWorkflowTimeline');
  const statusSelect = document.getElementById('movingWorkflowTargetStatus');
  const submitBtn = document.getElementById('movingWorkflowSubmitBtn');
  const serviceIdText = document.getElementById('movingWorkflowServiceId');
  const currentStatusText = document.getElementById('movingWorkflowCurrentStatus');
  if (!summary || !timeline || !statusSelect || !submitBtn || !serviceIdText || !currentStatusText) return;

  const selectedId = Number(state.selectedMovingServiceId || 0);
  const service = selectedId ? state.movingServicesById.get(selectedId) : null;

  if (!service) {
    summary.innerHTML = '<p class="text-gray-500 text-sm">请先在下方列表点击“进入流程”。</p>';
    timeline.innerHTML = '<p class="text-xs text-gray-400">未选择服务</p>';
    statusSelect.innerHTML = '<option value="">请选择服务后可操作</option>';
    statusSelect.disabled = true;
    submitBtn.disabled = true;
    serviceIdText.textContent = '-';
    currentStatusText.textContent = '-';
    applyMovingWorkflowFieldVisibility('');
    return;
  }

  const meta = parseJsonNotes(service.notes);
  const quoteInfo = meta?.quoteInfo && typeof meta.quoteInfo === 'object' ? meta.quoteInfo : null;
  const isPlatform = isPlatformMovingServiceRecord(service, meta);
  const actions = getMovingNextActions(service, meta);
  const currentStatus = String(service.status || '').toUpperCase();
  const workflowReadOnlyNotice =
    '<p class="md:col-span-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">当前 V1 不提供搬运、配送或仓储状态推进；此记录仅可查看。平台配送保持关闭，任何未来重开都必须使用经批准的专用流程。</p>';

  summary.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
      <div>
        <p class="font-semibold">服务 #${service.id} · ${escapeHtml(service.user?.nickname || '未知用户')}</p>
        <p class="text-gray-700 mt-1">${escapeHtml(service.fromAddress || '-')} → ${escapeHtml(service.toAddress || '-')}</p>
      </div>
      <div>
        <p class="text-gray-700">联系人：${escapeHtml(service.contactName || '-')} · ${escapeHtml(maskPhone(service.contactPhone || '-'))}</p>
        <p class="text-gray-500 mt-1">配送费：${formatMoney(meta?.deliveryFee || service.estimatedCost || 0)}</p>
        <p class="text-gray-500 mt-1">付款责任：${deliveryPayerResponsibilityText(meta?.deliveryFeePayer)}</p>
        <p class="text-gray-500 mt-1">买家应付：${formatOptionalMoney(meta?.buyerPayableTotal)}</p>
        <p class="text-gray-500 mt-1">卖家结算：${formatOptionalMoney(meta?.sellerSettlementAmount)}</p>
        ${quoteInfo ? `<p class="text-gray-500 mt-1">路线：${escapeHtml(formatRouteQuoteSummary(quoteInfo))}</p>` : ''}
        ${quoteInfo ? `<p class="text-gray-500 mt-1">费用拆分：${escapeHtml(formatRouteQuoteBreakdown(quoteInfo))}</p>` : ''}
        ${quoteInfo ? `<p class="text-gray-500 mt-1">距离/时长：${escapeHtml(formatRouteDistanceKm(quoteInfo.distanceKm))} · ${escapeHtml(formatRouteDurationMinutes(quoteInfo.durationMinutes))}</p>` : ''}
      </div>
      ${workflowReadOnlyNotice}
    </div>
  `;
  timeline.innerHTML = renderMovingWorkflowTimeline(currentStatus, isPlatform);
  serviceIdText.textContent = String(service.id);
  currentStatusText.textContent = formatMovingStatusLabel(currentStatus);

  if (!actions.length) {
    statusSelect.innerHTML = '<option value="">当前状态无需后台推进</option>';
    statusSelect.disabled = true;
    submitBtn.disabled = true;
    applyMovingWorkflowFieldVisibility('');
    const hint = document.getElementById('movingWorkflowHint');
    if (hint) hint.textContent = '当前 V1 中服务记录只读；不能通过后台修改状态。';
    return;
  }

  statusSelect.innerHTML = actions.map((next) => `<option value="${next}">${movingStatusActionLabel(next)}</option>`).join('');
  statusSelect.disabled = false;
  submitBtn.disabled = false;

  const normalizedPreferred = String(preferredStatus || '').toUpperCase();
  statusSelect.value = actions.includes(normalizedPreferred) ? normalizedPreferred : actions[0];

  const quoteInput = document.getElementById('movingWorkflowQuote');
  if (quoteInput && !quoteInput.value && Number(state.movingWorkflowDefaultQuote || 0) > 0) {
    quoteInput.value = String(state.movingWorkflowDefaultQuote);
  }

  setTimeWheelValue('movingWorkflowEstimatedPickupAt', quoteInfo?.estimatedPickupAt || '');
  setTimeWheelValue('movingWorkflowEstimatedDeliveryAt', quoteInfo?.estimatedDeliveryAt || '');
  if (!quoteInfo?.estimatedPickupAt) {
    seedTimeWheelDate('movingWorkflowEstimatedPickupAt', service.movingDate);
  }
  if (!quoteInfo?.estimatedDeliveryAt) {
    seedTimeWheelDate('movingWorkflowEstimatedDeliveryAt', service.movingDate);
  }

  applyMovingWorkflowFieldVisibility(statusSelect.value);
}

function handleMovingWorkflowStatusChange() {
  applyMovingWorkflowFieldVisibility(getInputValue('movingWorkflowTargetStatus'));
}

function openMovingWorkflow(serviceId, preferredStatus = '', defaultQuote = 0) {
  const id = Number(serviceId);
  if (!id || !state.movingServicesById.has(id)) {
    setMovingWorkflowMessage('error', '当前页未找到该服务，请先刷新列表。');
    return;
  }
  state.selectedMovingServiceId = id;
  state.movingWorkflowDefaultQuote = Number(defaultQuote || 0);
  clearMovingWorkflowInputs();
  const service = state.movingServicesById.get(id);
  renderMovingWorkflowPanel(preferredStatus);
  setMovingWorkflowMessage('info', `已打开服务 #${id} 的只读记录。`);
  document.getElementById('movingWorkflowPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submitMovingWorkflow() {
  setMovingWorkflowMessage('info', '当前 V1 中搬运/配送记录为只读，不能提交状态修改。');
}

function renderMovingActionButtons(service, meta) {
  const frozenLegacy = isPlatformDeliveryFrozenState(service, meta);
  return frozenLegacy
    ? '<span class="text-xs text-amber-700">平台配送已移出当前 V1；历史记录仅可查看。</span>'
    : '<span class="text-xs text-gray-500">当前 V1 对搬运/配送记录仅提供只读查看。</span>';
}

function parsePhotoUrlInput(rawText) {
  return String(rawText || '')
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function toLocalDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMovingScheduleGroupLabel(dateKey) {
  if (!dateKey) return '未设置预约日期';
  const dayDate = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(dayDate.getTime())) return dateKey;
  const weekday = dayDate.toLocaleDateString('zh-CN', { weekday: 'short' });
  return `${dateKey}（${weekday}）`;
}

function parseMovingTimeToMinutes(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return Number.POSITIVE_INFINITY;

  const timeMatch = text.match(/(\d{1,2})(?:[:：](\d{1,2}))?/);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || '0');
    const isPm = /pm|下午|晚/i.test(text);
    const isAm = /am|上午|早/i.test(text);

    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return hour * 60 + minute;
    }
  }

  if (/上午|morning/i.test(text)) return 9 * 60;
  if (/中午|noon/i.test(text)) return 12 * 60;
  if (/下午|afternoon/i.test(text)) return 15 * 60;
  if (/晚上|evening|night/i.test(text)) return 19 * 60;
  return Number.POSITIVE_INFINITY;
}

function sortMovingServicesForDisplay(services, sortBy) {
  const list = Array.isArray(services) ? [...services] : [];
  const mode = String(sortBy || 'appointment_asc');
  const compareCreated = (a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime() || 0;
    const bTime = new Date(b.createdAt || 0).getTime() || 0;
    return aTime - bTime;
  };

  if (mode === 'created_asc') {
    return list.sort((a, b) => compareCreated(a, b));
  }
  if (mode === 'created_desc') {
    return list.sort((a, b) => compareCreated(b, a));
  }

  const desc = mode === 'appointment_desc';
  return list.sort((a, b) => {
    const aKey = toLocalDateKey(a.movingDate);
    const bKey = toLocalDateKey(b.movingDate);
    const aHasDate = Boolean(aKey);
    const bHasDate = Boolean(bKey);

    if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
    if (aKey !== bKey) {
      if (!aKey || !bKey) return aKey ? -1 : 1;
      return desc ? bKey.localeCompare(aKey) : aKey.localeCompare(bKey);
    }

    const aMinute = parseMovingTimeToMinutes(a.movingTime);
    const bMinute = parseMovingTimeToMinutes(b.movingTime);
    if (aMinute !== bMinute) return desc ? bMinute - aMinute : aMinute - bMinute;

    return compareCreated(b, a);
  });
}

function renderMovingServiceCard(svc) {
  const isActiveService = Number(state.selectedMovingServiceId || 0) === Number(svc.id);
  const meta = parseJsonNotes(svc.notes);
  const isPlatform = isPlatformMovingServiceRecord(svc, meta);
  const frozenLegacy = isPlatformDeliveryFrozenState(svc, meta);
  const quoteInfo = meta?.quoteInfo && typeof meta.quoteInfo === 'object' ? meta.quoteInfo : null;
  const deliveryFeeText = meta ? formatMoney(meta.deliveryFee || 0) : 'A$0.00';
  const statusLabel = formatMovingStatusLabel(svc.status);
  const actionButtonsHtml = renderMovingActionButtons(svc, meta);
  const badges = [
    isPlatform ? '<span class="px-2 py-1 rounded text-xs bg-sky-100 text-sky-700">平台配送存量单</span>' : '',
    frozenLegacy ? '<span class="px-2 py-1 rounded text-xs bg-amber-100 text-amber-700">历史只读</span>' : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div class="card ${isActiveService ? 'ring-2 ring-red-200 border border-red-300' : ''}">
      <div class="flex justify-between items-start mb-2">
        <div class="flex items-start gap-2">
          <div>
            <p class="font-semibold">服务 #${svc.id} · ${escapeHtml(svc.user?.nickname || '未知用户')}</p>
            <p class="text-sm text-gray-700">${escapeHtml(svc.fromAddress)} → ${escapeHtml(svc.toAddress)}</p>
            <p class="text-sm text-gray-700">预约：${formatDate(svc.movingDate)} ${escapeHtml(svc.movingTime || '-')}</p>
            <p class="text-xs text-gray-500">配送费：${deliveryFeeText}</p>
            <p class="text-xs text-gray-500">付款责任：${escapeHtml(deliveryPayerResponsibilityText(meta?.deliveryFeePayer))}</p>
            <p class="text-xs text-gray-500">买家应付：${escapeHtml(formatOptionalMoney(meta?.buyerPayableTotal))}</p>
            <p class="text-xs text-gray-500">卖家结算：${escapeHtml(formatOptionalMoney(meta?.sellerSettlementAmount))}</p>
            ${quoteInfo ? `<p class="text-xs text-gray-500">路线：${escapeHtml(formatRouteQuoteSummary(quoteInfo))}</p>` : ''}
            ${quoteInfo ? `<p class="text-xs text-gray-500">费用拆分：${escapeHtml(formatRouteQuoteBreakdown(quoteInfo))}</p>` : ''}
            ${quoteInfo ? `<p class="text-xs text-gray-500">距离/时长：${escapeHtml(formatRouteDistanceKm(quoteInfo.distanceKm))} · ${escapeHtml(formatRouteDurationMinutes(quoteInfo.durationMinutes))}</p>` : ''}
            ${badges ? `<div class="mt-2 flex flex-wrap gap-2">${badges}</div>` : ''}
          </div>
        </div>
        <span class="px-2 py-1 rounded text-xs ${movingStatusBadgeClass(svc.status)}">${escapeHtml(statusLabel)}</span>
      </div>
      <p class="text-sm text-gray-700 mb-3">费用：${formatMoney(svc.estimatedCost)} · 联系人：${escapeHtml(svc.contactName)} ${escapeHtml(maskPhone(svc.contactPhone || '-'))}</p>
      <div class="flex gap-2 flex-wrap">
        <button onclick="openMovingWorkflow(${svc.id})" class="btn-dark">查看记录</button>
        ${privateInspectionProofs(svc).map((_, index) => `<button onclick="openPrivateInspectionProof(${Number(svc.id)}, ${index})" class="btn-dark">查看验收凭证 ${index + 1}</button>`).join('')}
        ${actionButtonsHtml}
      </div>
    </div>
  `;
}

let privateProofPreview = { generation: 0, url: null, controller: null };
function trustedPrivateProofUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (url.origin !== new URL(API_BASE_URL).origin || url.username || url.password || url.search || url.hash
      || !/^\/private-proofs\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function privateInspectionProofs(service) {
  const notes = parseJsonNotes(service?.notes);
  const values = notes?.inspectionProof?.photoUrls;
  return Array.isArray(values) ? values.map(trustedPrivateProofUrl).filter(Boolean).slice(0, 2) : [];
}

function clearPrivateProofPreview() {
  privateProofPreview.generation++;
  privateProofPreview.controller?.abort();
  privateProofPreview.controller = null;
  if (privateProofPreview.url) URL.revokeObjectURL(privateProofPreview.url);
  privateProofPreview.url = null;
  const image = document.getElementById('privateProofImage');
  if (image) image.removeAttribute('src');
}

async function openPrivateInspectionProof(serviceId, index) {
  const url = privateInspectionProofs(state.movingServicesById.get(Number(serviceId)))[index];
  await openAuthorizedPrivateImage(url, '验收凭证');
}

async function openAuthorizedPrivateImage(url, title) {
  if ((!trustedPrivateProofUrl(url) && !trustedReportEvidenceUrl(url)) || !authToken || !adminUser) { showError('凭证暂时无法查看，请重新登录后重试。'); return; }
  openDetailDrawer(title, '<p id="privateProofStatus">正在核验访问权限…</p><img id="privateProofImage" alt="私密附件" class="max-w-full rounded" />');
  const token = authToken, generation = privateProofPreview.generation;
  const controller = new AbortController(); privateProofPreview.controller = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' },
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (response.status !== 200 || !['image/jpeg','image/png'].includes(response.headers.get('content-type')?.split(';')[0])) throw new Error();
    const maxBytes = 12 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error();
    let blob;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let count = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          count += value.byteLength;
          if (controller.signal.aborted || count > maxBytes) throw new Error();
          chunks.push(value);
        }
        blob = new Blob(chunks, { type: response.headers.get('content-type').split(';')[0] });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } else { blob = await response.blob(); }
    if (!blob.size || blob.size > maxBytes) throw new Error();
    if (controller.signal.aborted || generation !== privateProofPreview.generation || authToken !== token || !adminUser) return;
    privateProofPreview.url = URL.createObjectURL(blob);
    document.getElementById('privateProofImage')?.setAttribute('src', privateProofPreview.url);
    setText('privateProofStatus', '');
  } catch {
    if (generation === privateProofPreview.generation) setText('privateProofStatus', '凭证暂时无法查看，可能是登录或访问权限已变化。');
  } finally { clearTimeout(timeout); }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && privateProofPreview.controller) closeDetailDrawer();
});

function renderMovingServicesWithGrouping(services) {
  const groupBy = document.getElementById('movingGroupByScheduleDate')?.checked !== false;
  if (!groupBy) {
    return services.map((svc) => renderMovingServiceCard(svc)).join('');
  }

  const groups = [];
  const groupedMap = new Map();
  services.forEach((svc) => {
    const key = toLocalDateKey(svc.movingDate) || '__UNSCHEDULED__';
    if (!groupedMap.has(key)) {
      groupedMap.set(key, []);
      groups.push(key);
    }
    groupedMap.get(key).push(svc);
  });

  return groups
    .map((key) => {
      const entries = groupedMap.get(key) || [];
      const label = key === '__UNSCHEDULED__' ? '未设置预约日期' : formatMovingScheduleGroupLabel(key);
      return `
        <div class="mb-3">
          <div class="px-3 py-2 rounded border bg-gray-50 text-sm font-semibold text-gray-700">${escapeHtml(label)} · ${entries.length} 单</div>
          <div class="space-y-3 mt-2">
            ${entries.map((svc) => renderMovingServiceCard(svc)).join('')}
          </div>
        </div>
      `;
    })
    .join('');
}

function setMovingScheduleDateToday() {
  const input = document.getElementById('movingScheduleDate');
  if (!input) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  input.value = `${year}-${month}-${day}`;
  loadMovingServices(1);
}

function clearMovingScheduleDateFilter() {
  const input = document.getElementById('movingScheduleDate');
  if (input) input.value = '';
  loadMovingServices(1);
}

async function loadMovingServices(page = 1) {
  state.currentPage.moving = page;

  const params = new URLSearchParams({ page: String(page), limit: '10' });
  const status = getInputValue('movingStatus');
  const keyword = getInputValue('movingKeyword');
  const dateFrom = getInputValue('movingDateFrom');
  const dateTo = getInputValue('movingDateTo');
  const sortBy = getInputValue('movingSortBy') || 'appointment_asc';
  const scheduleDate = getInputValue('movingScheduleDate');

  if (status) params.set('status', status);
  if (keyword) params.set('keyword', keyword);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (sortBy) params.set('sortBy', sortBy);
  if (scheduleDate) params.set('scheduleDate', scheduleDate);

  try {
    const data = await apiRequest(`/admin/offline-services/moving?${params.toString()}`);
    const services = sortMovingServicesForDisplay(data.services || [], sortBy);
    setText('movingTotalCount', data.total || 0);
    state.movingServicesById = new Map(services.map((svc) => [Number(svc.id), svc]));

    if (!services.length) {
      setHtml('movingServicesList', '<div class="card text-center text-gray-500">暂无配送/搬运记录</div>');
      renderPagination('movingPagination', 1, 1, () => {});
      state.selectedMovingServiceId = null;
      renderMovingWorkflowPanel();
      updateSelectionCount();
      return;
    }

    setHtml(
      'movingServicesList',
      renderMovingServicesWithGrouping(services)
    );

    renderPagination('movingPagination', page, data.totalPages || 1, loadMovingServices);
    if (!state.movingServicesById.has(Number(state.selectedMovingServiceId || 0))) {
      state.selectedMovingServiceId = null;
    }
    renderMovingWorkflowPanel();
    updateSelectionCount();
  } catch (error) {
    showError(`加载搬运服务失败: ${error.message}`);
  }
}

function toggleMovingSelection(serviceId, checked) {
  if (checked) state.selectedMovingIds.add(serviceId);
  else state.selectedMovingIds.delete(serviceId);
  updateSelectionCount();
}

function toggleSelectAllMoving(checked) {
  document.querySelectorAll('.moving-checkbox').forEach((checkbox) => {
    checkbox.checked = checked;
    const card = checkbox.closest('.card');
    const title = card?.querySelector('p.font-semibold')?.textContent || '';
    const idMatch = title.match(/服务 #(\d+)/);
    if (!idMatch) return;
    const id = Number(idMatch[1]);
    if (checked) state.selectedMovingIds.add(id);
    else state.selectedMovingIds.delete(id);
  });
  updateSelectionCount();
}

function batchUpdateMovingStatus() {
  setMovingWorkflowMessage('info', '当前 V1 中搬运/配送记录为只读，不能批量修改状态。');
}

function updateMovingStatus() {
  setMovingWorkflowMessage('info', '当前 V1 中搬运/配送记录为只读，不能修改状态。');
}

async function loadStorageOrders(page = 1) {
  state.currentPage.storage = page;

  const params = new URLSearchParams({ page: String(page), limit: '10' });
  const status = getInputValue('storageStatus');
  const dateFrom = getInputValue('storageDateFrom');
  const dateTo = getInputValue('storageDateTo');

  if (status) params.set('status', status);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const data = await apiRequest(`/admin/offline-services/storage?${params.toString()}`);
    setText('storageTotalCount', data.total || 0);

    if (!data.orders?.length) {
      setHtml('storageOrdersList', '<div class="card text-center text-gray-500">暂无仓储订单</div>');
      renderPagination('storagePagination', 1, 1, () => {});
      updateSelectionCount();
      return;
    }

    setHtml(
      'storageOrdersList',
      data.orders
        .map((order) => {
          return `
            <div class="card">
              <div class="flex justify-between items-start mb-2">
                <div class="flex items-start gap-2">
                  <div>
                    <p class="font-semibold">仓储单 #${order.id} · ${escapeHtml(order.user?.nickname || '未知用户')}</p>
                    <p class="text-sm text-gray-700">仓库：${escapeHtml(order.storageLocation || '-')}</p>
                    <p class="text-sm text-gray-700">开始：${formatDate(order.storageStartDate)} · 费用：${formatMoney(order.monthlyFee)}</p>
                  </div>
                </div>
                <span class="px-2 py-1 rounded text-xs ${
                  order.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-700'
                    : order.status === 'COMPLETED'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-amber-100 text-amber-700'
                }">${order.status}</span>
              </div>
              <div class="flex gap-2 flex-wrap">
                ${renderStorageActionButtons(order)}
              </div>
            </div>
          `;
        })
        .join('')
    );

    renderPagination('storagePagination', page, data.totalPages || 1, loadStorageOrders);
    updateSelectionCount();
  } catch (error) {
    showError(`加载仓储订单失败: ${error.message}`);
  }
}

function toggleStorageSelection(orderId, checked) {
  if (checked) state.selectedStorageIds.add(orderId);
  else state.selectedStorageIds.delete(orderId);
  updateSelectionCount();
}

function toggleSelectAllStorage(checked) {
  document.querySelectorAll('.storage-checkbox').forEach((checkbox) => {
    checkbox.checked = checked;
    const card = checkbox.closest('.card');
    const title = card?.querySelector('p.font-semibold')?.textContent || '';
    const idMatch = title.match(/仓储单 #(\d+)/);
    if (!idMatch) return;
    const id = Number(idMatch[1]);
    if (checked) state.selectedStorageIds.add(id);
    else state.selectedStorageIds.delete(id);
  });
  updateSelectionCount();
}

function batchUpdateStorageStatus() {
  showError('当前 V1 中仓储记录为只读，不能批量修改状态。');
}

function updateStorageStatus() {
  showError('当前 V1 中仓储记录为只读，不能修改状态。');
}

async function loadRecycleConsign() {
  try {
    const data = await apiRequest('/admin/offline-services/recycle-consign');

    const recycleHtml = (data.recycleItems || [])
      .map(
        (item) => `
          <div class="card">
            <p class="font-semibold">#${item.id} · ${escapeHtml(item.title)}</p>
            <p class="text-sm text-gray-700">卖家：${escapeHtml(item.seller?.nickname || '-')} · 状态：${item.status}</p>
            <div class="flex gap-2 mt-2">
              <button onclick="updateRecycleConsignItem(${item.id}, 'MARK_RECYCLED')" class="btn-gray">标记回收</button>
              <button onclick="updateRecycleConsignItem(${item.id}, 'MARK_CONSIGNED')" class="btn-red">标记寄卖</button>
            </div>
          </div>
        `
      )
      .join('');

    setHtml('recycleItemsList', recycleHtml || '<div class="card text-center text-gray-500">暂无回收候选商品</div>');

    const consignmentOrderHtml = (data.consignmentOrders || [])
      .map(
        (order) => `
          <div class="card">
            <p class="font-semibold">仓储单 #${order.id}</p>
            <p class="text-sm text-gray-700">用户：${escapeHtml(order.user?.nickname || '-')} (${escapeHtml(maskEmail(order.user?.email || '-'))})</p>
          </div>
        `
      )
      .join('');

    setHtml('consignmentOrdersList', consignmentOrderHtml || '<div class="card text-center text-gray-500">暂无寄卖授权订单</div>');

    const consignedItemsHtml = (data.consignedItems || [])
      .map(
        (item) => `
          <div class="card">
            <p class="font-semibold">#${item.id} · ${escapeHtml(item.title)}</p>
            <p class="text-sm text-gray-700">来源仓储单：${item.sourceStorageOrderId || '-'}</p>
            <p class="text-sm text-gray-700">状态：${item.status}</p>
          </div>
        `
      )
      .join('');

    setHtml('consignedItemsList', consignedItemsHtml || '<div class="card text-center text-gray-500">暂无寄卖商品</div>');
  } catch (error) {
    showError(`加载回收/寄卖失败: ${error.message}`);
  }
}

async function updateRecycleConsignItem(itemId, action) {
  const reason = (await promptReason(`执行 ${action}（可选备注）`, false)) ?? '';
  if (!(await confirmCriticalAction(`执行 ${action}`, reason))) return;

  try {
    await apiRequest(`/admin/offline-services/recycle-consign/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    });

    await loadRecycleConsign();
    if (state.currentSection === 'items') {
      await loadItems(state.currentPage.items);
    }
  } catch (error) {
    showError(`操作失败: ${error.message}`);
  }
}

async function loadLogs(page = 1) {
  state.currentPage.logs = page;

  const params = new URLSearchParams({ page: String(page), limit: '20' });
  const action = getInputValue('logAction');
  const targetType = getInputValue('logTargetType');
  const adminId = getInputValue('logAdminId');
  const keyword = getInputValue('logKeyword');
  const dateFrom = getInputValue('logDateFrom');
  const dateTo = getInputValue('logDateTo');

  if (action) params.set('action', action);
  if (targetType) params.set('targetType', targetType);
  if (adminId) params.set('adminId', adminId);
  if (keyword) params.set('keyword', keyword);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const data = await apiRequest(`/admin/logs?${params.toString()}`);
    setText('logsTotalCount', data.total || 0);

    if (!data.logs?.length) {
      setHtml('logsList', '<tr><td colspan="5" class="td text-center text-gray-500">暂无日志</td></tr>');
      renderPagination('logsPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'logsList',
      data.logs
        .map((log) => {
          const detailText = log.details ? renderLogDetailsSummary(log.details) : '<span class="text-gray-400">-</span>';
          return `
            <tr>
              <td class="td">${formatDateTime(log.createdAt)}</td>
              <td class="td">${escapeHtml(log.admin?.nickname || '-')}<br /><span class="text-xs text-gray-500">${escapeHtml(maskEmail(log.admin?.email || '-'))}</span></td>
              <td class="td">${escapeHtml(log.action)}</td>
              <td class="td">${escapeHtml(log.targetType || '-')} ${log.targetId ? `#${log.targetId}` : ''}</td>
              <td class="td text-xs break-all">${detailText}</td>
            </tr>
          `;
        })
        .join('')
    );

    renderPagination('logsPagination', page, data.totalPages || data.pagination?.totalPages || 1, loadLogs);
  } catch (error) {
    showError(`加载日志失败: ${error.message}`);
  }
}

async function loadCommercializationSection() {
  await loadFeatureFlags();
  await Promise.all([
    loadCommercializationOverview(),
    loadPinOrders(1),
    loadMemberships(1),
    loadRewardRecords(1),
  ]);
}

async function loadCommercializationOverview() {
  try {
    const data = await apiRequest('/admin/commercialization/overview');
    setText('bizPinnedItems', data.pinnedItems || 0);
    setText('bizPinRevenue', formatMoney(data.pinRevenue || 0));
    setText('bizMembershipRevenue', formatMoney(data.membershipRevenue || 0));
    setText('bizActiveMembers', data.activeMembershipUsers || 0);
    setText('bizPendingOrders', data.pendingFeatureOrders || 0);
    setText('bizRewardsCount', data.rewardsCount || 0);
  } catch (error) {
    showError(`加载商业化总览失败: ${error.message}`);
  }
}

async function loadPinOrders(page = 1) {
  state.currentPage.pinOrders = page;

  const params = new URLSearchParams({ page: String(page), limit: '8' });
  const search = getInputValue('pinOrderSearch');
  const status = getInputValue('pinOrderStatus');
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  try {
    const data = await apiRequest(`/admin/commercialization/pin-orders?${params.toString()}`);
    setText('pinOrdersTotalCount', data.total || 0);

    if (!data.items?.length) {
      setHtml('pinOrdersList', '<div class="text-gray-500 text-sm">暂无置顶订单</div>');
      renderPagination('pinOrdersPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'pinOrdersList',
      data.items
        .map((order) => {
          const statusType = order.status === 'PAID' ? 'success' : order.status === 'PENDING' ? 'warning' : 'default';
          return `
            <div class="border rounded p-3">
              <div class="flex justify-between items-start gap-2 mb-1">
                <p class="font-semibold">#${order.id} · ${escapeHtml(order.packageName || order.packageCode)}</p>
                ${formatStatusBadge(order.status, statusType)}
              </div>
              <p class="text-xs text-gray-600">用户：${escapeHtml(order.user?.nickname || maskEmail(order.user?.email) || `#${order.user?.id || '-'}`)}</p>
              <p class="text-xs text-gray-600">商品：${escapeHtml(order.item?.title || `#${order.item?.id || '-'}`)}</p>
              <p class="text-xs text-gray-600">金额：${formatMoney(order.amount)} · 时长：${order.durationHours || 0}h</p>
              <p class="text-xs text-gray-600">创建：${formatDateTime(order.createdAt)} · 到期：${formatDateTime(order.expectedExpiresAt)}</p>
              <div class="flex gap-2 mt-2 flex-wrap">
                ${paymentsAreEnabled() ? `
                <button type="button" aria-label="确认置顶订单 ${order.id} 支付" onclick="updatePinOrder(${order.id}, 'CONFIRM')" class="action-btn action-btn-green">确认支付</button>
                <button type="button" aria-label="将置顶订单 ${order.id} 标记失败" onclick="updatePinOrder(${order.id}, 'FAIL')" class="action-btn action-btn-red">标记失败</button>
                ` : '<span class="text-xs text-gray-500">历史支付记录只读</span>'}
                <button type="button" aria-label="取消置顶订单 ${order.id}" onclick="updatePinOrder(${order.id}, 'CANCEL_PIN')" class="action-btn action-btn-red">取消置顶</button>
                <button type="button" aria-label="将置顶订单 ${order.id} 延长 24 小时" onclick="updatePinOrder(${order.id}, 'EXTEND_24H')" class="action-btn action-btn-blue">延长24小时</button>
              </div>
            </div>
          `;
        })
        .join('')
    );

    renderPagination('pinOrdersPagination', page, data.totalPages || 1, loadPinOrders);
  } catch (error) {
    showError(`加载置顶订单失败: ${error.message}`);
  }
}

async function updatePinOrder(orderId, action) {
  if (['CONFIRM', 'FAIL', 'CANCEL'].includes(String(action).toUpperCase()) && !paymentsAreEnabled()) {
    showError(paymentsUnavailableMessage);
    return;
  }
  const actionLabel = pinOrderActionLabel(action);
  const reason = await promptReason(`置顶订单操作：${actionLabel}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`置顶订单执行：${actionLabel}`, reason))) return;

  try {
    await apiRequest(`/admin/commercialization/pin-orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    });
    await loadPinOrders(state.currentPage.pinOrders);
    await loadCommercializationOverview();
  } catch (error) {
    showError(`置顶订单操作失败: ${error.message}`);
  }
}

async function loadMemberships(page = 1) {
  state.currentPage.memberships = page;
  const params = new URLSearchParams({ page: String(page), limit: '8' });
  const search = getInputValue('membershipSearch');
  const status = getInputValue('membershipStatus');
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  try {
    const data = await apiRequest(`/admin/commercialization/memberships?${params.toString()}`);
    setText('membershipsTotalCount', data.total || 0);

    if (!data.items?.length) {
      setHtml('membershipsList', '<div class="text-gray-500 text-sm">暂无会员记录</div>');
      renderPagination('membershipsPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'membershipsList',
      data.items
        .map(
          (item) => `
          <div class="border rounded p-3">
            <div class="flex justify-between items-start gap-2">
              <p class="font-semibold">订单 #${item.id} · 用户 #${item.user?.id || '-'}</p>
              ${formatStatusBadge(item.isActive ? 'active' : 'inactive', item.isActive ? 'success' : 'default')}
            </div>
            <p class="text-xs text-gray-600">用户：${escapeHtml(item.user?.nickname || maskEmail(item.user?.email) || '-')}</p>
            <p class="text-xs text-gray-600">来源：${escapeHtml(item.source || '-')} · 金额：${formatMoney(item.amount)}</p>
            <p class="text-xs text-gray-600">开始：${formatDateTime(item.startAt)} · 到期：${formatDateTime(item.expiresAt)}</p>
          </div>
        `
        )
        .join('')
    );

    renderPagination('membershipsPagination', page, data.totalPages || 1, loadMemberships);
  } catch (error) {
    showError(`加载会员记录失败: ${error.message}`);
  }
}

async function openGrantMembershipPrompt() {
  const userId = Number((await promptText('输入用户ID：', '', {
    title: '赠送会员（不收款）',
    label: '用户ID',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || 0);
  if (!userId) return;
  const mode = paymentsAreEnabled() ? normalizeMembershipGrantMode((await promptText('发放方式（立即发放 / 待处理）', '立即发放', {
    title: '赠送会员（不收款）',
    label: '发放方式',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '立即发放') : 'CONFIRM';
  const reason = await promptReason('赠送会员原因（不收款）', true);
  if (reason === null) return;

  try {
    await apiRequest('/admin/commercialization/memberships/grant', {
      method: 'POST',
      body: JSON.stringify({ userId, mode, reason }),
    });
    showSuccess('会员发放成功');
    await loadMemberships(state.currentPage.memberships);
    await loadCommercializationOverview();
  } catch (error) {
    showError(`发放会员失败: ${error.message}`);
  }
}

async function loadRewardRecords(page = 1) {
  state.currentPage.rewardRecords = page;
  const params = new URLSearchParams({ page: String(page), limit: '8' });
  try {
    const data = await apiRequest(`/admin/commercialization/rewards?${params.toString()}`);
    setText('rewardRecordsTotalCount', data.total || 0);
    if (!data.items?.length) {
      setHtml('rewardRecordsList', '<div class="text-gray-500 text-sm">暂无奖励记录</div>');
      renderPagination('rewardRecordsPagination', 1, 1, () => {});
      return;
    }

    setHtml(
      'rewardRecordsList',
      data.items
        .map(
          (item) => `
          <div class="border rounded p-3">
            <div class="flex justify-between items-start gap-2">
              <p class="font-semibold">奖励 #${item.id} · ${escapeHtml(item.rewardType || '-')}</p>
              <p class="text-xs text-gray-500">${formatDateTime(item.createdAt)}</p>
            </div>
            <p class="text-xs text-gray-600">反馈：#${item.feedbackId} · 用户：#${item.userId || '-'}</p>
            <p class="text-xs text-gray-600">奖励值：${escapeHtml(item.rewardValue || '-')} · 管理员：${escapeHtml(item.admin?.nickname || maskEmail(item.admin?.email) || '-')}</p>
            <p class="text-xs text-gray-600">备注：${escapeHtml(item.note || '-')}</p>
          </div>
        `
        )
        .join('')
    );
    renderPagination('rewardRecordsPagination', page, data.totalPages || 1, loadRewardRecords);
  } catch (error) {
    showError(`加载奖励记录失败: ${error.message}`);
  }
}

async function openGrantRewardPrompt() {
  const userId = Number((await promptText('输入用户ID：', '', {
    title: '发放奖励',
    label: '用户ID',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || 0);
  if (!userId) return;
  const rewardType = normalizeRewardType((await promptText(paymentsAreEnabled() ? '奖励类型（置顶 / 会员30天 / 积分 / 余额）' : '奖励类型（置顶 / 会员30天 / 积分；余额暂未开放）', '置顶', {
    title: '发放奖励',
    label: '奖励类型',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '置顶');
  if (!rewardType) return;
  if (rewardType === 'BALANCE' && !paymentsAreEnabled()) {
    showError(paymentsUnavailableMessage);
    return;
  }
  const rewardValue = (await promptText('奖励值（例如 24h / 100 / 10.00）', '', {
    title: '发放奖励',
    label: '奖励值',
    required: false,
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  const reason = await promptReason('奖励发放原因', true);
  if (reason === null) return;

  try {
    await apiRequest('/admin/commercialization/rewards/grant', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        rewardType,
        rewardValue,
        reason,
        source: 'admin_dashboard',
      }),
    });
    showSuccess('奖励发放成功');
    await loadRewardRecords(state.currentPage.rewardRecords);
    await loadCommercializationOverview();
  } catch (error) {
    showError(`奖励发放失败: ${error.message}`);
  }
}


function withdrawalStatusLabel(status) {
  switch (String(status || '').trim().toUpperCase()) {
    case 'PENDING':
      return '待处理';
    case 'PAID':
      return '已打款';
    case 'REJECTED':
      return '已驳回';
    case 'FAILED':
      return '失败';
    default:
      return String(status || '-');
  }
}

function withdrawalStatusBadgeType(status) {
  switch (String(status || '').trim().toUpperCase()) {
    case 'PAID':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'REJECTED':
    case 'FAILED':
      return 'danger';
    default:
      return 'default';
  }
}

function formatWithdrawalBankSnapshot(snapshot) {
  if (!snapshot) return '-';
  let data = snapshot;
  if (typeof snapshot === 'string') {
    try {
      data = JSON.parse(snapshot);
    } catch {
      return String(snapshot);
    }
  }
  if (!data || typeof data !== 'object') return '-';
  const parts = [];
  if (data.bankName) parts.push(`银行：${data.bankName}`);
  if (data.accountName) parts.push(`户名：${data.accountName}`);
  if (data.bsb) parts.push(`BSB：${data.bsb}`);
  if (data.accountNumber) parts.push(`账号：${maskAccountNumber(data.accountNumber)}`);
  return parts.length ? parts.join(' · ') : '-';
}

function withdrawalActionLabel(action) {
  switch (String(action || '').trim().toUpperCase()) {
    case 'PAID':
      return '确认已打款';
    case 'REJECT':
      return '驳回提现';
    case 'FAILED':
      return '标记失败';
    default:
      return String(action || '-');
  }
}

function renderWithdrawalListItem(request) {
  const statusType = withdrawalStatusBadgeType(request.status);
  return `
    <div class="border rounded p-3 bg-white">
      <div class="flex justify-between items-start gap-2 mb-1">
        <div>
          <p class="font-semibold">提现 #${request.id}</p>
          <p class="text-xs text-gray-500">${escapeHtml(withdrawalStatusLabel(request.status))}</p>
        </div>
        ${formatStatusBadge(request.status, statusType)}
      </div>
      <p class="text-xs text-gray-600">用户：${escapeHtml(request.user?.nickname || maskEmail(request.user?.email) || `#${request.user?.id || '-'}`)} · ${escapeHtml(request.user?.email || '-')}</p>
      <p class="text-xs text-gray-600">金额：${formatMoney(request.amount)} ${escapeHtml(request.currency || 'AUD')} · 可提现余额：${formatMoney(request.user?.withdrawableBalance || 0)}</p>
      <p class="text-xs text-gray-600">收款信息：${escapeHtml(formatWithdrawalBankSnapshot(request.bankSnapshot))}</p>
      <p class="text-xs text-gray-600">提交：${formatDateTime(request.createdAt)}${request.reviewedAt ? ` · 处理：${formatDateTime(request.reviewedAt)}` : ''}${request.paidAt ? ` · 打款：${formatDateTime(request.paidAt)}` : ''}</p>
      <div class="flex gap-2 mt-2 flex-wrap">
        <button type="button" aria-label="查看提现申请 ${request.id} 详情" onclick="openWithdrawalDetail(${request.id})" class="action-btn action-btn-blue">查看详情</button>
        ${
          paymentsAreEnabled() && String(request.status || '').toUpperCase() === 'PENDING'
            ? `<button type="button" aria-label="处理提现申请 ${request.id}" onclick="openWithdrawalDetail(${request.id})" class="action-btn action-btn-dark">处理提现</button>`
            : ''
        }
      </div>
    </div>
  `;
}

function buildWithdrawalDetailHtml(request) {
  const user = request.user || {};
  const admin = request.admin || {};
  const isPending = String(request.status || '').toUpperCase() === 'PENDING';
  const snapshotText = formatWithdrawalBankSnapshot(request.bankSnapshot);
  return `
    <div class="space-y-4 text-sm">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-wide text-slate-500">提现信息</p>
          <div class="mt-2 space-y-1">
            <p><span class="font-semibold">提现ID：</span>#${request.id}</p>
            <p><span class="font-semibold">状态：</span>${escapeHtml(withdrawalStatusLabel(request.status))}</p>
            <p><span class="font-semibold">金额：</span>${formatMoney(request.amount)} ${escapeHtml(request.currency || 'AUD')}</p>
            <p><span class="font-semibold">提交时间：</span>${formatDateTime(request.createdAt)}</p>
            <p><span class="font-semibold">更新时间：</span>${formatDateTime(request.updatedAt)}</p>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs uppercase tracking-wide text-slate-500">申请用户</p>
          <div class="mt-2 space-y-1">
            <p><span class="font-semibold">用户：</span>${escapeHtml(user.nickname || user.email || `#${user.id || '-'}`)}</p>
            <p><span class="font-semibold">邮箱：</span>${escapeHtml(user.email || '-')}</p>
            <p><span class="font-semibold">销售总额：</span>${formatMoney(user.salesTotal || 0)}</p>
            <p><span class="font-semibold">可提现余额：</span>${formatMoney(user.withdrawableBalance || 0)}</p>
            <p><span class="font-semibold">账户余额：</span>${formatMoney(user.balance || 0)}</p>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">收款信息</p>
        <div class="mt-2 space-y-1">
          <p><span class="font-semibold">银行名称：</span>${escapeHtml(request.bankName || '-')}</p>
          <p><span class="font-semibold">收款户名：</span>${escapeHtml(request.accountName || '-')}</p>
          <p><span class="font-semibold">BSB：</span>${escapeHtml(request.bsb || '-')}</p>
          <p><span class="font-semibold">银行卡号：</span>${escapeHtml(request.accountNumber || '-')}</p>
          <p><span class="font-semibold">备注：</span>${escapeHtml(request.note || '-')}</p>
          <p><span class="font-semibold">银行快照：</span>${escapeHtml(snapshotText)}</p>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">处理记录</p>
        <div class="mt-2 space-y-1">
          <p><span class="font-semibold">审核管理员：</span>${escapeHtml(admin.nickname || admin.email || '-')}</p>
          <p><span class="font-semibold">管理员备注：</span>${escapeHtml(request.adminNote || '-')}</p>
          <p><span class="font-semibold">审核时间：</span>${formatDateTime(request.reviewedAt)}</p>
          <p><span class="font-semibold">打款时间：</span>${formatDateTime(request.paidAt)}</p>
          <p><span class="font-semibold">转账参考号：</span>${escapeHtml(request.payoutReference || '-')}</p>
        </div>
      </div>

      ${
        !paymentsAreEnabled()
          ? `<div class="rounded border border-amber-200 bg-amber-50 p-4">${escapeHtml(paymentsUnavailableMessage)} 当前记录状态：${escapeHtml(withdrawalStatusLabel(request.status))}。</div>`
          : isPending
          ? `
        <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p class="text-sm font-semibold text-amber-900">当前提现仍在等待管理员处理</p>
          <p class="mt-1 text-xs text-amber-800">请在操作前再次核对银行卡信息、金额和原因。</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" onclick="openWithdrawalActionDialog(${request.id}, 'PAID')" class="action-btn action-btn-green">确认已打款</button>
            <button type="button" onclick="openWithdrawalActionDialog(${request.id}, 'REJECT')" class="action-btn action-btn-red">驳回提现</button>
            <button type="button" onclick="openWithdrawalActionDialog(${request.id}, 'FAILED')" class="action-btn action-btn-red">标记失败</button>
          </div>
        </div>
      `
          : `
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          该提现当前状态为 <span class="font-semibold">${escapeHtml(withdrawalStatusLabel(request.status))}</span>，已完成或已结束处理。
        </div>
      `
      }
    </div>
  `;
}

function openWithdrawalDetail(withdrawalId) {
  const request = state.withdrawalsById.get(Number(withdrawalId));
  if (!request) {
    showError('未找到提现记录');
    return;
  }
  openDetailDrawer(`提现详情 #${request.id}`, buildWithdrawalDetailHtml(request));
}

async function openWithdrawalActionDialog(withdrawalId, action) {
  if (!paymentsAreEnabled()) {
    showError(paymentsUnavailableMessage);
    return;
  }
  const request = state.withdrawalsById.get(Number(withdrawalId));
  if (!request) {
    showError('未找到提现记录');
    return;
  }

  const actionLabel = withdrawalActionLabel(action);
  const result = await openAdminDialog({
    title: actionLabel,
    subtitle: `提现 #${request.id} · ${formatMoney(request.amount)} ${request.currency || 'AUD'}`,
    bodyHtml: `
      <div class="space-y-3 text-sm text-slate-700">
        <p><span class="font-semibold">收款户名：</span>${escapeHtml(request.accountName || '-')}</p>
        <p><span class="font-semibold">银行卡号：</span>${escapeHtml(request.accountNumber || '-')}</p>
        <p><span class="font-semibold">BSB：</span>${escapeHtml(request.bsb || '-')}</p>
        <p><span class="font-semibold">银行：</span>${escapeHtml(request.bankName || '-')}</p>
        <p><span class="font-semibold">当前状态：</span>${escapeHtml(withdrawalStatusLabel(request.status))}</p>
      </div>
    `,
    fields: [
      {
        name: 'reason',
        label: '处理原因',
        type: 'textarea',
        value: '',
        placeholder: '请输入处理原因',
        required: true,
        minLength: 3,
        rows: 4,
      },
      ...(String(action).toUpperCase() === 'PAID'
        ? [
            {
              name: 'payoutReference',
              label: '转账参考号（可选）',
              type: 'text',
              value: '',
              placeholder: '银行流水号 / 转账参考号',
              required: false,
            },
          ]
        : []),
    ],
    confirmText:
      String(action).toUpperCase() === 'PAID'
        ? '确认已打款'
        : String(action).toUpperCase() === 'REJECT'
        ? '确认驳回'
        : '确认失败',
    cancelText: '取消',
    confirmVariant: String(action).toUpperCase() === 'PAID' ? 'dark' : 'danger',
    presentation: 'drawer',
  });

  if (!result.confirmed) return;

  const reason = String(result.values?.reason || '').trim();
  if (reason.length < 3) {
    showError('处理原因至少 3 个字符');
    return;
  }

  try {
    await apiRequest(`/admin/withdrawals/${withdrawalId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action,
        reason,
        payoutReference: String(result.values?.payoutReference || '').trim(),
      }),
    });
    showSuccess(`提现已${String(action).toUpperCase() === 'PAID' ? '打款' : String(action).toUpperCase() === 'REJECT' ? '驳回' : '标记失败'}`);
    closeDetailDrawer();
    await loadWithdrawals(state.currentPage.withdrawals || 1);
    if (state.currentSection === 'dashboard') {
      await loadDashboard();
    }
  } catch (error) {
    showError(`处理提现失败: ${error.message}`);
  }
}

async function loadWithdrawalsSection() {
  await loadFeatureFlags();
  await loadWithdrawals(state.currentPage.withdrawals || 1);
}

async function loadWithdrawals(page = 1) {
  state.currentPage.withdrawals = page;

  const params = new URLSearchParams({ page: String(page), limit: '8' });
  const search = getInputValue('withdrawalSearch');
  const status = getInputValue('withdrawalStatus');
  const dateFrom = getInputValue('withdrawalDateFrom');
  const dateTo = getInputValue('withdrawalDateTo');
  const sortOrder = getInputValue('withdrawalSortOrder') || 'desc';

  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (sortOrder) params.set('sortOrder', sortOrder);

  try {
    const data = await apiRequest(`/admin/withdrawals?${params.toString()}`);
    const items = Array.isArray(data.items) ? data.items : [];
    state.withdrawalsById = new Map(items.map((item) => [item.id, item]));

    setText('withdrawalsTotalCount', data.total || 0);
    setText('withdrawalsTotalCountFooter', data.total || 0);
    setText('withdrawalsRequestCount', data.summary?.requestCount || 0);
    setText('withdrawalsTotalAmount', formatMoney(data.summary?.totalAmount || 0));
    setText('withdrawalsSummaryLabel', status ? `当前筛选：${withdrawalStatusLabel(status)}` : '当前筛选：全部状态');
    setText('withdrawalsHint', items.length ? '点击“查看详情”展开银行卡、用户与处理记录' : '暂无提现申请');

    if (!items.length) {
      setHtml('withdrawalsList', '<div class="text-gray-500 text-sm">暂无提现申请</div>');
      renderPagination('withdrawalsPagination', 1, 1, () => {});
      return;
    }

    setHtml('withdrawalsList', items.map((request) => renderWithdrawalListItem(request)).join(''));
    renderPagination('withdrawalsPagination', page, data.totalPages || 1, loadWithdrawals);
  } catch (error) {
    showError(`加载提现申请失败: ${error.message}`);
  }
}

async function loadFeatureFlags() {
  try {
    const data = await apiRequest('/admin/feature-flags');
    const flags = data.flags || {};
    state.featureFlags.paymentsEnabled = flags.paymentsEnabled === true;
    const setCheckbox = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(value);
    };
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    };

    setCheckbox('flagBatchPublishEnabled', flags.batchPublishEnabled);
    setCheckbox('flagPaidPinEnabled', paymentsAreEnabled() && flags.paidPinEnabled === true);
    setCheckbox('flagMembershipPurchaseEnabled', paymentsAreEnabled() && flags.membershipPurchaseEnabled === true);
    setCheckbox('flagFeedbackRewardEnabled', flags.feedbackRewardEnabled);
    setCheckbox('flagOfflineServiceEnabled', flags.offlineServiceEnabled);
    setCheckbox('flagItemReviewEnabled', flags.itemReviewEnabled);
    setCheckbox('flagReportEnabled', flags.reportEnabled);
    setCheckbox('flagTradeFlowCardEnabled', flags.tradeFlowCardEnabled);
    setValue('flagPin24hPrice', flags.pinPricing?.pin24h ?? 1.99);
    setValue('flagPin3dPrice', flags.pinPricing?.pin3d ?? 4.99);
    setValue('flagPin7dPrice', flags.pinPricing?.pin7d ?? 8.99);
    setValue('flagFreeBatchQuota', flags.freeBatchQuota ?? 1);
    setValue('flagFeedbackDailyLimit', flags.feedbackDailyLimit ?? 5);
    state.featureFlags.platformDeliveryEnabled = flags.platformDeliveryEnabled === true;
    state.featureFlags.platformDeliveryMessage = String(flags.platformDeliveryMessage || '').trim();
    renderPlatformDeliveryNoticeBanners();
    renderPaymentsNoticeBanners();
  } catch (error) {
    state.featureFlags.paymentsEnabled = false;
    state.featureFlags.platformDeliveryEnabled = false;
    for (const id of ['flagPaidPinEnabled', 'flagMembershipPurchaseEnabled']) {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    }
    renderPlatformDeliveryNoticeBanners();
    renderPaymentsNoticeBanners();
    showError(`加载功能开关失败: ${error.message}`);
  }
}

async function saveFeatureFlags() {
  const reason = await promptReason('保存功能开关', true);
  if (reason === null) return;
  const getCheckbox = (id) => Boolean(document.getElementById(id)?.checked);
  const getNumber = (id, fallback = 0) => {
    const value = Number(document.getElementById(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  };

  const flags = {
    batchPublishEnabled: getCheckbox('flagBatchPublishEnabled'),
    feedbackRewardEnabled: getCheckbox('flagFeedbackRewardEnabled'),
    offlineServiceEnabled: getCheckbox('flagOfflineServiceEnabled'),
    itemReviewEnabled: getCheckbox('flagItemReviewEnabled'),
    reportEnabled: getCheckbox('flagReportEnabled'),
    tradeFlowCardEnabled: getCheckbox('flagTradeFlowCardEnabled'),
    pinPricing: {
      pin24h: getNumber('flagPin24hPrice', 1.99),
      pin3d: getNumber('flagPin3dPrice', 4.99),
      pin7d: getNumber('flagPin7dPrice', 8.99),
    },
    freeBatchQuota: getNumber('flagFreeBatchQuota', 1),
    feedbackDailyLimit: getNumber('flagFeedbackDailyLimit', 5),
  };

  if (!(await confirmCriticalAction('保存系统配置', reason))) return;

  try {
    await apiRequest('/admin/feature-flags', {
      method: 'PATCH',
      body: JSON.stringify({ flags, reason }),
    });
    showSuccess('系统配置已保存');
    await loadFeatureFlags();
  } catch (error) {
    showError(`保存系统配置失败: ${error.message}`);
  }
}

window.onload = async () => {
  initializeMovingWorkflowTimeWheels();

  if (authToken && adminUser) {
    renderAuthenticatedState();

    try {
      await apiRequest('/admin/stats');
      await showSection('dashboard');
    } catch (error) {
      showError('管理员会话已失效，请重新登录');
      clearAdminSession();
      renderLoggedOutState({ replaceUrl: true, clearEmail: true });
    }
    return;
  }

  renderLoggedOutState({ replaceUrl: false });
};

async function loadContentCleanups(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !authToken || state.currentSection !== 'deletionReview') return;
  const token = authToken, generation = deletionReview.generation, cleanupsGeneration = ++deletionReview.cleanupsGeneration;
  deletionReview.mediaGeneration += 1;
  deletionReview.cleanups.clear();
  const current = () => token === authToken && generation === deletionReview.generation
    && cleanupsGeneration === deletionReview.cleanupsGeneration && state.currentSection === 'deletionReview';
  for (const id of ['contentCleanupsList', 'contentCleanupsPagination', 'contentMediaDetail']) document.getElementById(id).innerHTML = '';
  setText('contentMediaDetail', '');
  setText('contentCleanupsStatus', '正在读取消息清理记录…');
  try {
    const data = await readDeletionReview(`/content-cleanups?page=${page}`, token);
    if (!current()) return;
    if (data.readOnly !== true || data.executionEnabled !== false || data.page !== page || data.pageSize !== 25
      || !deletionCount(data.total) || !Array.isArray(data.cleanups) || data.cleanups.length > 25 || data.total < data.cleanups.length
      || new Set(data.cleanups.map(row => row?.id)).size !== data.cleanups.length
      || data.cleanups.some(row => !row || !deletionRequestIdPattern.test(row.id) || !['TEXT', 'IMAGE'].includes(row.contentKind)
        || row.contentRemoved !== true || row.overallCompleted !== false || row.backupVerification !== 'PENDING'
        || row.mediaDisposition !== (row.contentKind === 'IMAGE' ? 'PENDING_REVIEW' : 'NOT_APPLICABLE')
        || !deletionDate(row.originalDeadline) || !deletionDate(row.processedAt) || Date.parse(row.originalDeadline) > Date.parse(row.processedAt))) {
      throw new Error('DELETION_INVALID_RESPONSE');
    }
    for (const row of data.cleanups) deletionReview.cleanups.set(row.id, { contentKind: row.contentKind });
    document.getElementById('contentCleanupsList').innerHTML = data.cleanups.map(row => `<div class="card">
      <p class="font-medium">${row.contentKind === 'IMAGE' ? '图片消息正文已清理，图片保留待核查' : '普通消息正文已清理'}</p>
      <p class="text-sm text-gray-600 mt-2">处理时间：${escapeHtml(formatDateTime(row.processedAt))}</p>
      <p class="text-sm text-amber-800 mt-2">缓存与备份待核查；账号注销尚未完成。</p>
      ${row.contentKind === 'IMAGE' ? `<button type="button" class="btn-gray mt-3" onclick="openContentMedia('${row.id}')">核查关联图片</button>` : ''}
      </div>`).join('');
    setText('contentCleanupsStatus', data.total === 0 ? '目前没有消息内容清理记录。'
      : data.cleanups.length === 0 ? '本页已无记录，请返回上一页。' : `共有 ${data.total} 项正文清理记录。此页面只供核查。`);
    renderPagination('contentCleanupsPagination', page, Math.min(10000, Math.ceil(data.total / 25)), loadContentCleanups);
  } catch (error) { if (current()) setText('contentCleanupsStatus', deletionReviewMessage(error)); }
}

async function openContentMedia(cleanupId) {
  if (deletionReview.cleanups.get(cleanupId)?.contentKind !== 'IMAGE' || !authToken || state.currentSection !== 'deletionReview') return;
  const token = authToken, generation = deletionReview.generation, mediaGeneration = ++deletionReview.mediaGeneration;
  const current = () => token === authToken && generation === deletionReview.generation
    && mediaGeneration === deletionReview.mediaGeneration && state.currentSection === 'deletionReview';
  setText('contentMediaDetail', '正在核查图片关联…');
  try {
    const data = await readDeletionReview(`/content-cleanups/${encodeURIComponent(cleanupId)}/assets`, token);
    if (!current()) return;
    if (data.readOnly !== true || data.executionEnabled !== false || data.objectDeletionAuthorized !== false || data.ownershipVerified !== false
      || data.externalReferencesVerified !== false || data.objectRead !== false || data.referenceCoverage !== 'NOT_PROVEN_ABSENT'
      || !['RECORDED', 'MISSING'].includes(data.uploadRegistration) || !deletionCount(data.registeredActiveReferences)
      || (data.uploadRegistration === 'MISSING' ? data.uploadStatus !== null || data.registeredActiveReferences !== 0
        : !['PENDING', 'AVAILABLE', 'VERIFY_REQUIRED'].includes(data.uploadStatus))
      || !deletionCount(data.knownReferenceRows) || !deletionCount(data.heldReferenceRows) || data.heldReferenceRows > data.knownReferenceRows
      || data.disposition !== (data.heldReferenceRows ? 'RETAIN_HELD' : data.knownReferenceRows ? 'RETAIN_REFERENCED' : 'RETAIN_UNVERIFIED')) {
      throw new Error('DELETION_INVALID_RESPONSE');
    }
    const description = data.disposition === 'RETAIN_HELD' ? '关联资料有有效保全，图片继续保留。'
      : data.disposition === 'RETAIN_REFERENCED' ? '图片仍有其他资料引用，继续保留。' : '暂未发现其他引用，归属及外部引用仍未核实，图片继续保留。';
    setText('contentMediaDetail', `${description} 检测到 ${data.knownReferenceRows} 条关联记录。${data.uploadRegistration === 'RECORDED' ? '已有上传来源登记，仍需核查文件及外部引用。' : '尚无上传来源登记。'} 尚未读取或删除图片文件。`);
    document.getElementById('contentMediaDetail')?.scrollIntoView?.({ block: 'nearest' });
  } catch (error) {
    if (current()) {
      setText('contentMediaDetail', deletionReviewMessage(error));
      document.getElementById('contentMediaDetail')?.scrollIntoView?.({ block: 'nearest' });
    }
  }
}


function mediaVerificationValid(value, createdAt) {
  if (value === null || value === undefined) return true;
  if (!value || !deletionRequestIdPattern.test(value.id) || value.observationOnly !== true
    || value.uploadStateChanged !== false || value.objectDeletionAuthorized !== false
    || !deletionDate(value.startedAt) || Date.parse(value.startedAt) < Date.parse(createdAt)) return false;
  if (value.state === 'RUNNING') return value.outcome === null && value.completedAt === null;
  if (!deletionDate(value.completedAt) || Date.parse(value.completedAt) < Date.parse(value.startedAt)) return false;
  return value.state === 'ABANDONED' ? value.outcome === null
    : value.state === 'COMPLETED' && ['MATCHED', 'DIFFERENT', 'NOT_FOUND', 'UNAVAILABLE'].includes(value.outcome);
}

function mediaVerificationLabel(value) {
  if (!value) return '尚无文件核验记录。';
  const label = value.state === 'RUNNING' ? '正在核验' : value.state === 'ABANDONED' ? '核验已中止'
    : { MATCHED: '核验时内容一致', DIFFERENT: '核验内容不一致', NOT_FOUND: '核验时未找到文件', UNAVAILABLE: '核验未完成' }[value.outcome];
  return `${label} · ${formatDateTime(value.completedAt || value.startedAt)}。核验结果仅反映当时状态。`;
}

async function loadMediaUploads(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !authToken || state.currentSection !== 'deletionReview') return;
  const token = authToken, generation = deletionReview.generation, uploadsGeneration = ++deletionReview.uploadsGeneration;
  const current = () => token === authToken && generation === deletionReview.generation
    && uploadsGeneration === deletionReview.uploadsGeneration && state.currentSection === 'deletionReview';
  for (const id of ['mediaUploadsList', 'mediaUploadsPagination']) document.getElementById(id).innerHTML = '';
  setText('mediaUploadsStatus', '正在读取图片上传登记…');
  try {
    const data = await readDeletionReview(`/media-uploads?page=${page}`, token);
    if (!current()) return;
    if (data.readOnly !== true || data.executionEnabled !== false || data.objectDeletionAuthorized !== false
      || data.page !== page || data.pageSize !== 25 || !deletionCount(data.total)
      || !Array.isArray(data.uploads) || data.uploads.length > 25 || data.total < data.uploads.length
      || new Set(data.uploads.map(row => row?.id)).size !== data.uploads.length
      || data.uploads.some(row => !row || !deletionRequestIdPattern.test(row.id)
        || !['PENDING', 'AVAILABLE', 'VERIFY_REQUIRED'].includes(row.status)
        || !['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'].includes(row.contentType)
        || !deletionCount(row.byteSize) || row.byteSize < 1 || row.byteSize > 10485760 || !deletionCount(row.activeReferences)
        || !deletionDate(row.createdAt) || (row.status === 'AVAILABLE'
          ? !deletionDate(row.confirmedAt) || Date.parse(row.confirmedAt) < Date.parse(row.createdAt) : row.confirmedAt !== null)
        || !mediaVerificationValid(row.verification, row.createdAt)
        || row.disposition !== 'RETAIN_PENDING_RECONCILIATION')) throw new Error('DELETION_INVALID_RESPONSE');
    const labels = { PENDING: '上传结果待确认', AVAILABLE: '上传已确认', VERIFY_REQUIRED: '上传结果待核查' };
    document.getElementById('mediaUploadsList').innerHTML = data.uploads.map(row => `<div class="card">
      <p class="font-medium">${labels[row.status]}</p>
      <p class="text-sm text-gray-600 mt-2">登记时间：${escapeHtml(formatDateTime(row.createdAt))} · 图片大小：${Math.ceil(row.byteSize / 1024)} KB</p>
      <p class="text-sm text-gray-600 mt-2">已登记的使用位置：${row.activeReferences} 处</p>
      <p class="text-sm text-gray-600 mt-2">${escapeHtml(mediaVerificationLabel(row.verification))}</p>
      <p class="text-sm text-amber-800 mt-2">图片继续保留；清理前仍需核查其他引用、保全、缓存与备份。</p></div>`).join('');
    setText('mediaUploadsStatus', data.total === 0 ? '目前没有图片上传登记；历史图片来源仍需另行核查。'
      : data.uploads.length === 0 ? '本页已无记录，请返回上一页。' : `共有 ${data.total} 项上传登记。此页面只供核查。`);
    renderPagination('mediaUploadsPagination', page, Math.min(10000, Math.ceil(data.total / 25)), loadMediaUploads);
  } catch (error) { if (current()) setText('mediaUploadsStatus', deletionReviewMessage(error)); }
}

// Separate execution queue: only user-confirmed erasures, never generic
// "approve deletion" checkboxes on a read-only dependency preview.
let erasureGeneration = 0;
const erasureRows = new Map();
function validErasure(row) {
  return row && deletionRequestIdPattern.test(row.id) && ['MEDIA_PENDING','COMPLETE'].includes(row.state)
    && row.onlineRemoved === true && row.onlineCompleted === (row.state === 'COMPLETE')
    && deletionDate(row.deadlineAt) && typeof row.message === 'string' && row.message.length <= 1000;
}
async function loadErasureRequests(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || state.currentSection !== 'deletionReview') return;
  const token = authToken, marker = ++erasureGeneration;
  const current = () => authToken === token && erasureGeneration === marker && state.currentSection === 'deletionReview';
  erasureRows.clear();
  document.getElementById('erasureRequests').replaceChildren();
  document.getElementById('erasurePagination').replaceChildren();
  setText('erasureStatus', '正在读取图片处理进度…');
  try {
    const data = await readDeletionReview(`/erasures?page=${page}`, token);
    if (!current()) return;
    if (!Array.isArray(data.rows) || data.rows.length > 25 || !deletionCount(data.total) || data.page !== page
      || data.pageSize !== 25 || data.rows.some(row => !validErasure(row))
      || new Set(data.rows.map(row => row.id)).size !== data.rows.length) throw new Error('DELETION_INVALID_RESPONSE');
    for (const row of data.rows) erasureRows.set(row.id, { row, page, token, marker });
    document.getElementById('erasureRequests').innerHTML = data.rows.map(row => `<div class="border rounded p-3">
      <p>申请 ${escapeHtml(row.id)}</p>
      <p class="text-sm ${Date.parse(row.deadlineAt) < Date.now() ? 'text-red-600' : 'text-gray-600'}">目标日期：${escapeHtml(formatDateTime(row.deadlineAt))}</p>
      <p class="text-sm">${row.code === 'UPLOAD_SETTLING' ? '正在等待刚才的上传结束，请两分钟后继续。' : row.code === 'MEDIA_RETRY_REQUIRED' ? '存储处理未确认完成，请检查存储配置后继续。' : '登记图片待清理。'}</p>
      <button type="button" class="btn-red mt-2" data-erasure="${row.id}" onclick="processErasureRequest('${row.id}')">处理下一批图片</button>
      </div>`).join('');
    setText('erasureStatus', data.total ? `共 ${data.total} 份待处理；此操作会实际删除对应用户的登记图片。` : '没有待处理的图片清理。');
    renderPagination('erasurePagination', page, Math.min(10000, Math.ceil(data.total / 25)), loadErasureRequests);
  } catch (error) { if (current()) setText('erasureStatus', '未能读取图片清理队列，可能尚未启用。请稍后刷新。'); }
}
async function processErasureRequest(id) {
  const selected = erasureRows.get(id);
  if (!selected || selected.token !== authToken || selected.marker !== erasureGeneration || state.currentSection !== 'deletionReview') return;
  if (!confirm('此用户已确认注销。现在实际清理下一批登记图片？这不会删除其他账号的图片。')) return;
  const { token, marker, page } = selected;
  const current = () => token === authToken && marker === erasureGeneration && state.currentSection === 'deletionReview';
  if (!current()) return;
  document.querySelectorAll('[data-erasure]').forEach(button => { button.disabled = true; });
  const controller = new AbortController(); deletionReview.controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${API_BASE_URL}/admin/account-deletion-requests/erasures/${id}/process`, {
      method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const data = await response.json();
    if (!current()) return;
    if (!response.ok || !validErasure(data.receipt) || data.receipt.id !== id) throw new Error('ERASURE_UNKNOWN');
    await loadErasureRequests(page);
  } catch {
    if (current()) setText('erasureStatus', '本次结果未确认，可能已有部分图片处理完成。请先“查看待处理”刷新结果，再决定是否继续。');
  } finally { clearTimeout(timeout); deletionReview.controllers.delete(controller); }
}
