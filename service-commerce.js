/* New warehouse/consignment operations. No ordinary marketplace mutation paths. */
window.ServiceCommerceAdmin = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format((n||0)/100);
  const time = x => x ? new Date(x).toLocaleString('zh-CN',{hour12:false}) : '—';
  const uid = () => crypto.randomUUID();
  const labels = {SPLIT:'已拆为逐件记录 · 原批次只读',STORE:'寄存',CONSIGN:'寄卖',BUYOUT:'直接回收',AWAITING_RECEIPT:'待入库',RECEIPT_EXCEPTION:'入库差异',IN_STORAGE:'保管中',STORED:'寄存中',STORED_PENDING_TERMS:'待确认委托',READY_FOR_LISTING:'待上架',AWAITING_CONSIGNMENT_AUTH:'待寄卖授权',RETURN_REQUESTED:'申请取回',TERMS_OFFERED:'委托待确认',CONSIGNMENT_EXPIRED:'寄卖委托已到期',STORAGE_EXPIRED:'寄存已到期',BUYOUT_PAYMENT_HOLD:'回收待结算',BUYOUT_FUNDS_CONFIRMED:'回收款已确认 · 待转平台库存',BUYOUT_COMPLETED:'回收完成 · 已转平台库存',PARTIALLY_OUTBOUND:'已部分出库',ISSUE:'有待处理问题',OUTBOUND_PENDING:'出库进行中',OUTBOUND_COMPLETE:'全部已出库',LISTED:'已上架',SALE_RESERVED:'购买占用中',AWAITING_SETTLEMENT:'待结算',PAYOUT_PROCESSING:'回款处理中',PAYOUT_SENT:'已核账待到账确认',PAYOUT_RECEIVED:'货主已确认到账',OFFERED:'待领取人确认',ACCEPTED:'已授权待出库',DISPATCHED:'已出库待收货',RECEIVED:'已确认收到',CANCELLED:'已取消',PROPOSED:'待货主授权',AUTHORIZED:'待审核发布',PUBLISHED:'已公开上架',WITHDRAWN:'已停止展示',RESERVED:'预约未付款',CONFIRMED:'已确认购买',DELIVERED:'已收货',REQUESTED:'待处理',PROCESSING:'处理中',UNKNOWN:'结果待核实',FAILED:'已核实失败',SENT:'核账完成待确认',PENDING:'待处理',DECLINED:'已拒绝',RESOLVED:'已处理',FEE_RECEIPT:'服务预付款入账',FEE_REFUND:'服务费退款',SALE_RECEIPT:'寄卖货款入账',SALE_REFUND:'寄卖货款退款',PAYOUT_BANK_RETURN:'银行退回冲正',PAYOUT:'寄卖回款',RETURN:'取回',EXTEND:'续存'};
  const label = x => labels[x] || x || '—';
  let epoch=0, listSeq=0, detailSeq=0, active=false, busy=false, pending=null, detail=null, selected=null, tab='overview', nextCursor=null, listCursor=null;
  const controllers=new Set(),urls=new Set(),viewed=new Set();
  const isCurrent=(g,t)=>active && epoch===g && authToken===t && !!t && state.currentSection==='serviceCommerce';
  function revoke(){for(const u of urls)URL.revokeObjectURL(u);urls.clear();viewed.clear();}
  function clear(){epoch++;active=false;for(const c of controllers)c.abort();controllers.clear();revoke();busy=false;pending=null;detail=null;selected=null;nextCursor=null;listCursor=null;const d=$('scDialog');if(d?.open)d.close();if($('scList'))$('scList').replaceChildren();if($('scDetail'))$('scDetail').replaceChildren();if($('scPhotoPreview'))$('scPhotoPreview').replaceChildren();if($('scStatus'))$('scStatus').textContent='';if(d)d.replaceChildren();}
  function status(message,error=false){const e=$('scStatus');e.textContent=message;e.className=error?'sc-error':'sc-muted';}
  async function request(path,{body,method,raw=false,type}={}){
    const g=epoch,t=authToken,c=new AbortController();if(!isCurrent(g,t))throw new Error('当前管理会话已变化。');controllers.add(c);const timer=setTimeout(()=>c.abort(),25000);
    try{
      const r=await fetch(API_BASE_URL+path,{method:method|| (body?'POST':'GET'),body:body?(raw?body:JSON.stringify(body)):undefined,credentials:'omit',cache:'no-store',redirect:'error',signal:c.signal,headers:{Authorization:'Bearer '+t,...(body?{'Content-Type':type||'application/json'}:{})}});
      if(!isCurrent(g,t))throw new Error('当前管理会话已变化。');
      if(!r.ok){const payload=await r.json().catch(()=>({}));const e=new Error(payload.error||'暂时无法确认结果。');e.status=r.status;throw e;}
      const result=await r.json();if(!isCurrent(g,t))throw new Error('当前管理会话已变化。');return result;
    }finally{clearTimeout(timer);controllers.delete(c);}
  }
  const button=(action,text,disabled=false,extra='')=>`<button type="button" data-sc-action="${esc(action)}" ${disabled?'disabled':''} ${extra}>${esc(text)}</button>`;
  const kv=(name,value)=>`<div class="sc-kv"><span>${esc(name)}</span><span>${esc(value)}</span></div>`;
  const card=(title,body)=>`<article class="sc-card"><h3>${esc(title)}</h3>${body}</article>`;
  const message=x=>`<p class="sc-muted">${esc(x)}</p>`;
  function renderShell(){
    $('serviceCommerceSection').innerHTML=`<div class="sc-head"><div><h2>仓储与寄卖</h2><p class="sc-muted">费用、实际出库与寄卖回款 · 独立于普通商品交易</p></div>${button('refresh','刷新当前记录')}</div>
      <p id="scFlags" class="sc-notice"></p><form id="scSearch" class="sc-tools" style="margin-top:16px"><input name="q" aria-label="库存名称或编号" placeholder="搜索库存名称或完整编号" maxlength="120"><select name="kind" aria-label="服务类型"><option value="">全部类型</option><option value="STORE">寄存</option><option value="CONSIGN">寄卖</option><option value="BUYOUT">回收</option></select><select name="queue" aria-label="待办队列"><option value="">全部库存</option><option value="SETUP">待完善入库或计费</option><option value="RETURN">待处理取回</option><option value="LISTING">待审核发布</option><option value="PAYOUT">回款待办</option><option value="ISSUE">待处理问题</option></select><button class="sc-primary">检索</button></form>
      <p id="scStatus" role="status" aria-live="polite" class="sc-muted"></p><div id="scPending"></div><div class="sc-layout"><div><div id="scList" class="sc-list"></div><div id="scPages" class="sc-tools" style="margin-top:12px"></div></div><div id="scDetail" aria-live="polite">${card('选择一件库存',message('从左侧打开已有交接库存，核对货主、委托与金额后再操作。'))}</div></div><div id="scPhotoPreview" class="sc-photo-grid"></div><dialog id="scDialog" aria-labelledby="scDialogTitle"></dialog>`;
    $('scSearch').onsubmit=e=>{e.preventDefault();if(pending||busy)return status('请先核对当前未完成操作。',true);loadList();};
    $('scDialog').addEventListener('cancel',e=>{if(busy||pending)e.preventDefault();});
  }
  const inventoryRow=i=>`<button type="button" class="sc-row" data-sc-open="${esc(i.id)}" aria-pressed="${i.id===selected}"><strong>${esc(i.name)}</strong><p>${esc(label(i.kind))} · ${esc(i.remainingQuantity)}件 · ${esc(label(i.status))}</p><span class="sc-muted">货主 #${esc(i.ownerId)} · ${esc(i.warehouse||'尚未登记仓库')}</span><div>${[i.pendingReturn?'待取回':null,i.pendingListing?'待审核':null,i.pendingPayout?'回款待办':null,i.hasIssue?'问题待处理':null].filter(Boolean).map(x=>`<span class="sc-badge">${x}</span>`).join('')}</div></button>`;
  async function open(){clear();active=true;renderShell();await loadList();}
  async function loadList(cursor){
    const g=epoch,t=authToken,seq=++listSeq;status('正在读取库存…');
    try{const q=new URLSearchParams();for(const[k,v]of new FormData($('scSearch')))if(v)q.set(k,v);if(cursor)q.set('cursor',cursor);
      const d=await request('/service-commerce/admin/inventory?'+q);if(!isCurrent(g,t)||seq!==listSeq)return;
      $('scFlags').textContent=`入库操作${d.inventoryEnabled?'已开放':'未开放'}；账单与寄卖操作${d.commerceEnabled?'已开放':'未开放'}；资金核账${d.manualReconciliationEnabled?'已开放（人工核对）':'未开放'}。本页登记事实与流水，不执行银行转账，不代替货主或买家确认。`;
      $('scList').innerHTML=d.items.map(inventoryRow).join('')||message('没有符合条件的库存。');
      listCursor=cursor;nextCursor=d.nextCursor;$('scPages').innerHTML=button('first','回到首批')+(nextCursor?button('next','下一批'): '');status(`已载入 ${d.items.length} 件库存${nextCursor?'，后面还有记录':''}。`);
    }catch(e){if(isCurrent(g,t)&&seq===listSeq)status(e.message,true);}
  }
  async function openDetail(id){if(pending||busy)return status('请先核对当前未确认操作，再切换库存。',true);selected=id;for(const row of $('scList').querySelectorAll('[data-sc-open]'))row.setAttribute('aria-pressed',String(row.dataset.scOpen===id));tab='overview';await reloadDetail();}
  async function reloadDetail(){
    if(!selected)return loadList();const g=epoch,t=authToken,id=selected,seq=++detailSeq;status('正在核对最新记录…');
    try{const d=await request('/service-commerce/admin/inventory/'+id);if(!isCurrent(g,t)||id!==selected||seq!==detailSeq)return;detail=d;revoke();$('scPhotoPreview').replaceChildren();
      if(pending&&d.operationIds[pending.scope]?.includes(pending.body?.operationId)){pending=null;status('服务器已确认原操作成功。');}else status('记录已刷新。');renderDetail();renderPending();
    }catch(e){if(isCurrent(g,t)&&seq===detailSeq)status(e.message,true);}
  }
  function renderDetail(){
    const {inventory:i,flow:f}=detail;if(i.splitChildIds){$('scDetail').innerHTML=card(i.name,message('原批次已拆为逐件记录，仅供追溯，不再出账或出售。')+i.splitChildIds.map(id=>`<button class="sc-row" type="button" data-sc-open="${esc(id)}">查看单件 · ${esc(id.slice(-6))}</button>`).join('')+kv('原首次入库',time(i.firstReceivedAt)));return;}const tabs=[['overview','概览与委托'],['bills','费用账单'],['release','实际出库'],['listing','寄卖审核'],['funds','核账与回款'],['issues','问题与记录']];
    const header=card(i.name,kv('库存编号',i.id)+kv('货主 / 类型',`#${i.ownerId} / ${label(i.kind)}`)+(i.status?kv('当前进度',label(i.status)):'')+kv('剩余数量',`${f?.remainingQuantity??i.receipt?.quantity??0} 件`)+message(detail.unavailableReason||'所有确认使用当前记录；并发更新会要求重新核对。'));
    const b=(a,t,off=false,extra='')=>button(a,t,off||busy||!!pending,extra);
    const commerceOff=!f||!detail.commerceEnabled,inventoryOff=!detail.inventoryEnabled,financialOff=commerceOff||!detail.manualReconciliationEnabled;
    let content='';
    if(tab==='overview'){
      content=card('接收与凭证',i.receipt?kv('仓库',i.receipt.warehouse)+kv('接收情况',i.receipt.condition==='MATCH'?'与交接一致':'有损坏或差异')+kv('首次入库',time(i.firstReceivedAt))+kv('原接收数量 / 体积',`${i.receipt.quantity} 件 / ${i.receipt.volumeLitres/1000} m³`)+message(i.receipt.note):message('尚未登记仓库接收。'));
      content+=card('入库操作',`<div class="sc-tools">${b('receive',i.receipt?'更正入库差异':'登记接收入库',inventoryOff||!!i.activeTerms||!!i.receipt&&i.receipt.condition==='MATCH'&&i.receipt.quantity===i.quantity)}${b('upload','上传凭证照片',inventoryOff)}</div>`+photoList(detail.photos));
      content+=card('当前已确认委托',i.activeTerms?kv('类型 / 数量',`${label(i.activeTerms.kind)} / ${i.activeTerms.scopeQuantity??i.receipt.quantity} 件`)+kv('有效至',i.activeTerms.endsOn)+kv('仓储费上限',money(i.activeTerms.storageFeeCapCents))+kv('成交佣金',`${i.activeTerms.commissionBasisPoints/100}%`)+message(i.activeTerms.storageTerms):message('货主尚未确认委托。'));
      if(i.offeredTerms)content+=card('待货主确认的委托',kv('有效至',i.offeredTerms.endsOn)+message(i.offeredTerms.storageTerms));
      content+=b('terms','提供新委托 / 续期方案',inventoryOff||!i.receipt||i.kind==='BUYOUT');
      content+=i.requests.map(q=>card(`${label(q.kind)}申请 · ${label(q.status)}`,kv('数量 / 日期',`${q.quantity} 件 / ${q.requestedDate}`)+message(q.note)+message(q.response||'')+(['PENDING','PROCESSING'].includes(q.status)?b('respond','答复申请',inventoryOff,`data-id="${esc(q.id)}"`):''))).join('');
    }
    if(tab==='bills'&&f){
      const rate=p=>p?kv('核算开始',time(p.from))+kv('首次入库免费额度',`${p.freeHours} 小时`)+kv('累计上限',money(p.capCents))+p.tiers.map(x=>kv(`连续满 ${x.fromDay} 天起`,`${money(x.centsPerM3Per30Days)}/m³/30天`)).join('')+message(p.note):message('尚未确认费率；本页不预设正式价格。');
      content=card('已确认计费规则',rate(f.rate))+ (f.offeredRate?card('待货主确认的新费率',rate(f.offeredRate)):'')+`<div class="sc-tools">${b('rate','提供计费方案',commerceOff)}${b('bill','生成阶段 / 最终账单',commerceOff||!f.rate)}</div>`;
      content+=f.bills.map(x=>card(x.final?'最终仓储账单':'阶段仓储账单',kv('账期',`${time(x.from)} → ${time(x.to)}`)+kv('本账期仓储费',money(x.amountCents))+kv('上限减免',money(x.capReductionCents))+message(x.acceptedAt?'货主曾核对：'+time(x.acceptedAt):'尚无货主最终结算确认')+`<details><summary>展开逐段计算</summary><div class="sc-scroll"><table class="sc-table"><thead><tr><th>时段</th><th>体积</th><th>每 m³/30天</th><th>本段费用</th></tr></thead><tbody>${x.lines.map(l=>`<tr><td>${esc(time(l.from))}<br>${esc(time(l.to))}</td><td>${l.volumeLitres/1000} m³</td><td>${esc(money(l.rateCents))}</td><td>${esc(money(l.amountCents))}</td></tr>`).join('')}</tbody></table></div></details>`)).join('');
    }
    if(tab==='release'&&f){
      content=message('方案先由对应领取人确认。登记实际出库才扣减库存，平台不能代替领取人确认收到。')+`<div class="sc-tools">${b('return','提供取回方案',commerceOff)}${b('saleRelease','安排寄卖买家取货',commerceOff||f.sale?.status!=='CONFIRMED')}${b('upload','上传出库凭证',inventoryOff)}</div>`;
      content+=f.releases.map(r=>card(`${r.purpose==='RETURN'?'货主取回':'寄卖交付'} · ${label(r.status)}`,kv('数量 / 领取人',`${r.quantity} 件 / ${r.recipient}`)+kv('预约时段',r.window)+kv('授权有效至',time(r.expiresAt))+kv('服务费 / 付款安排',`${money(r.feeCents)} / ${r.feeHandling==='PREPAID'?'先核实结清':'已约定后付'}`)+message(r.note)+photoList(detail.photos.filter(p=>r.evidenceIds.includes(p.id)))+(r.status==='ACCEPTED'?b('dispatch','登记实际出库',commerceOff,`data-id="${esc(r.id)}"`):''))).join('');
    }
    if(tab==='listing'&&f){const l=f.listing;
      content=message('仅使用货主授权的本次商品图片与内容。修改资料会重新等待货主确认，不直接改写在售内容。')+b('listing','准备 / 更新寄卖资料',commerceOff||i.kind!=='CONSIGN');
      if(l)content+=card(label(l.status),kv('公开标题',l.title)+message(l.description)+kv('整批数量 / 售价',`${l.quantity} 件 / ${money(l.priceCents)}`)+kv('区域',l.region)+kv('货主授权',time(l.authorizedAt))+photoList(detail.photos.filter(p=>l.photoIds.includes(p.id)))+`<div class="sc-tools">${b('reviewPhotos','核查本次全部商品照片')}${b('publish','审核通过并上架',commerceOff||l.status!=='AUTHORIZED')}${b('withdraw','停止公开展示',!['AUTHORIZED','PUBLISHED','PROPOSED'].includes(l.status))}</div>`);
      if(f.sale)content+=card('当前销售',kv('状态',label(f.sale.status))+kv('买家',`#${f.sale.buyerId}`)+kv('确认购买',time(f.sale.confirmedAt))+kv('总价',money(f.sale.listing.priceCents)));
    }
    if(tab==='funds'&&f){const t=f.totals;
      content=card('累计费用与货主回款',Object.entries({仓储费:t.storageCents,已履行取回费:t.transportCents,成交佣金:t.commissionCents,费用合计:t.totalFeeCents,'服务预付款（扣除退款）':t.prepaidCents,已抵扣预付款:t.creditAppliedCents,剩余待扣费用:t.feeDueCents,'销售收入（扣除退款）':t.salesReceivedCents,货主净回款:t.ownerNetCents,已核账打款:t.ownerPaidCents,可申请回款:t.availablePayoutCents,多付服务费待退:t.prepaymentRefundDueCents,仍需补付服务费:t.additionalFeeDueCents,退款后需核对差额:t.recoveryDueCents}).map(([k,v])=>kv(k,money(v))).join('')+message(f.bills.length?'金额变化后需要货主重新核对结算。':'仓储账单尚未生成，当前金额不代表免费。'));
      content+=card('人工资金核账',message('仅登记已经核实的渠道流水；此按钮不收款、不退款、不向银行转账。预约款不可重复作为仓储预付款入账。')+b('money','登记已核实的收款 / 退款',financialOff));
      content+=f.payouts.map(p=>card(`回款 · ${label(p.status)}`,kv('金额',money(p.amountCents))+kv('申请时间',time(p.requestedAt))+message(p.note||'')+`<div class="sc-tools">${p.status==='REQUESTED'?b('beginPayout','开始处理原回款',financialOff||!t.settlementReady,`data-id="${esc(p.id)}"`):''}${['PROCESSING','UNKNOWN'].includes(p.status)?b('payoutResult','登记待核实 / 已核实失败',commerceOff,`data-id="${esc(p.id)}"`)+b('payoutMoney','登记原打款已核实',financialOff,`data-id="${esc(p.id)}"`):''}</div>`)).join('');
      content+=card('资金记录',f.money.length?f.money.map(m=>kv(`${time(m.at)} · ${label(m.kind)}`,money(m.amountCents))+message(m.note)).join(''):message('暂无实际流水核账记录。'));
    }
    if(tab==='issues'&&f){
      content=f.issues.map(x=>card(x.resolvedAt?'已记录处理结果':'问题待处理',message(x.note)+kv('提出时间',time(x.at))+message(x.resolution||'')+(!x.resolvedAt?b('resolve','记录问题处理结果',commerceOff,`data-id="${esc(x.id)}"`):''))).join('')||message('暂无问题记录。');
      content+=card('完整操作时间线',[...f.events,...i.events].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).map(e=>`<p>${esc(e.message)}</p><p class="sc-muted">${esc(time(e.at))}${e.actorId?' · 操作人 #'+esc(e.actorId):''}</p><hr>`).join(''));
    }
    if(!content)content=message(detail.unavailableReason||'请先完成入库与委托。');
    $('scDetail').innerHTML=header+`<div class="sc-tabs" role="tablist">${tabs.map(([k,n])=>`<button type="button" role="tab" data-sc-tab="${k}" aria-selected="${k===tab}">${n}</button>`).join('')}</div><div role="tabpanel">${content}</div>`;
  }
  function photoList(photos){return photos.length?`<div class="sc-tools">${photos.map(p=>button('photo',p.caption,false,`data-id="${esc(p.id)}"`)).join('')}</div>`:message('尚无照片。请先上传并核查凭证。');}
  async function showPhotos(ids){
    const g=epoch,t=authToken,id=selected,host=$('scPhotoPreview');host.replaceChildren();
    try{for(const pid of ids){const c=new AbortController();controllers.add(c);const timer=setTimeout(()=>c.abort(),20000);try{
      const r=await fetch(`${API_BASE_URL}/service-inventory/${id}/evidence/${pid}`,{headers:{Authorization:'Bearer '+t},credentials:'omit',cache:'no-store',redirect:'error',signal:c.signal});
      if(!r.ok||!/^image\/(png|jpeg)(;|$)/i.test(r.headers.get('Content-Type')||''))throw new Error('照片读取失败，请重试。');
      const reader=r.body.getReader(),chunks=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>2*1024*1024)throw new Error('照片过大。');chunks.push(p.value);}}finally{await reader.cancel().catch(()=>{});}
      if(!isCurrent(g,t)||id!==selected)return;const url=URL.createObjectURL(new Blob(chunks,{type:r.headers.get('Content-Type')}));urls.add(url);const img=document.createElement('img');img.alt=detail.photos.find(p=>p.id===pid)?.caption||'物品凭证';img.src=url;await img.decode();if(!isCurrent(g,t)||id!==selected){URL.revokeObjectURL(url);return;}host.append(img);viewed.add(pid);
    }finally{clearTimeout(timer);controllers.delete(c);}}
    status('照片已载入页面下方，可核对后提交。');host.scrollIntoView({block:'nearest'});
    }catch(e){if(isCurrent(g,t))status(e.message,true);}
  }
  const field=(name,title,type='text',value='',extra='')=>`<label class="sc-field ${type==='textarea'?'sc-wide':''}"><span>${esc(title)}</span>${type==='textarea'?`<textarea name="${name}" required rows="3" maxlength="2000">${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" required ${type==='datetime-local'?'step="1"':''} ${extra}>`}</label>`;
  const select=(name,title,options)=>`<label class="sc-field"><span>${esc(title)}</span><select name="${name}" ${name==='requestId'&&options[0]?.[0]===''?'':'required'}>${options.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`;
  const localDate=x=>{const d=new Date(x);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,19);};
  const decimal=(name,title,v='')=>field(name,title,'number',v,'min="0" max="1000000" step="0.01"');
  const quantity=(name,title,v='')=>field(name,title,'number',v,'min="0" max="1000000" step="1"');
  function photoChecks(){return `<fieldset class="sc-wide"><legend>选择本次使用的照片（1—6 张）</legend>${detail.photos.map(p=>`<label class="sc-check"><input type="checkbox" name="photos" value="${esc(p.id)}">${esc(p.caption)}</label>`).join('')||message('请先上传照片。')}</fieldset>`;}
  function formFor(action,id){
    const i=detail.inventory,f=detail.flow,expiry=localDate(Date.now()+24*3600000);let title='',html='',scope='commerce';const notes=()=>field('note','说明 / 核对依据','textarea');
    switch(action){
      case 'rate':title='提供计费方案';html=quantity('freeHours','首次入库起免费小时数')+decimal('cap','累计仓储费上限（A$）')+field('expires','确认有效至（本机时间）','datetime-local',expiry)+notes()+`<div class="sc-wide"><h4>连续时长阶梯 · 费率为 A$/m³/30天</h4><div id="scTiers"></div>${button('addTier','增加阶梯')}</div>`;break;
      case 'bill':title='生成仓储账单';html=field('to','账单截至（本机时间）','datetime-local',localDate(Date.now()))+select('final','账单类型',[['false','阶段账单'],['true','最终账单（全部实际出库后）']]);break;
      case 'return':title='提供货主取回方案';html=select('requestId','关联取回申请',i.requests.filter(q=>q.kind==='RETURN'&&['PENDING','PROCESSING'].includes(q.status)).map(q=>[q.id,`${q.quantity} 件 · ${q.requestedDate}`]))+quantity('quantity','本次出库数量')+field('volume','出库后剩余体积（m³）','number','','min="0" max="1000" step="0.001"')+decimal('fee','本次取回服务费（A$）')+select('handling','付款安排',[['PREPAID','先核实结清费用'],['DEFERRED','明确约定后付']])+field('recipient','领取人')+field('window','预约时段 / 地点说明')+field('expires','授权有效至','datetime-local',expiry)+notes();break;
      case 'saleRelease':title='安排寄卖买家自取';html=field('window','仓库地址与预约时段')+field('expires','授权有效至','datetime-local',expiry);break;
      case 'dispatch':title='登记实际出库';html=(detail.pickupAuthorizations||[]).filter(g=>g.releaseId===id).map(g=>message('代取人：'+g.recipientName+' · 手机尾号 '+g.phoneLast4+' · 有效至 '+time(g.expiresAt))).join('')+message('只有已经核对领取人并完成实物交付后提交。此操作扣减库存；由领取人另行确认收到。')+field('unitIds','本次实物标签（已编号物品须逐件填写，每行一个 RU 编号；未编号可留空）','textarea').replace(' required','')+field('pickupCode','代取领取码（没有代取授权可留空）').replace(' required','')+'<label class="sc-check"><input type="checkbox" name="recipientChecked">如为代取，已按授权记录核对代取人姓名与手机尾号</label>'+photoChecks()+notes();break;
      case 'listing':title='准备寄卖资料';html=field('title','公开商品名称','text',i.name)+field('description','公开描述','textarea')+decimal('price','本条库存整批售价（A$）')+field('region','公开区域（不填私人详细地址）')+photoChecks();break;
      case 'publish':if(!f.listing.photoIds.every(x=>viewed.has(x)))throw new Error('请先点击“核查本次全部商品照片”，逐张查看后审核。');title='审核通过并上架';html=message(`本次上架：${f.listing.title}，${f.listing.quantity} 件，${money(f.listing.priceCents)}。货主已授权本版本。`)+notes();break;
      case 'withdraw':title='停止公开展示';html=notes();break;
      case 'money':title='登记已核实资金流水';html=select('kind','流水类型',[['FEE_RECEIPT','服务预付款入账'],['FEE_REFUND','服务费退款'],['SALE_RECEIPT','寄卖货款入账'],['SALE_REFUND','寄卖货款退款']])+decimal('amount','本笔金额（A$）')+field('reference','渠道流水唯一编号（不填银行卡号）')+notes();break;
      case 'payoutMoney':title='登记原回款已核实';html=message(`原申请金额：${money(f.payouts.find(p=>p.id===id).amountCents)}。只核对原笔打款，不再转账。`)+field('reference','原打款渠道流水编号（不填银行卡号）')+notes();break;
      case 'beginPayout':title='开始处理原回款';html=message(`锁定原申请 ${money(f.payouts.find(p=>p.id===id).amountCents)}，进入处理中；本操作不会向银行付款。`);break;
      case 'payoutResult':title='核对原回款结果';html=select('outcome','已核对结果',[['UNKNOWN','暂未确认，保持金额锁定'],['FAILED','已确认失败，没有打款成功']])+notes();break;
      case 'resolve':title='记录问题处理结果';html=message('保留原问题与账务事实。退款须在核实渠道结果后另行登记，出库事实不会自动撤回。')+notes();break;
      case 'upload':title='上传物品凭证';scope='upload';html=field('caption','照片用途 / 说明')+field('file','JPEG / PNG，单张不超过 1 MB','file','','accept="image/png,image/jpeg"');break;
      case 'receive':title=i.receipt?'更正未确认委托的入库差异':'登记接收入库';scope='inventory';html=quantity('quantity','实际收到件数')+field('volume','实际占用体积（m³）','number','','min="0" max="1000" step="0.001"')+field('warehouse','仓库与库位')+select('condition','与交接清单核对',[['MATCH','一致'],['DAMAGE','存在损坏 / 差异']])+photoChecks()+notes();break;
      case 'terms':title='提供委托 / 续期方案';scope='inventory';html=select('kind','服务类型',i.kind==='CONSIGN'?[['CONSIGN','寄卖']]:[['STORE','寄存'],['CONSIGN','寄卖']])+select('requestId','关联申请',[['','无关联申请'],...i.requests.filter(q=>['PENDING','PROCESSING'].includes(q.status)&&q.kind!=='RETURN').map(q=>[q.id,`${label(q.kind)} · ${q.quantity} 件`])])+field('endsOn','委托截止日','date')+field('expires','确认有效至','datetime-local',expiry)+decimal('cap','累计仓储费上限（A$）')+select('paymentMode','费用支付方式',[['PREPAID','事先支付'],['DEDUCT_SALE','寄卖售出后扣除']])+decimal('asking','整批挂牌价（寄存填 0）')+decimal('minimum','最低接受价（寄存填 0）')+decimal('commission','成交佣金百分比（寄存填 0）')+field('storageTerms','仓储收费说明','textarea')+field('unsoldTerms','未售出物品处理约定','textarea')+field('returnTerms','取回与费用约定','textarea')+field('settlementTerms','结算约定','textarea');break;
      case 'respond':title='答复服务申请';scope='inventory';html=select('outcome','处理结果',[['PROCESSING','继续核对安排'],['DECLINED','说明无法受理原因']])+notes();break;
      default:throw new Error('请选择有效操作。');
    }
    const d=$('scDialog');d.innerHTML=`<h3 id="scDialogTitle">${esc(title)}</h3><p class="sc-muted">${esc(i.name)} · 货主 #${i.ownerId}</p><form id="scForm"><div class="sc-form-grid">${html}</div><label class="sc-check"><input type="checkbox" name="checked" required>我已核对清单、金额与实际情况；本次提交不代替客户确认。</label><p id="scFormError" class="sc-error" role="alert"></p><div class="sc-footer">${button('closeDialog','取消')}<button class="sc-primary">核对本次提交</button></div></form>`;
    if(action==='rate')addTier(0);d.showModal();
    $('scForm').onsubmit=e=>{e.preventDefault();try{const data=new FormData(e.currentTarget),command=makeCommand(action,id,data),revision=scope==='inventory'?detail.inventory.revision:detail.flow?.revision;
      const payload={operationId:uid(),revision,...command};const summary=[...e.currentTarget.querySelectorAll('.sc-field')].map(l=>({name:l.querySelector('span').textContent,value:l.querySelector('select')?.selectedOptions[0]?.textContent||l.querySelector('input,textarea')?.value||''}));
      showConfirmation({action,title,scope,payload,summary,photos:data.getAll('photos'),file:data.get('file'),caption:data.get('caption')});
    }catch(error){$('scFormError').textContent=error.message;}};
  }
  function addTier(day=''){const e=document.createElement('div');e.className='sc-tier';e.innerHTML=`<input type="number" name="tierDay" aria-label="阶梯起始天数" min="0" max="3650" step="1" required value="${day}"><input type="number" name="tierRate" aria-label="阶梯费率" min="0" max="1000000" step="0.01" required placeholder="A$/m³/30天">${button('removeTier','移除')}`;$('scTiers').append(e);}
  function number(v,scale=1){const s=String(v??'').trim(),places=scale===100?2:scale===1000?3:0;if(!new RegExp('^\\d+(?:\\.\\d{1,'+(places||1)+'})?$').test(s)||(!places&&s.includes('.')))throw new Error('请输入有效的非负数字，金额最多两位小数。');const [a,b='']=s.split('.');const n=Number(a)*scale+Number(b.padEnd(places,'0')||0);if(!Number.isSafeInteger(n)||n>100000000)throw new Error('数值超出范围。');return n;}
  function makeCommand(a,id,d){const s=n=>String(d.get(n)||'').trim(),n=k=>number(s(k)),m=k=>number(s(k),100),stamp=k=>{const date=new Date(s(k));if(!Number.isFinite(date.getTime()))throw new Error('请填写有效时间。');return date.toISOString();},photos=()=>{const v=d.getAll('photos');if(v.length<1||v.length>6)throw new Error('请选择 1—6 张照片。');return v;};
    switch(a){
      case 'rate':{const days=d.getAll('tierDay'),rates=d.getAll('tierRate');if(days.length<1||days.length>12)throw new Error('需要 1—12 档阶梯。');return {action:'OFFER_RATE',plan:{id:uid(),expiresAt:stamp('expires'),freeHours:n('freeHours'),capCents:m('cap'),tiers:days.map((x,i)=>({fromDay:number(x),centsPerM3Per30Days:number(rates[i],100)})),note:s('note')}};}
      case 'bill':return {action:'ISSUE_BILL',to:stamp('to'),final:s('final')==='true'};
      case 'return':return {action:'OFFER_RELEASE',releaseId:uid(),requestId:s('requestId'),quantity:n('quantity'),remainingVolumeLitres:number(s('volume'),1000),feeCents:m('fee'),feeHandling:s('handling'),window:s('window'),expiresAt:stamp('expires'),recipient:s('recipient'),note:s('note')};
      case 'saleRelease':return {action:'PREPARE_SALE_RELEASE',releaseId:uid(),window:s('window'),expiresAt:stamp('expires')};
      case 'dispatch':return {action:'DISPATCH',releaseId:id,...(s('unitIds')?{unitIds:s('unitIds')}:{}),...(s('pickupCode')?{pickupCode:s('pickupCode'),recipientChecked:!!d.get('recipientChecked')}:{}),evidenceIds:photos(),note:s('note')};
      case 'listing':return {action:'PROPOSE_LISTING',listingId:uid(),title:s('title'),description:s('description'),priceCents:m('price'),region:s('region'),photoIds:photos()};
      case 'publish':return {action:'PUBLISH',listingId:detail.flow.listing.id,reviewNote:s('note')};
      case 'withdraw':return {action:'WITHDRAW_LISTING',reason:s('note')};
      case 'money':return {action:'RECONCILE_MONEY',kind:s('kind'),reference:s('reference'),amountCents:m('amount'),note:s('note')};
      case 'payoutMoney':return {action:'RECONCILE_MONEY',kind:'PAYOUT',payoutId:id,amountCents:detail.flow.payouts.find(p=>p.id===id).amountCents,reference:s('reference'),note:s('note')};
      case 'beginPayout':return {action:'BEGIN_PAYOUT',payoutId:id};
      case 'payoutResult':return {action:'PAYOUT_RESULT',payoutId:id,outcome:s('outcome'),note:s('note')};
      case 'resolve':return {action:'RESOLVE_ISSUE',issueId:id,note:s('note')};
      case 'receive':return {action:detail.inventory.receipt?'RESOLVE_RECEIPT':'RECEIVE',receipt:{quantity:n('quantity'),volumeLitres:number(s('volume'),1000),warehouse:s('warehouse'),condition:s('condition'),note:s('note'),evidenceIds:photos()},...(detail.inventory.receipt?{reason:s('note')}:{})};
      case 'terms':return {action:'OFFER_TERMS',terms:{id:uid(),kind:s('kind'),expiresAt:stamp('expires'),endsOn:s('endsOn'),storageTerms:s('storageTerms'),storageFeeCapCents:m('cap'),paymentMode:s('paymentMode'),askingPriceCents:m('asking'),minimumPriceCents:m('minimum'),commissionBasisPoints:m('commission'),unsoldTerms:s('unsoldTerms'),returnTerms:s('returnTerms'),settlementTerms:s('settlementTerms'),requestId:s('requestId')||null}};
      case 'respond':return {action:'RESPOND_REQUEST',requestId:id,outcome:s('outcome'),message:s('note')};
      case 'upload':{const f=d.get('file');if(!f?.size||f.size>1024*1024||!['image/png','image/jpeg'].includes(f.type))throw new Error('请选择不超过 1 MB 的 JPEG 或 PNG 照片。');return {};}
    }
  }
  function showConfirmation(c){
    const d=$('scDialog'),oldForm=$('scForm');oldForm.hidden=true;const preview=document.createElement('div');preview.id='scConfirm';
    const metadata=Object.entries(c.payload.plan||{}).length?c.payload.plan.tiers.map(t=>kv(`满 ${t.fromDay} 天`,`${money(t.centsPerM3Per30Days)}/m³/30天`)).join(''):'';
    preview.innerHTML=`<p class="sc-notice">确认后提交给服务器。涉及发布、出库和资金核账的记录会保留历史。</p>${c.summary.map(x=>kv(x.name,x.value)).join('')}${metadata}${c.photos.length?kv('选中照片',c.photos.map(id=>detail.photos.find(p=>p.id===id)?.caption).join('；')):''}<p id="scConfirmError" class="sc-error" role="alert"></p><div class="sc-footer">${button('editConfirmation','返回修改')}<button type="button" class="sc-primary" id="scCommit">确认提交</button></div>`;
    d.append(preview);$('scCommit').onclick=async()=>{
      if(busy||pending)return;const id=selected;
      pending=c.scope==='upload'?{scope:'upload',path:`/service-inventory/${id}/photos/${uid()}?caption=${encodeURIComponent(c.caption)}`,body:c.file,method:'PUT',raw:true,type:c.file.type,title:c.title}:{scope:c.scope,path:`/${c.scope==='inventory'?'service-inventory':'service-commerce'}/${id}/operator`,body:c.payload,title:c.title};await sendPending();
    };
  }
  function renderPending(){const host=$('scPending');host.innerHTML=pending?`<div class="sc-notice">${esc(pending.title)}：结果尚未确认。请先核对原操作，不要另建一笔。<div class="sc-tools">${button('retry','重试原操作',busy)}${button('refresh','刷新核对',busy)}</div></div>`:'';}
  async function sendPending(){
    if(busy||!pending)return;const g=epoch,t=authToken,p=pending;let notice='',rejected=false;busy=true;renderPending();for(const b of $('scDialog').querySelectorAll('button'))b.disabled=true;
    try{await request(p.path,p);if(!isCurrent(g,t))return;pending=null;$('scDialog').close();$('scDialog').replaceChildren();status('服务器已确认操作完成。');}
    catch(e){if(!isCurrent(g,t))return;const definite=e.status&&e.status<500&&e.status!==408;if(definite){pending=null;rejected=true;notice=e.message+' 请核对最新记录后修改原表单。';$('scConfirm')?.remove();if($('scForm'))$('scForm').hidden=false;}else{notice='结果尚未确认，请重试原操作或刷新核对。';$('scDialog').close();}}
    finally{if(isCurrent(g,t)){busy=false;renderPending();await reloadDetail();if(isCurrent(g,t))await loadList(listCursor);if(!isCurrent(g,t))return;if(notice)status(notice,true);if(rejected&&$('scFormError'))$('scFormError').textContent=notice;for(const b of $('scDialog').querySelectorAll('button'))b.disabled=false;}}
  }
  async function handle(e){
    const x=e.target.closest('[data-sc-action],[data-sc-open],[data-sc-tab]');if(!x||!$('serviceCommerceSection').contains(x)||x.disabled)return;
    if(x.dataset.scOpen)return openDetail(x.dataset.scOpen);
    if(x.dataset.scTab){tab=x.dataset.scTab;return renderDetail();}
    const a=x.dataset.scAction;
    try{
      if(a==='refresh'){if(busy)return;const g=epoch,t=authToken;await reloadDetail();if(isCurrent(g,t))return loadList(listCursor);return;}if(a==='first'||a==='next'){if(busy||pending)return;return loadList(a==='next'?nextCursor:undefined);}if(a==='retry')return sendPending();
      if(a==='closeDialog'){$('scDialog').close();$('scDialog').replaceChildren();return;}if(a==='editConfirmation'){$('scConfirm').remove();$('scForm').hidden=false;return;}
      if(a==='addTier')return addTier();if(a==='removeTier')return x.closest('.sc-tier').remove();
      if(a==='photo')return showPhotos([x.dataset.id]);if(a==='reviewPhotos')return showPhotos(detail.flow.listing.photoIds);
      if(busy||pending)return status('请先核对原操作。',true);formFor(a,x.dataset.id);
    }catch(error){status(error.message,true);}
  }
  document.addEventListener('click',handle);
  return {open,clear,openRecord:openDetail};
})();
