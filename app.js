
const KEY='ptAnalyticsV2';
const defaultState={
  activeClientId:'c1',
  clients:[{id:'c1',name:'山田 太郎',age:28,sex:'男性',height:178,goal:'減量・筋力向上'}],
  training:[],
  body:[]
};
let state=load();

function load(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY));
    if(x && Array.isArray(x.clients)) return x;
  }catch(e){}
  return structuredClone(defaultState);
}
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function active(){return state.clients.find(c=>c.id===state.activeClientId)||state.clients[0]}
function today(){return new Date().toISOString().slice(0,10)}
function n(v,d=1){const x=Number(v);return Number.isFinite(x)?x.toFixed(d):'—'}
function clientRows(arr){return arr.filter(x=>x.clientId===state.activeClientId).sort((a,b)=>a.date.localeCompare(b.date))}
function rirFromRpe(rpe){return Math.max(0,10-Number(rpe||10))}
function e1rm(w,reps,rpe){return Number(w)*(1+(Number(reps)+rirFromRpe(rpe))/30)}

document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{
  const d=document.getElementById(b.dataset.open+'Dialog');
  const date=d.querySelector('[name=date]'); if(date) date.value=today(); d.showModal();
});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());

document.getElementById('trainingForm').addEventListener('submit',e=>{
  const f=new FormData(e.currentTarget);
  state.training.push({id:crypto.randomUUID(),clientId:state.activeClientId,date:f.get('date'),exercise:f.get('exercise'),weight:+f.get('weight'),reps:+f.get('reps'),sets:+f.get('sets'),rpe:+f.get('rpe')});
  save(); setTimeout(render);
});
document.getElementById('bodyForm').addEventListener('submit',e=>{
  const f=new FormData(e.currentTarget);
  state.body.push({id:crypto.randomUUID(),clientId:state.activeClientId,date:f.get('date'),bodyWeight:+f.get('bodyWeight'),bodyFat:+f.get('bodyFat')||null,water:+f.get('water')||null,sleep:+f.get('sleep')||null,steps:+f.get('steps')||null,condition:+f.get('condition')||null});
  save(); setTimeout(render);
});

const clientDialog=document.getElementById('clientDialog'), clientForm=document.getElementById('clientForm'), clientSelect=document.getElementById('clientSelect');
document.getElementById('clientBtn').onclick=()=>{fillClientSelect();loadClientForm(active());clientDialog.showModal()};
clientSelect.onchange=()=>{state.activeClientId=clientSelect.value;save();loadClientForm(active());render()};
document.getElementById('newClientBtn').onclick=()=>{clientForm.reset();clientSelect.value='';clientForm.elements.name.focus()};
clientForm.addEventListener('submit',e=>{
  const f=new FormData(clientForm), selected=clientSelect.value;
  let c=selected?state.clients.find(x=>x.id===selected):null;
  if(!c){c={id:crypto.randomUUID()};state.clients.push(c)}
  Object.assign(c,{name:f.get('name'),age:+f.get('age')||'',sex:f.get('sex'),height:+f.get('height')||'',goal:f.get('goal')});
  state.activeClientId=c.id; save(); setTimeout(render);
});
function fillClientSelect(){
  clientSelect.innerHTML='<option value="">＋ 新規クライアント</option>'+state.clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  clientSelect.value=state.activeClientId;
}
function loadClientForm(c){
  if(!c)return;
  ['name','age','sex','height','goal'].forEach(k=>clientForm.elements[k].value=c[k]??'');
}
document.getElementById('resetBtn').onclick=()=>{
  if(confirm('この端末に保存されたPT Analyticsの全データを初期化しますか？')){
    state=structuredClone(defaultState);save();render();
  }
};

function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function latest(a,k){const x=a.filter(v=>v[k]!=null&&v[k]!==0);return x.length?x[x.length-1][k]:null}
function render(){
  const c=active(); if(!c)return;
  document.getElementById('clientTitle').textContent=c.name;
  document.getElementById('clientName').textContent=c.name;
  document.getElementById('clientMeta').textContent=`${c.age||'—'}歳 / ${c.sex||'—'} / ${c.height||'—'}cm`;
  document.getElementById('clientGoal').textContent='目標：'+(c.goal||'未設定');

  const tr=clientRows(state.training), bd=clientRows(state.body);
  const lastW=latest(bd,'bodyWeight'), lastWater=latest(bd,'water'), lastSleep=latest(bd,'sleep'), lastSteps=latest(bd,'steps');
  const best=tr.length?Math.max(...tr.map(x=>e1rm(x.weight,x.reps,x.rpe))):null;
  const vol=tr.reduce((s,x)=>s+x.weight*x.reps*x.sets,0);
  const kpis=[
    ['最新体重',lastW==null?'—':n(lastW)+' kg'],
    ['水分量',lastWater==null?'—':n(lastWater)+' L'],
    ['睡眠',lastSleep==null?'—':n(lastSleep)+' h'],
    ['推定1RM BEST',best==null?'—':n(best)+' kg'],
    ['総ボリューム',vol?Math.round(vol).toLocaleString()+' kg':'—']
  ];
  document.getElementById('kpiGrid').innerHTML=kpis.map(x=>`<article class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="change">端末内に自動保存</div></article>`).join('');

  document.getElementById('trainingTable').innerHTML=tr.slice().reverse().slice(0,10).map(x=>`<tr><td>${x.date}</td><td>${esc(x.exercise)}</td><td>${x.weight}kg</td><td>${x.reps}</td><td>${x.rpe}</td><td>${n(e1rm(x.weight,x.reps,x.rpe))}kg</td></tr>`).join('') || '<tr><td colspan="6">まだ記録がありません</td></tr>';

  const last7=bd.slice(-7);
  const avg=k=>{const a=last7.map(x=>x[k]).filter(Boolean);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null};
  document.getElementById('conditionSummary').innerHTML=[
    ['💧',avg('water'),'L','平均水分'],['😴',avg('sleep'),'h','平均睡眠'],['🚶',avg('steps'),'', '平均歩数'],['⚡',avg('condition'),'/10','平均体調']
  ].map(([i,v,u,t])=>`<div class="condition"><div class="icon">${i}</div><div class="num">${v==null?'—':(u===''?Math.round(v).toLocaleString():n(v))}${v==null?'':u}</div><div class="txt">${t}</div></div>`).join('');

  drawLine('weightChart',bd.filter(x=>x.bodyWeight).map(x=>({date:x.date,value:x.bodyWeight})));
  drawLine('waterChart',bd.filter(x=>x.water).map(x=>({date:x.date,value:x.water})));
  drawLine('ormChart',tr.map(x=>({date:x.date,value:e1rm(x.weight,x.reps,x.rpe)})));
  drawBars('volumeChart',tr.map(x=>({date:x.date,value:x.weight*x.reps*x.sets})));
}
function svgEl(name,attrs={}){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function clearSvg(id){const s=document.getElementById(id);s.innerHTML='';return s}
function scale(data){
  const W=700,H=260,p=35, vals=data.map(x=>x.value), min=Math.min(...vals), max=Math.max(...vals), span=max-min||1;
  return {W,H,p,min,max,x:i=>p+(W-2*p)*(data.length===1?.5:i/(data.length-1)),y:v=>H-p-(H-2*p)*(v-min)/span};
}
function axes(s,sc,data){
  [0,.5,1].forEach(q=>{const y=sc.p+(sc.H-2*sc.p)*q;s.appendChild(svgEl('line',{x1:sc.p,y1:y,x2:sc.W-sc.p,y2:y,class:'axis'}))});
  data.forEach((d,i)=>{if(i===0||i===data.length-1){let t=svgEl('text',{x:sc.x(i),y:sc.H-8,class:'chart-label','text-anchor':'middle'});t.textContent=d.date.slice(5);s.appendChild(t)}})
}
function emptyChart(s){let t=svgEl('text',{x:350,y:130,class:'chart-label','text-anchor':'middle'});t.textContent='データを記録するとグラフが表示されます';s.appendChild(t)}
function drawLine(id,data){
  const s=clearSvg(id); if(!data.length)return emptyChart(s); const sc=scale(data);axes(s,sc,data);
  let d=data.map((v,i)=>(i?'L':'M')+sc.x(i)+' '+sc.y(v.value)).join(' ');
  s.appendChild(svgEl('path',{d,class:'line'}));
  data.forEach((v,i)=>s.appendChild(svgEl('circle',{cx:sc.x(i),cy:sc.y(v.value),r:4,class:'point'})));
}
function drawBars(id,data){
  const s=clearSvg(id);if(!data.length)return emptyChart(s);const sc=scale(data);axes(s,sc,data);
  const bw=Math.max(8,Math.min(45,(sc.W-2*sc.p)/data.length*.55));
  data.forEach((v,i)=>s.appendChild(svgEl('rect',{x:sc.x(i)-bw/2,y:sc.y(v.value),width:bw,height:sc.H-sc.p-sc.y(v.value),rx:3,class:'bar'})));
}
render();
