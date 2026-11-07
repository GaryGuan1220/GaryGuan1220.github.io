/* Calculation only. The normal quote confirmation still submits the customer offer. */
window.ServiceQuoteAssist=(()=>{
 'use strict';
 let dialog=null,epoch=0;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(v/100);
 const field=(name,label,step='1',value='')=>`<label class="sc-field"><span>${esc(label)}</span><input name="${name}" aria-label="${esc(label)}" type="number" min="0" step="${step}" value="${value}" required></label>`;
 function close(){epoch++;if(dialog){dialog.close();dialog.remove();dialog=null;}}
 function open({detail,api,onUse}){
  close();const generation=epoch;dialog=document.createElement('dialog');dialog.setAttribute('aria-label','车型与搬运测算');
  dialog.innerHTML=`<h3>车型与搬运测算</h3><p class="sc-notice">输入已向客户和合作司机确认的参数。按整份申请测算，不收取费用、不订车；没有确认的数据请先补齐。此处没有预设市场价格。</p>
   <form id="sqaForm"><div class="sc-form-grid">${field('distanceKm','本次计费距离（公里）','0.001')}${field('stairs','实际需要搬运的无电梯楼层总数')}</div>
   ${detail.form.items.map((i,n)=>`<fieldset class="sc-card"><legend>${esc(i.name)} × ${i.quantity} 件</legend><p class="sc-muted">原申报尺寸：${esc(i.dimensions||'未填写')}；${i.disassembly?'包含约定拆装':'未要求拆装'}。以下填写单件运输尺寸与重量。</p><div class="sc-form-grid">${field('l'+n,'物品'+(n+1)+'长度（厘米）','0.1')}${field('w'+n,'物品'+(n+1)+'宽度（厘米）','0.1')}${field('h'+n,'物品'+(n+1)+'高度（厘米）','0.1')}${field('kg'+n,'物品'+(n+1)+'重量（公斤）','0.1')}${field('crew'+n,'物品'+(n+1)+'所需搬运人数')}</div><label class="sc-check"><input type="checkbox" name="upright${n}">必须保持直立运输</label></fieldset>`).join('')}
   ${[['SUV','SUV'],['VAN','厢式货车'],['TRUCK','小卡车']].map(([id,title])=>`<details ${id==='VAN'?'open':''}><summary>${title} · 合作方车辆参数和报价</summary><label class="sc-check"><input type="checkbox" name="enable${id}" data-enable="${id}" ${id==='VAN'?'checked':''}>比较此车型</label><fieldset id="sqa${id}" ${id==='VAN'?'':'disabled'}><div class="sc-form-grid">
    ${field(id+'lengthMm',title+'货厢长（厘米）','0.1')}${field(id+'widthMm',title+'货厢宽（厘米）','0.1')}${field(id+'heightMm',title+'货厢高（厘米）','0.1')}${field(id+'payloadKg',title+'可载重量（公斤）')}${field(id+'usableVolumeBasisPoints',title+'可利用体积 %（10—90）')}${field(id+'crew',title+'提供的人员总数')}
    ${field(id+'baseCents',title+'基础出车费 A$','0.01')}${field(id+'includedMetres',title+'包含里程（公里）','0.001')}${field(id+'perKmCents',title+'额外每公里 A$','0.01')}${field(id+'handlingPerItemCents',title+'每件搬运费 A$','0.01')}${field(id+'floorPerItemCents',title+'每件每层楼梯费 A$','0.01')}${field(id+'disassemblyPerItemCents',title+'每件拆装费 A$','0.01')}
   </div></fieldset></details>`).join('')}
   <label class="sc-check"><input type="checkbox" name="confirmed" required>已核对运输尺寸、人员要求、计费距离、停车通道及合作方报价；不包含的收费项目将另行列明。</label>
   <p id="sqaError" class="sc-error" role="alert"></p><div class="sc-footer"><button type="button" id="sqaClose">关闭</button><button id="sqaCalculate" class="sc-primary">比较车型与费用</button></div></form><div id="sqaResult" aria-live="polite"></div>`;
  document.getElementById('serviceDispatchSection').append(dialog);dialog.showModal();
  const $=id=>dialog?.querySelector('#'+id);$('sqaClose').onclick=close;dialog.addEventListener('cancel',close);
  $('sqaForm').onchange=e=>{if(e.target.dataset.enable)$('sqa'+e.target.dataset.enable).disabled=!e.target.checked;$('sqaResult').replaceChildren();};
  $('sqaForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),number=(name,scale=1)=>{const value=String(f.get(name)??'').trim();if(!/^\d+(\.\d+)?$/.test(value))throw Error('请填写完整且非负的数值。');const n=Number(value)*scale;if(!Number.isFinite(n)||Math.abs(n-Math.round(n))>1e-6)throw Error('请核对金额小数位和尺寸单位。');return Math.round(n);};
   try{
    const input={revision:detail.revision,distanceMetres:number('distanceKm',1000),stairs:number('stairs'),conditionsConfirmed:f.has('confirmed'),items:detail.form.items.map((i,n)=>({itemId:i.id,lengthMm:number('l'+n,10),widthMm:number('w'+n,10),heightMm:number('h'+n,10),weightKg:Number(f.get('kg'+n)),requiredCrew:number('crew'+n),upright:f.has('upright'+n)})),vehicles:[]};
    for(const [id,name] of [['SUV','SUV'],['VAN','厢式货车'],['TRUCK','小卡车']])if(f.has('enable'+id)){const v={id,name};for(const key of ['lengthMm','widthMm','heightMm','payloadKg','usableVolumeBasisPoints','crew','baseCents','includedMetres','perKmCents','handlingPerItemCents','floorPerItemCents','disassemblyPerItemCents'])v[key]=number(id+key,key.endsWith('Mm')?10:key==='includedMetres'?1000:key.endsWith('Cents')||key==='usableVolumeBasisPoints'?100:1);input.vehicles.push(v);}
    const snapshot=JSON.stringify([...new FormData(e.target)]);$('sqaCalculate').disabled=true;$('sqaError').textContent='';$('sqaResult').replaceChildren();
    const result=await api('/service-bookings/admin/requests/'+detail.id+'/quote-assistance',input);
    if(epoch!==generation)return;if(snapshot!==JSON.stringify([...new FormData($('sqaForm'))]))throw Error('输入已变化，请重新测算。');
    $('sqaResult').innerHTML=`<p>${result.quantity} 件 · ${result.volumeLitres/1000} m³ · ${result.weightKg} kg · 至少 ${result.requiredCrew} 人</p><p class="sc-notice">${esc(result.notice)}</p>`+result.candidates.map(v=>`<article class="sc-card"><h4>${esc(v.name)}${v.id===result.recommendedId?' · 推荐':''}</h4>${v.eligible?v.fees.map(f=>`<p>${esc(f.label)}：${money(f.amountCents)}</p>`).join(''):`<p class="sc-error">${v.reasons.map(esc).join('；')}</p>`}<p>费用合计：${money(v.totalCents)}</p>${v.eligible?`<button type="button" data-sqa-use="${v.id}">用此明细创建报价草稿（替换旧费用明细）</button>`:''}</article>`).join('');
    for(const button of $('sqaResult').querySelectorAll('[data-sqa-use]'))button.onclick=()=>{const v=result.candidates.find(v=>v.id===button.dataset.sqaUse);close();onUse(v,result);};
   }catch(error){if(epoch===generation)$('sqaError').textContent=error.message;}finally{if(epoch===generation)$('sqaCalculate').disabled=false;}
  };
 }
 return {open,close};
})();
