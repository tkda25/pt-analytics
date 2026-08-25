
const KEY='ptAnalyticsV2';
const defaultState={
  activeClientId:'c1',
  clients:[{id:'c1',name:'山田 太郎',age:28,sex:'男性',height:178,goal:'減量・筋力向上'}],
  training:[],
  body:[],
  exercises:['ベンチプレス','スクワット','デッドリフト','ショルダープレス','ラットプルダウン']
};
let state=load();
let periodDays=30;

function clone(x){return JSON.parse(JSON.stringify(x))}
function load(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY));
    if(x && Array.isArray(x.clients)){
      x.training=Array.isArray(x.training)?x.training:[];
      x.body=Array.isArray(x.body)?x.body:[];
      x.exercises=Array.isArray(x.exercises)&&x.exercises.length?x.exercises:clone(defaultState.exercises);
      if(!x.activeClientId || !x.clients.some(c=>c.id===x.activeClientId)) x.activeClientId=x.clients[0]?.id||'';
      return x;
    }
  }catch(e){}
  return clone(defaultState);
}
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function active(){return state.clients.find(c=>c.id===state.activeClientId)||state.clients[0]}
function today(){return new Date().toISOString().slice(0,10)}
function n(v,d=1){const x=Number(v);return Number.isFinite(x)?x.toFixed(d):'—'}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function clientRows(arr){return arr.filter(x=>x.clientId===state.activeClientId).sort((a,b)=>a.date.localeCompare(b.date))}
function rirFromRpe(rpe){return Math.max(0,10-Number(rpe||10))}
function e1rm(w,reps,rpe){return Number(w)*(1+(Number(reps)+rirFromRpe(rpe))/30)}
function latest(a,k){const x=a.filter(v=>v[k]!=null&&v[k]!==0);return x.length?x[x.length-1][k]:null}
function avg(arr,k){const a=arr.map(x=>Number(x[k])).filter(v=>Number.isFinite(v)&&v!==0);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null}
function withinDays(x,days=periodDays){
  if(!days)return true;
  const cutoff=new Date();cutoff.setHours(0,0,0,0);cutoff.setDate(cutoff.getDate()-days);
  return new Date(x.date+'T00:00:00')>=cutoff;
}
function previousPeriodRows(arr){
  if(!periodDays)return [];
  const now=new Date();now.setHours(0,0,0,0);
  const currentStart=new Date(now);currentStart.setDate(now.getDate()-periodDays);
  const prevStart=new Date(currentStart);prevStart.setDate(currentStart.getDate()-periodDays);
  return arr.filter(x=>{const d=new Date(x.date+'T00:00:00');return d>=prevStart&&d<currentStart});
}
function download(name,text,type='text/plain'){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}

document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{
  const d=document.getElementById(b.dataset.open+'Dialog');
  const date=d.querySelector('[name=date]'); if(date) date.value=today();
  d.showModal();
});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());

document.getElementById('trainingForm').addEventListener('submit',e=>{
  const f=new FormData(e.currentTarget);
  state.training.push({
    id:crypto.randomUUID(),clientId:state.activeClientId,date:f.get('date'),exercise:f.get('exercise'),
    weight:+f.get('weight'),reps:+f.get('reps'),sets:+f.get('sets'),rpe:+f.get('rpe')
  });
  save();setTimeout(render);
});
document.getElementById('bodyForm').addEventListener('submit',e=>{
  const f=new FormData(e.currentTarget);
  state.body.push({
    id:crypto.randomUUID(),clientId:state.activeClientId,date:f.get('date'),
    bodyWeight:+f.get('bodyWeight'),bodyFat:+f.get('bodyFat')||null,water:+f.get('water')||null,
    sleep:+f.get('sleep')||null,steps:+f.get('steps')||null,condition:+f.get('condition')||null,note:f.get('note')||''
  });
  save();setTimeout(render);
});

const clientDialog=document.getElementById('clientDialog');
const clientForm=document.getElementById('clientForm');
const clientSelect=document.getElementById('clientSelect');
const quickClientSelect=document.getElementById('quickClientSelect');

document.getElementById('clientBtn').onclick=()=>{fillClientSelects();loadClientForm(active());clientDialog.showModal()};
clientSelect.onchange=()=>{
  if(!clientSelect.value){clientForm.reset();return}
  state.activeClientId=clientSelect.value;save();loadClientForm(active());render();
};
quickClientSelect.onchange=()=>{state.activeClientId=quickClientSelect.value;save();render()};
document.getElementById('newClientBtn').onclick=()=>{clientForm.reset();clientSelect.value='';clientForm.elements.name.focus()};
clientForm.addEventListener('submit',e=>{
  const f=new FormData(clientForm),selected=clientSelect.value;
  let c=selected?state.clients.find(x=>x.id===selected):null;
  if(!c){c={id:crypto.randomUUID()};state.clients.push(c)}
  Object.assign(c,{name:f.get('name'),age:+f.get('age')||'',sex:f.get('sex'),height:+f.get('height')||'',goal:f.get('goal')});
  state.activeClientId=c.id;save();setTimeout(render);
});
document.getElementById('deleteClientBtn').onclick=()=>{
  const c=active();if(!c)return;
  if(state.clients.length<=1){alert('最後の1人は削除できません。');return}
  if(confirm(`${c.name} と、その記録をすべて削除しますか？`)){
    state.clients=state.clients.filter(x=>x.id!==c.id);
    state.training=state.training.filter(x=>x.clientId!==c.id);
    state.body=state.body.filter(x=>x.clientId!==c.id);
    state.activeClientId=state.clients[0].id;save();clientDialog.close();render();
  }
};
function fillClientSelects(){
  const opts=state.clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  clientSelect.innerHTML='<option value="">＋ 新規クライアント</option>'+opts;
  quickClientSelect.innerHTML=opts;
  clientSelect.value=state.activeClientId;quickClientSelect.value=state.activeClientId;
}
function loadClientForm(c){
  if(!c)return;
  ['name','age','sex','height','goal'].forEach(k=>clientForm.elements[k].value=c[k]??'');
}
document.getElementById('resetBtn').onclick=()=>{
  if(confirm('この端末に保存されたPT Analyticsの全データを初期化しますか？')){
    state=clone(defaultState);save();render();
  }
};

const exerciseFilter=document.getElementById('exerciseFilter');
document.getElementById('periodTabs').onclick=e=>{
  if(!e.target.dataset.days)return;
  periodDays=+e.target.dataset.days;
  document.querySelectorAll('#periodTabs button').forEach(b=>b.classList.toggle('active',b===e.target));
  render();
};
exerciseFilter.onchange=render;

function refreshExercises(){
  const sel=document.getElementById('exerciseSelect'),current=sel.value;
  sel.innerHTML=state.exercises.map(x=>`<option>${esc(x)}</option>`).join('');
  if(state.exercises.includes(current))sel.value=current;
  const fcur=exerciseFilter.value;
  exerciseFilter.innerHTML='<option value="">全種目</option>'+state.exercises.map(x=>`<option>${esc(x)}</option>`).join('');
  exerciseFilter.value=fcur;
}
document.getElementById('addExerciseBtn').onclick=()=>{
  const input=document.getElementById('newExercise'),v=input.value.trim();
  if(v&&!state.exercises.includes(v)){state.exercises.push(v);save();refreshExercises();document.getElementById('exerciseSelect').value=v}
  input.value='';
};
function removeTraining(id){if(confirm('このトレーニング記録を削除しますか？')){state.training=state.training.filter(x=>x.id!==id);save();render()}}
function removeBody(id){if(confirm('この身体・生活データを削除しますか？')){state.body=state.body.filter(x=>x.id!==id);save();render()}}
window.removeTraining=removeTraining;window.removeBody=removeBody;

// Backup
const backupDialog=document.getElementById('backupDialog');
document.getElementById('backupBtn').onclick=()=>backupDialog.showModal();
document.getElementById('exportBackupBtn').onclick=()=>{
  download(`pt-analytics-backup-${today()}.json`,JSON.stringify(state,null,2),'application/json');
};
document.getElementById('importBackupInput').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.clients)||!Array.isArray(data.training)||!Array.isArray(data.body)) throw new Error();
    if(confirm('現在の端末データを、このバックアップ内容で置き換えますか？')){
      state=data;state.exercises=state.exercises||clone(defaultState.exercises);save();backupDialog.close();render();
    }
  }catch(err){alert('バックアップファイルを読み込めませんでした。')}
  e.target.value='';
};

// CSV / print
document.getElementById('exportCsvBtn').onclick=()=>{
  const c=active(),tr=clientRows(state.training),bd=clientRows(state.body);
  const lines=[
    ['クライアント',c.name],['目標',c.goal||''],[],
    ['TRAINING'],['日付','種目','重量kg','回数','セット','RPE','推定1RMkg'],
    ...tr.map(x=>[x.date,x.exercise,x.weight,x.reps,x.sets,x.rpe,n(e1rm(x.weight,x.reps,x.rpe))]),
    [],['BODY'],['日付','体重kg','体脂肪%','水分L','睡眠h','歩数','体調','メモ'],
    ...bd.map(x=>[x.date,x.bodyWeight||'',x.bodyFat||'',x.water||'',x.sleep||'',x.steps||'',x.condition||'',x.note||''])
  ];
  const csv='\ufeff'+lines.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  download(`pt-analytics-${c.name}-${today()}.csv`,csv,'text/csv;charset=utf-8');
};
document.getElementById('printReportBtn').onclick=()=>window.print();

function compareValue(cur,prev,unit='',positiveIsGood=true){
  if(cur==null)return ['—','compare-flat'];
  if(prev==null||prev===0)return [`${n(cur)}${unit}`,'compare-flat'];
  const diff=((cur-prev)/Math.abs(prev))*100;
  const cls=Math.abs(diff)<1?'compare-flat':((diff>0)===positiveIsGood?'compare-up':'compare-down');
  return [`${diff>=0?'+':''}${n(diff)}%`,cls];
}

function render(){
  const c=active();if(!c)return;
  fillClientSelects();refreshExercises();

  document.getElementById('clientTitle').textContent=c.name;
  document.getElementById('clientName').textContent=c.name;
  document.getElementById('clientMeta').textContent=`${c.age||'—'}歳 / ${c.sex||'—'} / ${c.height||'—'}cm`;
  document.getElementById('clientGoal').textContent='目標：'+(c.goal||'未設定');

  const trAll=clientRows(state.training),bdAll=clientRows(state.body);
  const tr=trAll.filter(x=>withinDays(x)).filter(x=>!exerciseFilter.value||x.exercise===exerciseFilter.value);
  const bd=bdAll.filter(x=>withinDays(x));
  const prevTr=previousPeriodRows(trAll).filter(x=>!exerciseFilter.value||x.exercise===exerciseFilter.value);
  const prevBd=previousPeriodRows(bdAll);

  const lastW=latest(bdAll,'bodyWeight'),lastWater=latest(bdAll,'water'),lastSleep=latest(bdAll,'sleep');
  const best=trAll.length?Math.max(...trAll.map(x=>e1rm(x.weight,x.reps,x.rpe))):null;
  const vol=trAll.reduce((s,x)=>s+x.weight*x.reps*x.sets,0);
  const kpis=[
    ['最新体重',lastW==null?'—':n(lastW)+' kg'],
    ['水分量',lastWater==null?'—':n(lastWater)+' L'],
    ['睡眠',lastSleep==null?'—':n(lastSleep)+' h'],
    ['推定1RM BEST',best==null?'—':n(best)+' kg'],
    ['総ボリューム',vol?Math.round(vol).toLocaleString()+' kg':'—']
  ];
  document.getElementById('kpiGrid').innerHTML=kpis.map(x=>`<article class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="change">端末内に自動保存</div></article>`).join('');

  const curVol=tr.reduce((s,x)=>s+x.weight*x.reps*x.sets,0),prevVol=prevTr.reduce((s,x)=>s+x.weight*x.reps*x.sets,0);
  const curSleep=avg(bd,'sleep'),prevSleep=avg(prevBd,'sleep');
  const curWater=avg(bd,'water'),prevWater=avg(prevBd,'water');
  const curCond=avg(bd,'condition'),prevCond=avg(prevBd,'condition');
  const comp=[
    ['期間ボリューム',...compareValue(curVol,prevVol,'',true)],
    ['平均睡眠',...compareValue(curSleep,prevSleep,'',true)],
    ['平均水分',...compareValue(curWater,prevWater,'',true)],
    ['平均体調',...compareValue(curCond,prevCond,'',true)]
  ];
  document.getElementById('comparisonStrip').innerHTML='<strong>前期間比</strong>'+comp.map(([l,v,cl])=>`<div class="compare-item"><span class="compare-label">${l}</span><span class="compare-value ${cl}">${v}</span></div>`).join('');

  document.getElementById('trainingTable').innerHTML=tr.slice().reverse().slice(0,20).map(x=>`<tr><td>${x.date}</td><td>${esc(x.exercise)}</td><td>${x.weight}kg</td><td>${x.reps}</td><td>${x.rpe}</td><td>${n(e1rm(x.weight,x.reps,x.rpe))}kg</td><td><button class="action-btn" onclick="removeTraining('${x.id}')">削除</button></td></tr>`).join('')||'<tr><td colspan="7">まだ記録がありません</td></tr>';

  const last7=bdAll.slice(-7);
  document.getElementById('conditionSummary').innerHTML=[
    ['💧',avg(last7,'water'),'L','平均水分'],['😴',avg(last7,'sleep'),'h','平均睡眠'],['🚶',avg(last7,'steps'),'','平均歩数'],['⚡',avg(last7,'condition'),'/10','平均体調']
  ].map(([i,v,u,t])=>`<div class="condition"><div class="icon">${i}</div><div class="num">${v==null?'—':(u===''?Math.round(v).toLocaleString():n(v))}${v==null?'':u}</div><div class="txt">${t}</div></div>`).join('');

  document.getElementById('bodyTable').innerHTML=bdAll.slice().reverse().slice(0,20).map(x=>`<tr><td>${x.date}</td><td>${x.bodyWeight||'—'}</td><td>${x.bodyFat||'—'}</td><td>${x.water||'—'}</td><td>${x.sleep||'—'}</td><td>${x.steps?Number(x.steps).toLocaleString():'—'}</td><td>${x.condition||'—'}</td><td><button class="action-btn" onclick="removeBody('${x.id}')">削除</button></td></tr>`).join('')||'<tr><td colspan="8">まだ記録がありません</td></tr>';

  const startWeight=bd.length?bd.find(x=>x.bodyWeight)?.bodyWeight:null;
  const endWeight=bd.length?[...bd].reverse().find(x=>x.bodyWeight)?.bodyWeight:null;
  const periodBest=tr.length?Math.max(...tr.map(x=>e1rm(x.weight,x.reps,x.rpe))):null;
  const report=[
    ['表示期間',periodDays?`直近${periodDays}日`:'全期間'],
    ['トレーニング回数',`${tr.length}件`],
    ['期間ボリューム',curVol?`${Math.round(curVol).toLocaleString()} kg`:'—'],
    ['期間BEST 推定1RM',periodBest?`${n(periodBest)} kg`:'—'],
    ['体重変化',(startWeight&&endWeight)?`${n(endWeight-startWeight)} kg`:'—'],
    ['平均水分',curWater?`${n(curWater)} L`:'—'],
    ['平均睡眠',curSleep?`${n(curSleep)} h`:'—'],
    ['平均体調',curCond?`${n(curCond)} / 10`:'—']
  ];
  document.getElementById('reportSummary').innerHTML=report.map(([a,b])=>`<div class="report-line"><span>${a}</span><strong>${b}</strong></div>`).join('');

  drawLine('weightChart',bd.filter(x=>x.bodyWeight).map(x=>({date:x.date,value:x.bodyWeight})));
  drawLine('waterChart',bd.filter(x=>x.water).map(x=>({date:x.date,value:x.water})));
  drawLine('sleepChart',bd.filter(x=>x.sleep).map(x=>({date:x.date,value:x.sleep})));
  drawLine('stepsChart',bd.filter(x=>x.steps).map(x=>({date:x.date,value:x.steps})));
  drawLine('ormChart',tr.map(x=>({date:x.date,value:e1rm(x.weight,x.reps,x.rpe)})));
  drawBars('volumeChart',tr.map(x=>({date:x.date,value:x.weight*x.reps*x.sets})));
}

function svgEl(name,attrs={}){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function clearSvg(id){const s=document.getElementById(id);s.innerHTML='';return s}
function scale(data){
  const W=700,H=260,p=35,vals=data.map(x=>Number(x.value)),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
  return {W,H,p,min,max,x:i=>p+(W-2*p)*(data.length===1?.5:i/(data.length-1)),y:v=>H-p-(H-2*p)*(Number(v)-min)/span};
}
function axes(s,sc,data){
  [0,.5,1].forEach(q=>{const y=sc.p+(sc.H-2*sc.p)*q;s.appendChild(svgEl('line',{x1:sc.p,y1:y,x2:sc.W-sc.p,y2:y,class:'axis'}))});
  data.forEach((d,i)=>{if(i===0||i===data.length-1){const t=svgEl('text',{x:sc.x(i),y:sc.H-8,class:'chart-label','text-anchor':'middle'});t.textContent=d.date.slice(5);s.appendChild(t)}})
}
function emptyChart(s){const t=svgEl('text',{x:350,y:130,class:'chart-label','text-anchor':'middle'});t.textContent='データを記録するとグラフが表示されます';s.appendChild(t)}
function drawLine(id,data){
  const s=clearSvg(id);if(!data.length)return emptyChart(s);const sc=scale(data);axes(s,sc,data);
  const d=data.map((v,i)=>(i?'L':'M')+sc.x(i)+' '+sc.y(v.value)).join(' ');
  s.appendChild(svgEl('path',{d,class:'line'}));
  data.forEach((v,i)=>s.appendChild(svgEl('circle',{cx:sc.x(i),cy:sc.y(v.value),r:4,class:'point'})));
}
function drawBars(id,data){
  const s=clearSvg(id);if(!data.length)return emptyChart(s);const sc=scale(data);axes(s,sc,data);
  const bw=Math.max(8,Math.min(45,(sc.W-2*sc.p)/data.length*.55));
  data.forEach((v,i)=>s.appendChild(svgEl('rect',{x:sc.x(i)-bw/2,y:sc.y(v.value),width:bw,height:sc.H-sc.p-sc.y(v.value),rx:3,class:'bar'})));
}
render();
