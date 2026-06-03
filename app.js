// CReuse 管理后台前端逻辑（P0/P1 增强版）
const API_BASE_URL = 'https://campus-reuse-backend-production.up.railway.app';
// const API_BASE_URL = 'http://localhost:8080';

let authToken = localStorage.getItem('adminToken') || '';
let adminUser = JSON.parse(localStorage.getItem('adminUser') || 'null');
let csrfToken = '';

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
  },
  selectedReportIds: new Set(),
  selectedUserIds: new Set(),
  selectedItemIds: new Set(),
  selectedMovingIds: new Set(),
  selectedStorageIds: new Set(),
  movingServicesById: new Map(),
  selectedMovingServiceId: null,
  movingWorkflowDefaultQuote: 0,
  movingWorkflowSubmitting: false,
};

const adminDialogState = {
  resolve: null,
  escHandler: null,
  config: null,
  fields: [],
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
  if (!image) return '';
  if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
    return image;
  }
  return `${API_BASE_URL}/uploads/${image}`;
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

function renderReportEvidenceImages(report) {
  const images = getReportEvidenceImages(report);
  if (!images.length) return '';

  return `
    <div class="mt-2">
      <p class="text-xs text-gray-500 mb-1">证据图片（${images.length}）</p>
      <div class="flex gap-2 flex-wrap">
        ${images
          .map((img) => {
            const src = resolveImageUrl(img);
            return `<a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">
                <img src="${escapeHtml(src)}" class="w-16 h-16 rounded object-cover border border-gray-200" />
              </a>`;
          })
          .join('')}
      </div>
    </div>
  `;
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
      dateValue: matched[1],
      hourValue: matched[2],
      minuteValue: matched[3],
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    dateValue: toLocalDateKey(parsed),
    hourValue: pad2(parsed.getHours()),
    minuteValue: pad2(parsed.getMinutes()),
  };
}

function getTimeWheelValues(part) {
  const total = part === 'hour' ? 24 : 60;
  return Array.from({ length: total }, (_item, index) => pad2(index));
}

function getTimeWheelContainerId(fieldId, part) {
  return `${fieldId}${part === 'hour' ? 'HourWheel' : 'MinuteWheel'}`;
}

function getActiveTimeWheelValue(fieldId, part) {
  const button = document.querySelector(`#${getTimeWheelContainerId(fieldId, part)} .time-wheel-option.active`);
  return button ? String(button.dataset.value || '') : '';
}

function updateTimeWheelPreview(fieldId) {
  const preview = document.getElementById(`${fieldId}Preview`);
  if (!preview) return;
  const dateValue = getInputValue(`${fieldId}Date`);
  const hourValue = getActiveTimeWheelValue(fieldId, 'hour');
  const minuteValue = getActiveTimeWheelValue(fieldId, 'minute');
  preview.textContent = dateValue ? `${dateValue} ${hourValue || '--'}:${minuteValue || '--'}` : '未选择';
}

function syncTimeWheelValue(fieldId) {
  const hiddenInput = document.getElementById(fieldId);
  if (!hiddenInput) return;
  const dateValue = getInputValue(`${fieldId}Date`);
  const hourValue = getActiveTimeWheelValue(fieldId, 'hour');
  const minuteValue = getActiveTimeWheelValue(fieldId, 'minute');
  hiddenInput.value = dateValue && hourValue && minuteValue ? `${dateValue} ${hourValue}:${minuteValue}` : '';
  updateTimeWheelPreview(fieldId);
}

function centerTimeWheelSelection(fieldId, part) {
  const button = document.querySelector(`#${getTimeWheelContainerId(fieldId, part)} .time-wheel-option.active`);
  if (!button) return;
  button.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function selectTimeWheelValue(fieldId, part, value, shouldCenter = false) {
  const container = document.getElementById(getTimeWheelContainerId(fieldId, part));
  if (!container) return;
  container.querySelectorAll('.time-wheel-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === value);
  });
  syncTimeWheelValue(fieldId);
  if (shouldCenter) centerTimeWheelSelection(fieldId, part);
}

function adjustTimeWheelValue(fieldId, part, step) {
  const values = getTimeWheelValues(part);
  const currentValue = getActiveTimeWheelValue(fieldId, part);
  const currentIndex = values.indexOf(currentValue);
  const nextIndex = currentIndex >= 0 ? Math.min(values.length - 1, Math.max(0, currentIndex + step)) : step > 0 ? 0 : values.length - 1;
  selectTimeWheelValue(fieldId, part, values[nextIndex], true);
}

function bindTimeWheelContainer(fieldId, part) {
  const container = document.getElementById(getTimeWheelContainerId(fieldId, part));
  if (!container || container.dataset.bound === '1') return;

  container.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      adjustTimeWheelValue(fieldId, part, event.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  container.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      adjustTimeWheelValue(fieldId, part, 1);
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustTimeWheelValue(fieldId, part, -1);
    }
  });

  container.dataset.bound = '1';
}

function ensureTimeWheelRendered(fieldId) {
  ['hour', 'minute'].forEach((part) => {
    const container = document.getElementById(getTimeWheelContainerId(fieldId, part));
    if (!container) return;
    if (!container.childElementCount) {
      container.innerHTML = getTimeWheelValues(part)
        .map(
          (value) =>
            `<button type="button" class="time-wheel-option" data-value="${value}" onclick="selectTimeWheelValue('${fieldId}', '${part}', '${value}', true)">${value}</button>`
        )
        .join('');
    }
    bindTimeWheelContainer(fieldId, part);
  });
}

function clearTimeWheel(fieldId) {
  const hiddenInput = document.getElementById(fieldId);
  const dateInput = document.getElementById(`${fieldId}Date`);
  if (hiddenInput) hiddenInput.value = '';
  if (dateInput) dateInput.value = '';
  ['hour', 'minute'].forEach((part) => {
    const container = document.getElementById(getTimeWheelContainerId(fieldId, part));
    if (!container) return;
    container.querySelectorAll('.time-wheel-option.active').forEach((button) => button.classList.remove('active'));
  });
  updateTimeWheelPreview(fieldId);
}

function setTimeWheelValue(fieldId, rawValue) {
  ensureTimeWheelRendered(fieldId);
  clearTimeWheel(fieldId);

  const parsed = parseMovingWorkflowDateTime(rawValue);
  if (!parsed) return;

  const dateInput = document.getElementById(`${fieldId}Date`);
  if (dateInput) dateInput.value = parsed.dateValue;
  selectTimeWheelValue(fieldId, 'hour', parsed.hourValue, false);
  selectTimeWheelValue(fieldId, 'minute', parsed.minuteValue, false);
  centerTimeWheelSelection(fieldId, 'hour');
  centerTimeWheelSelection(fieldId, 'minute');
}

function seedTimeWheelDate(fieldId, rawDateValue) {
  const dateInput = document.getElementById(`${fieldId}Date`);
  if (!dateInput || dateInput.value) return;
  const dateValue = toLocalDateKey(rawDateValue);
  if (!dateValue) return;
  dateInput.value = dateValue;
  syncTimeWheelValue(fieldId);
}

function syncTimeWheelFromDate(fieldId) {
  ensureTimeWheelRendered(fieldId);
  syncTimeWheelValue(fieldId);
}

function initializeMovingWorkflowTimeWheels() {
  MOVING_WORKFLOW_TIME_WHEEL_IDS.forEach((fieldId) => {
    ensureTimeWheelRendered(fieldId);
    updateTimeWheelPreview(fieldId);
  });
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

async function fetchCsrfToken() {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/csrf-token`, {
      credentials: 'include',
    });

    if (!response.ok) return;

    const data = await response.json();
    csrfToken = data.csrfToken || '';
  } catch (error) {
    console.error('获取 CSRF Token 失败:', error);
  }
}

async function apiRequest(endpoint, options = {}, expectBlob = false) {
  const url = `${API_BASE_URL}${endpoint}`;
  const config = {
    method: options.method || 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Authorization': authToken ? `Bearer ${authToken}` : '',
      'CSRF-Token': csrfToken,
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

      if (response.status === 403 && String(payload?.error || '').includes('CSRF')) {
        await fetchCsrfToken();
        const retryConfig = {
          ...config,
          headers: {
            ...config.headers,
            'CSRF-Token': csrfToken,
          },
        };

        const retry = await fetch(url, retryConfig);
        if (retry.ok) {
          return expectBlob ? retry.blob() : retry.json();
        }
      }
    } catch (_) {
      // ignore json parse error
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(errorMessage || '权限不足，请重新登录');
    }

    throw new Error(errorMessage);
  }

  if (expectBlob) return response.blob();
  return response.json();
}

function ensureAdminDialog() {
  if (document.getElementById('adminActionModal')) return;

  const modal = document.createElement('div');
  modal.id = 'adminActionModal';
  modal.className = 'fixed inset-0 z-[80] hidden items-center justify-center px-4 py-6 bg-slate-950/60 backdrop-blur-md';
  modal.innerHTML = `
    <div class="absolute inset-0" style="background: radial-gradient(circle at top, rgba(248,113,113,.25), rgba(15,23,42,.62));" data-admin-modal-close="true"></div>
    <div class="relative z-[81] flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-[0_40px_120px_rgba(15,23,42,0.5)]">
      <div class="relative overflow-hidden border-b border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-rose-700 px-5 py-5 text-white">
        <div class="absolute inset-0 opacity-40" style="background: radial-gradient(circle at top right, rgba(255,255,255,.22), transparent 38%), radial-gradient(circle at bottom left, rgba(251,191,36,.12), transparent 30%);"></div>
        <div class="relative flex items-start justify-between gap-4">
          <div class="min-w-0 flex items-start gap-3">
            <div class="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-xl shadow-lg shadow-black/10">
              <i class="fas fa-shield-halved"></i>
            </div>
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">CReuse Admin Workflow</p>
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

function getAdminModalElements() {
  ensureAdminDialog();
  const modal = document.getElementById('adminActionModal');
  if (!modal) return null;
  return {
    modal,
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
  const elements = getAdminModalElements();
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
  };
  adminDialogState.fields = adminDialogState.config.fields;

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

  elements.modal.classList.remove('hidden');
  elements.modal.classList.add('flex');
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
  });
  return Boolean(result.confirmed);
}

function openDetailDrawer(title, html) {
  setText('detailDrawerTitle', title);
  setHtml('detailDrawerBody', html);
  document.getElementById('detailDrawerMask')?.classList.remove('hidden');
  document.getElementById('detailDrawer')?.classList.remove('hidden');
}

function closeDetailDrawer() {
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

    await fetchCsrfToken();

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
    showError(`登录失败: ${error.message}`);
  }
}

async function logout() {
  const result = await openAdminDialog({
    title: '退出登录',
    subtitle: '确认后将清除本地管理员会话',
    bodyHtml: '<p class="text-sm text-slate-700">确定要退出登录吗？</p>',
    confirmText: '确认退出',
    cancelText: '取消',
    confirmVariant: 'dark',
  });
  if (!result.confirmed) return;
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  authToken = '';
  adminUser = null;
  location.reload();
}

async function showSection(sectionName) {
  state.currentSection = sectionName;

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
    case 'dashboard':
      await loadDashboard();
      break;
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
    case 'commercialization':
      await loadCommercializationSection();
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

    const todos = stats.todos || {};
    const todoHtml = `
      <button onclick="openSectionWithPreset('reports', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理举报：${todos.pendingReports || 0}</button>
      <button onclick="openSectionWithPreset('feedbacks', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理反馈：${todos.pendingFeedbacks || 0}</button>
      <button onclick="openSectionWithPreset('disputes', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理纠纷：${todos.pendingDisputes || 0}</button>
      <button onclick="openSectionWithPreset('items', 'pendingReview')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待审核商品：${todos.pendingReviewItems || 0}</button>
      <button onclick="openSectionWithPreset('offline', 'pending')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理线下服务：${todos.pendingOfflineServices || 0}</button>
      <button onclick="openSectionWithPreset('orders', 'pendingDispute')" class="w-full text-left border rounded p-2 hover:bg-gray-50">待处理取消订单：${todos.pendingCancelOrders || 0}</button>
      <button onclick="openSectionWithPreset('commercialization', 'paymentExceptions')" class="w-full text-left border rounded p-2 hover:bg-gray-50">置顶支付异常：${todos.paymentExceptions || 0}</button>
      <button onclick="openSectionWithPreset('feedbacks', 'highPriorityBug')" class="w-full text-left border rounded p-2 hover:bg-gray-50">高优先级 Bug：${todos.highPriorityBugs || 0}</button>
    `;
    setHtml('dashboardTodos', todoHtml);
  } catch (error) {
    showError(`加载统计失败: ${error.message}`);
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

          const actionBtn = user.isAdmin
            ? '<span class="action-btn action-btn-amber">管理员</span>'
            : `<button onclick="toggleUserBan(${user.id}, ${!user.isBanned})" class="action-btn ${
                user.isBanned ? 'action-btn-green' : 'action-btn-red'
              }">${
                user.isBanned ? '解封' : '封禁'
              }</button>`;

          return `
            <tr>
              <td class="td">
                <input
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
                <div class="flex items-center gap-2">
                  <button onclick="openUserDetail(${user.id})" class="action-btn action-btn-blue">详情</button>
                  <button onclick="changeUserRole(${user.id}, '${user.isAdmin ? 'admin' : 'user'}')" class="action-btn action-btn-blue">角色</button>
                  <button onclick="changeUserPublishPermission(${user.id}, '${(user.publishPermission?.status || 'ACTIVE')}')" class="action-btn action-btn-amber">发布权限</button>
                  <button onclick="addUserAdminNote(${user.id})" class="action-btn action-btn-blue">备注</button>
                  ${actionBtn}
                </div>
              </td>
            </tr>
          `;
        })
        .join('')
    );

    renderPagination('usersPagination', page, data.totalPages || 1, loadUsers);
  } catch (error) {
    showError(`加载用户失败: ${error.message}`);
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

function getOrderNextActions(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PENDING') return ['PAID', 'CANCELED', 'FAILED'];
  if (normalized === 'PAID') return ['SHIPPED', 'CANCELED', 'DISPUTED', 'REFUNDED'];
  if (normalized === 'SHIPPED') return ['COMPLETED', 'DISPUTED', 'REFUNDED'];
  if (normalized === 'DISPUTED') return ['REFUNDED', 'COMPLETED'];
  return [];
}

function orderStatusActionLabel(status) {
  const map = {
    PAID: '确认支付',
    SHIPPED: '标记发货',
    COMPLETED: '标记完成',
    CANCELED: '标记取消',
    DISPUTED: '标记纠纷',
    REFUNDED: '标记退款',
    FAILED: '标记失败',
  };
  return map[String(status || '').toUpperCase()] || String(status || '').toUpperCase();
}

function orderStatusActionButtonClass(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PAID' || normalized === 'SHIPPED' || normalized === 'COMPLETED') return 'btn-gray';
  return 'btn-red';
}

function renderOrderActionButtons(order) {
  const actions = getOrderNextActions(order.status);
  if (!actions.length) {
    return '<span class="text-xs text-gray-500">当前状态无需后台操作</span>';
  }

  return actions
    .map(
      (action) =>
        `<button onclick="setOrderStatus(${order.id}, '${action}')" class="${orderStatusActionButtonClass(action)}">${orderStatusActionLabel(action)}</button>`
    )
    .join('');
}

function getStorageNextActions(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PENDING') return ['ACTIVE'];
  if (normalized === 'ACTIVE') return ['COMPLETED', 'EXPIRED'];
  return [];
}

function storageStatusActionLabel(status) {
  const map = {
    ACTIVE: '激活',
    COMPLETED: '完成',
    EXPIRED: '过期',
  };
  return map[String(status || '').toUpperCase()] || String(status || '').toUpperCase();
}

function storageStatusActionButtonClass(status) {
  return String(status || '').toUpperCase() === 'ACTIVE' ? 'btn-gray' : 'btn-red';
}

function renderStorageActionButtons(order) {
  const actions = getStorageNextActions(order.status);
  if (!actions.length) {
    return '<span class="text-xs text-gray-500">当前状态无需后台操作</span>';
  }

  return actions
    .map(
      (action) =>
        `<button onclick="updateStorageStatus(${order.id}, '${action}')" class="${storageStatusActionButtonClass(action)}">${storageStatusActionLabel(action)}</button>`
    )
    .join('');
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
              <button onclick="updateReportStatus(${report.id})" class="btn-gray">改状态</button>
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
    showError(`加载举报失败: ${error.message}`);
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
    const evidenceImages = Array.isArray(report.evidenceImages) ? report.evidenceImages : [];

    const evidenceHtml = evidenceImages.length
      ? `<div class="flex gap-2 flex-wrap">${
          evidenceImages
            .map((url) => `<a href="${escapeHtml(resolveImageUrl(url))}" target="_blank" rel="noreferrer">
              <img src="${escapeHtml(resolveImageUrl(url))}" class="w-20 h-20 rounded object-cover border" />
            </a>`)
            .join('')
        }</div>`
      : '<p class="text-gray-500">无证据图片</p>';

    const logsHtml = logs.length
      ? `<ul class="list-disc pl-5">${logs
          .map((log) => `<li>${formatDateTime(log.createdAt)} · ${escapeHtml(log.action)} · ${escapeHtml(log.admin?.nickname || maskEmail(log.admin?.email) || '-')}</li>`)
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

async function updateReportStatus(reportId) {
  const status = (await promptText('输入状态（pending/reviewing/valid/invalid/duplicate/resolved/closed）', 'reviewing', {
    title: '更新举报状态',
    label: '状态',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '';
  if (!status) return;
  const priority = ((await promptText('输入优先级（LOW/MEDIUM/HIGH）', 'MEDIUM', {
    title: '更新举报状态',
    label: '优先级',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '').toUpperCase();
  const reason = await promptReason('更新举报状态', true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`更新举报状态为 ${status}`, reason))) return;

  try {
    await apiRequest(`/admin/reports/${reportId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, priority, reason }),
    });
    await loadReports(state.currentPage.reports);
  } catch (error) {
    showError(`更新举报状态失败: ${error.message}`);
  }
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
              <button onclick="openFeedbackDetail(${feedback.id})" class="btn-gray">详情</button>
              <button onclick="updateFeedbackStatus(${feedback.id}, '${escapeHtml(feedback.status)}', '${escapeHtml(
          feedback.priority
        )}')" class="btn-gray">改状态/优先级</button>
              <button onclick="replyFeedback(${feedback.id})" class="btn-gray">管理员回复</button>
              <button onclick="rewardFeedback(${feedback.id})" class="btn-red">发放奖励</button>
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
              .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
                <img src="${escapeHtml(url)}" class="w-20 h-20 object-cover rounded border border-gray-200" />
              </a>`)
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
  const rewardType = ((await promptText(
    '奖励类型（PIN_CREDIT / COUPON / MEMBERSHIP_DAYS / POINTS / BALANCE / NONE）',
    'NONE',
    {
      title: '发放反馈奖励',
      label: '奖励类型',
      confirmText: '继续',
      confirmVariant: 'dark',
    }
  )) || '').toUpperCase();
  if (!rewardType) return;

  const rewardValue = (await promptText('奖励值（例如 PIN_24H / 7 / 100 / 10.00，可选）', '', {
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
    showError(`加载商品失败: ${error.message}`);
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
    showError(`加载订单失败: ${error.message}`);
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

async function setOrderStatus(orderId, status) {
  const reason = await promptReason(`更新订单 #${orderId} 状态为 ${status}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`更新订单状态为 ${status}`, reason))) return;

  try {
    await apiRequest(`/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
    await loadOrders(state.currentPage.orders);
    if (state.currentSection === 'disputes') {
      await loadDisputes(state.currentPage.disputes);
    }
  } catch (error) {
    showError(`更新订单状态失败: ${error.message}`);
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
            tx.paymentChannel || '-'
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
        (order) => `
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
            <div class="flex gap-2 flex-wrap">
              <button onclick="assignDisputeOrder(${order.id})" class="btn-gray">指派</button>
              <button onclick="resolveDisputeOrder(${order.id}, 'MARK_COMPLETED')" class="btn-red">改为完成</button>
              <button onclick="resolveDisputeOrder(${order.id}, 'KEEP_CANCELED')" class="btn-gray">保持取消</button>
            </div>
          </div>
        `
      )
      .join('');

    setHtml('disputesOrdersList', ordersHtml || '<div class="card text-gray-500 text-center">暂无取消订单纠纷</div>');

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
    showError(`加载纠纷失败: ${error.message}`);
  }
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
  const actionLabel = action === 'MARK_COMPLETED' ? '将取消订单改为已完成' : '保持订单为已取消';
  const reason = await promptReason(actionLabel, true);
  if (reason === null) return;
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
  await Promise.all([loadOfflineOverview(), loadMovingServices(1), loadStorageOrders(1), loadRecycleConsign()]);
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

function deliveryPayerLabel(payer) {
  const normalized = String(payer || '').toUpperCase();
  if (normalized === 'SELLER') return '卖家';
  if (normalized === 'SHARED') return '双方';
  return '买家';
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
  const status = String(service?.status || '').toUpperCase();
  const isPlatform = isPlatformMovingServiceRecord(service, meta);

  if (!isPlatform) {
    if (status === 'PENDING') return ['CONFIRMED', 'CANCELED'];
    if (status === 'CONFIRMED') return ['IN_PROGRESS', 'CANCELED'];
    if (status === 'IN_PROGRESS') return ['COMPLETED', 'CANCELED'];
    return [];
  }

  if (status === 'WAITING_PLATFORM_DELIVERY_QUOTE') {
    return ['DELIVERY_QUOTE_CONFIRMED', 'CANCELED'];
  }
  if (status === 'DELIVERY_QUOTE_CONFIRMED') {
    return [];
  }
  if (status === 'BUYER_PAID_WAITING_DRIVER') {
    return ['DRIVER_ASSIGNED', 'CANCELED'];
  }
  if (status === 'DRIVER_ASSIGNED') {
    return ['PICKED_UP', 'CANCELED'];
  }
  if (status === 'PICKED_UP') {
    return ['IN_TRANSIT', 'CANCELED'];
  }
  if (status === 'IN_TRANSIT') {
    return ['DELIVERED_WAITING_BUYER_INSPECTION', 'CANCELED'];
  }
  if (status === 'DELIVERED_WAITING_BUYER_INSPECTION') {
    return [];
  }
  if (status === 'BUYER_CONFIRMED_RECEIPT') {
    return ['COMPLETED'];
  }
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
  const quoteInfo = meta?.quoteInfo && typeof meta.quoteInfo === 'object' ? meta.quoteInfo : {};
  const isPlatform = isPlatformMovingServiceRecord(service, meta);
  const actions = getMovingNextActions(service, meta);
  const currentStatus = String(service.status || '').toUpperCase();

  summary.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
      <div>
        <p class="font-semibold">服务 #${service.id} · ${escapeHtml(service.user?.nickname || '未知用户')}</p>
        <p class="text-gray-700 mt-1">${escapeHtml(service.fromAddress || '-')} → ${escapeHtml(service.toAddress || '-')}</p>
      </div>
      <div>
        <p class="text-gray-700">联系人：${escapeHtml(service.contactName || '-')} · ${escapeHtml(maskPhone(service.contactPhone || '-'))}</p>
        <p class="text-gray-500 mt-1">配送费：${formatMoney(meta?.deliveryFee || service.estimatedCost || 0)}（${deliveryPayerLabel(
    meta?.deliveryFeePayer
  )}支付）</p>
      </div>
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
    if (hint) hint.textContent = '当前服务已到终态或等待用户侧动作，无需后台更新。';
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

  setTimeWheelValue('movingWorkflowEstimatedPickupAt', quoteInfo.estimatedPickupAt || '');
  setTimeWheelValue('movingWorkflowEstimatedDeliveryAt', quoteInfo.estimatedDeliveryAt || '');
  if (!quoteInfo.estimatedPickupAt) {
    seedTimeWheelDate('movingWorkflowEstimatedPickupAt', service.movingDate);
  }
  if (!quoteInfo.estimatedDeliveryAt) {
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
  renderMovingWorkflowPanel(preferredStatus);
  setMovingWorkflowMessage('info', `已进入服务 #${id} 的流程工作台，可直接在页面内更新。`);
  document.getElementById('movingWorkflowPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitMovingWorkflow() {
  if (state.movingWorkflowSubmitting) return;
  const serviceId = Number(state.selectedMovingServiceId || 0);
  const service = serviceId ? state.movingServicesById.get(serviceId) : null;
  if (!service) {
    setMovingWorkflowMessage('error', '请先选择一条配送/搬运服务。');
    return;
  }

  const status = getInputValue('movingWorkflowTargetStatus').toUpperCase();
  if (!status) {
    setMovingWorkflowMessage('error', '请选择要执行的流程动作。');
    return;
  }

  const reason = String(getInputValue('movingWorkflowReason') || '').trim();
  if (reason.length < 3) {
    setMovingWorkflowMessage('error', '请填写至少 3 个字符的处理原因。');
    return;
  }
  const moversName = getInputValue('movingWorkflowMoverName');
  const moversPhone = getInputValue('movingWorkflowMoverPhone');
  const movingDate = getInputValue('movingWorkflowMovingDate');
  const movingTime = getInputValue('movingWorkflowMovingTime');
  const quoteRaw = getInputValue('movingWorkflowQuote');
  const estimatedPickupAt = getInputValue('movingWorkflowEstimatedPickupAt');
  const estimatedDeliveryAt = getInputValue('movingWorkflowEstimatedDeliveryAt');
  const pickupPhotoUrls = parsePhotoUrlInput(getInputValue('movingWorkflowPickupPhotos'));
  const deliveryPhotoUrls = parsePhotoUrlInput(getInputValue('movingWorkflowDeliveryPhotos'));

  const payload = { status, reason };
  if (moversName) payload.moversName = moversName;
  if (moversPhone) payload.moversPhone = moversPhone;
  if (movingDate) payload.movingDate = movingDate;
  if (movingTime) payload.movingTime = movingTime;
  if (estimatedPickupAt) payload.estimatedPickupAt = estimatedPickupAt;
  if (estimatedDeliveryAt) payload.estimatedDeliveryAt = estimatedDeliveryAt;
  if (pickupPhotoUrls.length) payload.pickupPhotoUrls = pickupPhotoUrls;
  if (deliveryPhotoUrls.length) payload.deliveryPhotoUrls = deliveryPhotoUrls;

  if (quoteRaw) {
    const quote = Number(quoteRaw);
    if (!Number.isFinite(quote) || quote < 0) {
      setMovingWorkflowMessage('error', '配送报价格式无效，请填写非负数字。');
      return;
    }
    payload.quote = quote;
  }

  if (status === 'DELIVERY_QUOTE_CONFIRMED' && payload.quote === undefined) {
    setMovingWorkflowMessage('error', '确认报价时必须填写配送费（AUD）。');
    return;
  }

  if (!(await confirmCriticalAction(`提交服务 #${serviceId} 流程更新：${formatMovingStatusLabel(status)}`, reason))) {
    return;
  }

  const submitBtn = document.getElementById('movingWorkflowSubmitBtn');
  state.movingWorkflowSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
  }

  try {
    await apiRequest(`/admin/offline-services/moving/${serviceId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    setMovingWorkflowMessage('success', `服务 #${serviceId} 已更新为「${formatMovingStatusLabel(status)}」。`);
    await Promise.all([loadMovingServices(state.currentPage.moving), loadOfflineOverview()]);
    state.selectedMovingServiceId = serviceId;
    renderMovingWorkflowPanel();
  } catch (error) {
    setMovingWorkflowMessage('error', `更新失败：${error.message}`);
  } finally {
    state.movingWorkflowSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '提交流程更新';
    }
  }
}

function renderMovingActionButtons(service, meta) {
  const serviceId = Number(service.id);
  const defaultQuote = Number(meta?.deliveryFee || service.estimatedCost || 0);
  const actions = getMovingNextActions(service, meta);

  if (!actions.length) {
    const status = String(service.status || '').toUpperCase();
    if (status === 'DELIVERED_WAITING_BUYER_INSPECTION') {
      return `<span class="text-xs text-indigo-600">等待买家在 App 聊天页验货并确认收货</span>`;
    }
    if (status === 'DISPUTED') {
      return `<span class="text-xs text-red-600">纠纷处理中，请在纠纷处理页操作</span>`;
    }
    return `<span class="text-xs text-gray-500">当前状态无需后台操作</span>`;
  }

  return actions
    .map(
      (action) =>
        `<button onclick="openMovingWorkflow(${serviceId}, '${action}', ${defaultQuote})" class="btn-gray">${escapeHtml(
          movingStatusActionLabel(action)
        )}</button>`
    )
    .join('');
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
  const checked = state.selectedMovingIds.has(svc.id);
  const isActiveService = Number(state.selectedMovingServiceId || 0) === Number(svc.id);
  const meta = parseJsonNotes(svc.notes);
  const deliveryFeeText = meta ? formatMoney(meta.deliveryFee || 0) : 'A$0.00';
  const deliveryPayerText = deliveryPayerLabel(meta?.deliveryFeePayer);
  const statusLabel = formatMovingStatusLabel(svc.status);
  const actionButtonsHtml = renderMovingActionButtons(svc, meta);

  return `
    <div class="card ${isActiveService ? 'ring-2 ring-red-200 border border-red-300' : ''}">
      <div class="flex justify-between items-start mb-2">
        <div class="flex items-start gap-2">
          <input type="checkbox" class="moving-checkbox mt-1" ${checked ? 'checked' : ''} onchange="toggleMovingSelection(${svc.id}, this.checked)" />
          <div>
            <p class="font-semibold">服务 #${svc.id} · ${escapeHtml(svc.user?.nickname || '未知用户')}</p>
            <p class="text-sm text-gray-700">${escapeHtml(svc.fromAddress)} → ${escapeHtml(svc.toAddress)}</p>
            <p class="text-sm text-gray-700">预约：${formatDate(svc.movingDate)} ${escapeHtml(svc.movingTime || '-')}</p>
            <p class="text-xs text-gray-500">配送费：${deliveryFeeText}（${deliveryPayerText}支付）</p>
          </div>
        </div>
        <span class="px-2 py-1 rounded text-xs ${movingStatusBadgeClass(svc.status)}">${escapeHtml(statusLabel)}</span>
      </div>
      <p class="text-sm text-gray-700 mb-3">费用：${formatMoney(svc.estimatedCost)} · 联系人：${escapeHtml(svc.contactName)} ${escapeHtml(maskPhone(svc.contactPhone || '-'))}</p>
      <div class="flex gap-2 flex-wrap">
        <button onclick="openMovingWorkflow(${svc.id}, '', ${Number(meta?.deliveryFee || svc.estimatedCost || 0)})" class="btn-dark">进入流程</button>
        ${actionButtonsHtml}
      </div>
    </div>
  `;
}

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

async function batchUpdateMovingStatus(status) {
  const ids = [...state.selectedMovingIds];
  if (!ids.length) {
    setMovingWorkflowMessage('error', '请先勾选要批量处理的配送/搬运单。');
    return;
  }

  const previewItems = collectBatchPreview('.moving-checkbox', ['p.font-semibold'], 5);
  if (!(await confirmBatchPreview(`批量更新配送/搬运状态为 ${status}`, ids.length, previewItems, '线下服务 - 配送/搬运'))) return;

  const reason = await promptReason(`批量更新配送/搬运状态为 ${status}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`批量更新配送/搬运状态为 ${status}（${ids.length}条）`, reason))) return;

  try {
    await apiRequest('/admin/offline-services/moving/batch-status', {
      method: 'PATCH',
      body: JSON.stringify({ ids, status, reason }),
    });

    state.selectedMovingIds.clear();
    setMovingWorkflowMessage('success', `已批量更新 ${ids.length} 条为「${formatMovingStatusLabel(status)}」。`);
    await loadMovingServices(state.currentPage.moving);
  } catch (error) {
    setMovingWorkflowMessage('error', `批量更新失败：${error.message}`);
  }
}

async function updateMovingStatus(serviceId, status, defaultQuote = 0) {
  openMovingWorkflow(serviceId, status, defaultQuote);
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
          const checked = state.selectedStorageIds.has(order.id);
          return `
            <div class="card">
              <div class="flex justify-between items-start mb-2">
                <div class="flex items-start gap-2">
                  <input type="checkbox" class="storage-checkbox mt-1" ${checked ? 'checked' : ''} onchange="toggleStorageSelection(${order.id}, this.checked)" />
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

async function batchUpdateStorageStatus(status) {
  const ids = [...state.selectedStorageIds];
  if (!ids.length) {
    showError('请先勾选仓储订单');
    return;
  }

  const previewItems = collectBatchPreview('.storage-checkbox', ['p.font-semibold'], 5);
  if (!(await confirmBatchPreview(`批量更新仓储状态为 ${status}`, ids.length, previewItems, '线下服务 - 仓储订单'))) return;

  const reason = await promptReason(`批量更新仓储状态为 ${status}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`批量更新仓储状态为 ${status}（${ids.length}条）`, reason))) return;

  try {
    await apiRequest('/admin/offline-services/storage/batch-status', {
      method: 'PATCH',
      body: JSON.stringify({ ids, status, reason }),
    });

    state.selectedStorageIds.clear();
    await loadStorageOrders(state.currentPage.storage);
  } catch (error) {
    showError(`批量更新失败: ${error.message}`);
  }
}

async function updateStorageStatus(orderId, status) {
  const reason = await promptReason(`更新仓储单 #${orderId} 状态为 ${status}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`更新仓储状态为 ${status}`, reason))) return;

  try {
    await apiRequest(`/admin/offline-services/storage/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });

    await loadStorageOrders(state.currentPage.storage);
  } catch (error) {
    showError(`更新状态失败: ${error.message}`);
  }
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
                <button onclick="updatePinOrder(${order.id}, 'CONFIRM')" class="action-btn action-btn-green">确认支付</button>
                <button onclick="updatePinOrder(${order.id}, 'FAIL')" class="action-btn action-btn-red">标记失败</button>
                <button onclick="updatePinOrder(${order.id}, 'CANCEL_PIN')" class="action-btn action-btn-red">取消置顶</button>
                <button onclick="updatePinOrder(${order.id}, 'EXTEND_24H')" class="action-btn action-btn-blue">延长24h</button>
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
  const reason = await promptReason(`置顶订单操作：${action}`, true);
  if (reason === null) return;
  if (!(await confirmCriticalAction(`置顶订单执行 ${action}`, reason))) return;

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
    title: '发放会员',
    label: '用户ID',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || 0);
  if (!userId) return;
  const mode = ((await promptText('发放模式（CONFIRM/PENDING）', 'CONFIRM', {
    title: '发放会员',
    label: '发放模式',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || 'CONFIRM').toUpperCase();
  const reason = await promptReason('发放会员原因', true);
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
  const rewardType = ((await promptText('奖励类型（PIN_CREDIT / MEMBERSHIP_30D / POINTS / BALANCE）', 'PIN_CREDIT', {
    title: '发放奖励',
    label: '奖励类型',
    confirmText: '继续',
    confirmVariant: 'dark',
  })) || '').toUpperCase();
  if (!rewardType) return;
  const rewardValue = (await promptText('奖励值（例如 PIN_24H / 100 / 10.00）', '', {
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

async function loadFeatureFlags() {
  try {
    const data = await apiRequest('/admin/feature-flags');
    const flags = data.flags || {};
    const setCheckbox = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(value);
    };
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    };

    setCheckbox('flagBatchPublishEnabled', flags.batchPublishEnabled);
    setCheckbox('flagPaidPinEnabled', flags.paidPinEnabled);
    setCheckbox('flagMembershipPurchaseEnabled', flags.membershipPurchaseEnabled);
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
  } catch (error) {
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
    paidPinEnabled: getCheckbox('flagPaidPinEnabled'),
    membershipPurchaseEnabled: getCheckbox('flagMembershipPurchaseEnabled'),
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
  await fetchCsrfToken();

  if (authToken && adminUser) {
    document.getElementById('loginModal')?.classList.add('hidden');
    document.getElementById('mainContent')?.classList.remove('hidden');
    setText('adminName', adminUser.nickname || adminUser.email || '管理员');

    try {
      await apiRequest('/admin/stats');
      await showSection('dashboard');
    } catch (error) {
      showError('管理员会话已失效，请重新登录');
      logout();
    }
  }
};
