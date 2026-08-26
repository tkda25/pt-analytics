
const KEY='ptAnalyticsV5';
const LEGACY_KEYS=['ptAnalyticsV4','ptAnalyticsV3','ptAnalyticsV2','ptAnalytics'];
const defaultState={
  activeClientId:'',
  clients:[],
  training:[],
  body:[],
  exercises:['ベンチプレス','スクワット','デッドリフト','ショルダープレス','ラットプルダウン']
};
let state=load();

const cloudConfigReady =
  typeof window.PT_SUPABASE_URL==='string' &&
  window.PT_SUPABASE_URL.startsWith('https://') &&
  typeof window.PT_SUPABASE_PUBLISHABLE_KEY==='string' &&
  window.PT_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_');
const sb = cloudConfigReady ? window.supabase.createClient(window.PT_SUPABASE_URL,window.PT_SUPABASE_PUBLISHABLE_KEY) : null;
let currentUser=null, cloudReady=false, cloudBusy=false, suppressCloudSave=false, cloudSaveTimer=null;

function setAuthMessage(msg,type=''){const e=document.getElementById('authMessage');if(e){e.textContent=msg||'';e.className='auth-message'+(type?' '+type:'')}}
function setSyncStatus(msg){const e=document.getElementById('cloudSyncStatus');if(e)e.textContent=msg}
function cloudUuid(){return crypto.randomUUID()}
function cloudIsUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
function ensureUuidState(){
  const map=new Map();
  state.clients.forEach(c=>{const old=c.id;if(!cloudIsUuid(c.id))c.id=cloudUuid();map.set(old,c.id)});
  state.training.forEach(r=>{if(!cloudIsUuid(r.id))r.id=cloudUuid();if(map.has(r.clientId))r.clientId=map.get(r.clientId)});
  state.body.forEach(r=>{if(!cloudIsUuid(r.id))r.id=cloudUuid();if(map.has(r.clientId))r.clientId=map.get(r.clientId)});
  if(map.has(state.activeClientId))state.activeClientId=map.get(state.activeClientId);
  if(!state.clients.some(c=>c.id===state.activeClientId))state.activeClientId=state.clients[0]?.id||'';
}
function cloudClientRow(c){return{id:c.id,name:c.name,age:c.age||null,sex:c.sex||null,height:c.height||null,goal:c.goal||null}}
function cloudTrainingRow(r){const orm=e1rm(r.weight,r.reps);return{id:r.id,client_id:r.clientId,training_date:r.date,exercise:r.exercise,weight:r.weight,reps:r.reps,sets:r.sets,rpe:null,estimated_1rm:Number.isFinite(orm)?Math.round(orm*10)/10:null,volume:(+r.weight||0)*(+r.reps||0)*(+r.sets||0),note:r.note||null}}
function cloudBodyRow(r){return{id:r.id,client_id:r.clientId,record_date:r.date,body_weight:r.bodyWeight||null,body_fat:r.bodyFat||null,water:r.water||null,sleep:r.sleep||null,steps:r.steps||null,condition:r.condition||null,note:r.note||null}}
function localFromCloud(c,t,b){return{activeClientId:c[0]?.id||'',clients:c.map(x=>({id:x.id,name:x.name,age:x.age||'',sex:x.sex||'',height:x.height||'',goal:x.goal||''})),training:t.map(x=>({id:x.id,clientId:x.client_id,date:x.training_date,exercise:x.exercise,weight:+x.weight,reps:x.reps,sets:x.sets,rpe:null,note:x.note||''})),body:b.map(x=>({id:x.id,clientId:x.client_id,date:x.record_date,bodyWeight:x.body_weight==null?null:+x.body_weight,bodyFat:x.body_fat==null?null:+x.body_fat,water:x.water==null?null:+x.water,sleep:x.sleep==null?null:+x.sleep,steps:x.steps,condition:x.condition,note:x.note||''})),exercises:state.exercises||clone(defaultState.exercises)}}
async function fetchCloudState(){
  if(!sb||!currentUser)return false;
  setSyncStatus('読み込み中');
  const [c,t,b]=await Promise.all([
    sb.from('clients').select('*').order('created_at'),
    sb.from('training_records').select('*').order('training_date'),
    sb.from('body_records').select('*').order('record_date')
  ]);
  if(c.error||t.error||b.error){console.error(c.error||t.error||b.error);setSyncStatus('読み込みエラー');return false}
  if(c.data.length===0){suppressCloudSave=true;state={activeClientId:'',clients:[],training:[],body:[],exercises:state.exercises||clone(defaultState.exercises)};const raw=JSON.stringify(state);localStorage.setItem(KEY,raw);localStorage.setItem('ptAnalyticsV2',raw);suppressCloudSave=false;setSyncStatus('同期済み');render();return 'empty';}
  suppressCloudSave=true;state=localFromCloud(c.data,t.data,b.data);
  const raw=JSON.stringify(state);localStorage.setItem(KEY,raw);localStorage.setItem('ptAnalyticsV2',raw);
  suppressCloudSave=false;setSyncStatus('同期済み');render();return true;
}
async function pushFullStateToCloud(){
  if(!sb||!currentUser||cloudBusy)return;
  cloudBusy=true;setSyncStatus('保存中');
  try{
    ensureUuidState();

    // 1) Upsert current local state.
    if(state.clients.length){
      const {error}=await sb.from('clients').upsert(state.clients.map(cloudClientRow),{onConflict:'id'});
      if(error)throw error;
    }
    if(state.training.length){
      const {error}=await sb.from('training_records').upsert(state.training.map(cloudTrainingRow),{onConflict:'id'});
      if(error)throw error;
    }
    if(state.body.length){
      const {error}=await sb.from('body_records').upsert(state.body.map(cloudBodyRow),{onConflict:'id'});
      if(error)throw error;
    }

    // 2) Delete cloud rows that were deleted locally.
    const [remoteClients,remoteTraining,remoteBody]=await Promise.all([
      sb.from('clients').select('id'),
      sb.from('training_records').select('id'),
      sb.from('body_records').select('id')
    ]);
    if(remoteClients.error||remoteTraining.error||remoteBody.error)throw(remoteClients.error||remoteTraining.error||remoteBody.error);

    const localClientIds=new Set(state.clients.map(x=>x.id));
    const localTrainingIds=new Set(state.training.map(x=>x.id));
    const localBodyIds=new Set(state.body.map(x=>x.id));

    const delClientIds=(remoteClients.data||[]).map(x=>x.id).filter(id=>!localClientIds.has(id));
    const delTrainingIds=(remoteTraining.data||[]).map(x=>x.id).filter(id=>!localTrainingIds.has(id));
    const delBodyIds=(remoteBody.data||[]).map(x=>x.id).filter(id=>!localBodyIds.has(id));

    // child rows first to avoid FK issues
    if(delTrainingIds.length){const {error}=await sb.from('training_records').delete().in('id',delTrainingIds);if(error)throw error}
    if(delBodyIds.length){const {error}=await sb.from('body_records').delete().in('id',delBodyIds);if(error)throw error}
    if(delClientIds.length){const {error}=await sb.from('clients').delete().in('id',delClientIds);if(error)throw error}

    setSyncStatus('同期済み');
  }catch(e){
    console.error(e);
    setSyncStatus('保存エラー');
  }finally{
    cloudBusy=false;
  }
}
function scheduleCloudSave(){if(!cloudReady||suppressCloudSave||!currentUser)return;clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(pushFullStateToCloud,500)}
async function enterApp(user){
  currentUser=user;document.getElementById('authGate')?.classList.add('hidden');
  const ae=document.getElementById('accountEmail');if(ae)ae.textContent=user.email||'';
  await fetchCloudState();
  cloudReady=true;setSyncStatus('同期済み');
}
async function bootCloud(){
  if(!cloudConfigReady){setAuthMessage('config.js にSupabase設定を入れてください。','error');return}
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user)await enterApp(session.user);
  sb.auth.onAuthStateChange(async(_e,session)=>{
    if(session?.user && (!currentUser||currentUser.id!==session.user.id))await enterApp(session.user);
    if(!session?.user){currentUser=null;cloudReady=false;document.getElementById('authGate')?.classList.remove('hidden')}
  });
}

let periodDays=30;
let currentView='dashboard';
let editingTrainingId=null;
let editingBodyId=null;

function clone(x){return JSON.parse(JSON.stringify(x))}
function normalizeState(x){
  const base=clone(defaultState);
  if(!x || typeof x!=='object') return base;
  const clients=Array.isArray(x.clients)?x.clients.filter(Boolean):[];
  const training=Array.isArray(x.training)?x.training:[];
  const body=Array.isArray(x.body)?x.body:[];
  const exercises=Array.isArray(x.exercises)&&x.exercises.length?x.exercises:clone(defaultState.exercises);

  if(!clients.length){
    return {activeClientId:'',clients:[],training:[],body:[],exercises};
  }

  let fallbackClientId=x.activeClientId || clients[0]?.id || '';
  training.forEach(r=>{if(!r.clientId)r.clientId=fallbackClientId});
  body.forEach(r=>{if(!r.clientId)r.clientId=fallbackClientId});
  const activeClientId=clients.some(c=>c.id===x.activeClientId)?x.activeClientId:clients[0].id;
  return {activeClientId,clients,training,body,exercises};
}
function load(){
  // Prefer v5 data, otherwise migrate the newest legacy key that exists.
  for(const key of [KEY,...LEGACY_KEYS]){
    try{
      const raw=localStorage.getItem(key);
      if(!raw) continue;
      const normalized=normalizeState(JSON.parse(raw));
      if(key!==KEY){
        localStorage.setItem(KEY,JSON.stringify(normalized));
      }
      return normalized;
    }catch(e){}
  }
  return clone(defaultState);
}
function save(){const raw=JSON.stringify(state);localStorage.setItem(KEY,raw);localStorage.setItem('ptAnalyticsV2',raw);scheduleCloudSave()}
function active(){return state.clients.find(c=>c.id===state.activeClientId)||state.clients[0]||null}
function today(){return new Date().toISOString().slice(0,10)}
function n(v,d=1){const x=Number(v);return Number.isFinite(x)?x.toFixed(d):'—'}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function clientRows(arr){return arr.filter(x=>x.clientId===state.activeClientId).sort((a,b)=>a.date.localeCompare(b.date))}
function e1rm(w,reps){
  const weight=Number(w), r=Number(reps);
  if(!Number.isFinite(weight)||weight<=0||!Number.isFinite(r)||r<=0)return 0;
  const repsUsed=Math.min(r,10);
  return weight*36/(37-repsUsed);
}
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
  const type=b.dataset.open;
  const d=document.getElementById(type+'Dialog');
  if(type==='training'){
    editingTrainingId=null;
    document.getElementById('trainingDialogTitle').textContent='トレーニングを記録';
    document.getElementById('trainingForm').reset();
    document.getElementById('trainingForm').elements.sets.value=3;
  }
  if(type==='body'){
    editingBodyId=null;
    document.getElementById('bodyDialogTitle').textContent='身体・生活データを記録';
    document.getElementById('bodyForm').reset();
  }
  const date=d.querySelector('[name=date]'); if(date) date.value=today();
  d.showModal();
});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());

document.getElementById('trainingForm').addEventListener('submit',e=>{
  const f=new FormData(e.currentTarget);
  const payload={
    clientId:state.activeClientId,date:f.get('date'),exercise:f.get('exercise'),
    weight:+f.get('weight'),reps:+f.get('reps'),sets:+f.get('sets'),note:f.get('note')||''
  };
  if(editingTrainingId){
    const row=state.training.find(x=>x.id===editingTrainingId);
    if(row)Object.assign(row,payload);
  }else{
    state.training.push({id:crypto.randomUUID(),...payload});
  }
  editingTrainingId=null;
  save();setTimeout(render);
});
document.getElementById('bodyForm').addEventListener('submit',e=>{
  const f=new FormData(e.currentTarget);
  const payload={
    clientId:state.activeClientId,date:f.get('date'),
    bodyWeight:+f.get('bodyWeight'),bodyFat:+f.get('bodyFat')||null,water:+f.get('water')||null,
    sleep:+f.get('sleep')||null,steps:+f.get('steps')||null,condition:+f.get('condition')||null,note:f.get('note')||''
  };
  if(editingBodyId){
    const row=state.body.find(x=>x.id===editingBodyId);
    if(row)Object.assign(row,payload);
  }else{
    state.body.push({id:crypto.randomUUID(),...payload});
  }
  editingBodyId=null;
  save();setTimeout(render);
});

const clientDialog=document.getElementById('clientDialog');
const clientForm=document.getElementById('clientForm');
const clientSelect=document.getElementById('clientSelect');
const clientSearch=document.getElementById('clientSearch');
const clientSearchResults=document.getElementById('clientSearchResults');
const clientList=document.getElementById('clientList');
const clientListSearch=document.getElementById('clientListSearch');
const clientCountLabel=document.getElementById('clientCountLabel');
const progressExerciseSelect=document.getElementById('progressExerciseSelect');
const progressRangeSelect=document.getElementById('progressRangeSelect');
const mobileMenuBtn=document.getElementById('mobileMenuBtn');
const mobileMenuClose=document.getElementById('mobileMenuClose');
const sidebar=document.getElementById('sidebar');
const sidebarBackdrop=document.getElementById('sidebarBackdrop');



document.getElementById('clientBtn').onclick=()=>{fillClientSelects();loadClientForm(active());clientDialog.showModal()};
clientSelect.onchange=()=>{
  if(!clientSelect.value){clientForm.reset();return}
  state.activeClientId=clientSelect.value;
  save();
  loadClientForm(active());
  render();
};
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
  if(confirm(`${c.name} と、その記録をすべて削除しますか？`)){
    state.clients=state.clients.filter(x=>x.id!==c.id);
    state.training=state.training.filter(x=>x.clientId!==c.id);
    state.body=state.body.filter(x=>x.clientId!==c.id);
    state.activeClientId=state.clients[0]?.id||'';save();clientDialog.close();render();
  }
};
function fillClientSelects(){
  const opts=state.clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  clientSelect.innerHTML='<option value="">＋ 新規クライアント</option>'+opts;
  clientSelect.value=state.activeClientId||'';
}
function loadClientForm(c){
  if(!c)return;
  ['name','age','sex','height','goal'].forEach(k=>clientForm.elements[k].value=c[k]??'');
}
document.getElementById('menuResetBtn')?.addEventListener('click',()=>{
  closeMobileMenu();
  if(confirm('この端末に保存されたPT Analyticsの全データを初期化しますか？')){
    state=clone(defaultState);save();render();
  }
});

const exerciseFilter=document.getElementById('exerciseFilter');
document.getElementById('periodTabs').onclick=e=>{
  if(!e.target.dataset.days)return;
  periodDays=+e.target.dataset.days;
  document.querySelectorAll('#periodTabs button').forEach(b=>b.classList.toggle('active',b===e.target));
  render();
};
exerciseFilter.onchange=render;
progressExerciseSelect.onchange=render;
progressRangeSelect.onchange=render;

function refreshExercises(){
  const sel=document.getElementById('exerciseSelect'),current=sel.value;
  sel.innerHTML=state.exercises.map(x=>`<option>${esc(x)}</option>`).join('');
  if(state.exercises.includes(current))sel.value=current;
  const fcur=exerciseFilter.value;
  exerciseFilter.innerHTML='<option value="">全種目</option>'+state.exercises.map(x=>`<option>${esc(x)}</option>`).join('');
  exerciseFilter.value=fcur;
  const pcur=progressExerciseSelect?.value;
  const activeExercises=[...new Set(clientRows(state.training).map(x=>x.exercise))];
  const source=activeExercises.length?activeExercises:state.exercises;
  if(progressExerciseSelect){
    progressExerciseSelect.innerHTML=source.map(x=>`<option>${esc(x)}</option>`).join('');
    if(source.includes(pcur))progressExerciseSelect.value=pcur;
  }
}
document.getElementById('addExerciseBtn').onclick=()=>{
  const input=document.getElementById('newExercise'),v=input.value.trim();
  if(v&&!state.exercises.includes(v)){state.exercises.push(v);save();refreshExercises();document.getElementById('exerciseSelect').value=v}
  input.value='';
};
function editTraining(id){
  const x=state.training.find(r=>r.id===id);if(!x)return;
  editingTrainingId=id;
  const form=document.getElementById('trainingForm');
  document.getElementById('trainingDialogTitle').textContent='トレーニング記録を編集';
  refreshExercises();
  form.elements.date.value=x.date||today();
  form.elements.exercise.value=x.exercise||'';
  form.elements.weight.value=x.weight??'';
  form.elements.reps.value=x.reps??'';
  form.elements.sets.value=x.sets??1;
  form.elements.note.value=x.note||'';
  document.getElementById('trainingDialog').showModal();
}
function editBody(id){
  const x=state.body.find(r=>r.id===id);if(!x)return;
  editingBodyId=id;
  const form=document.getElementById('bodyForm');
  document.getElementById('bodyDialogTitle').textContent='身体・生活データを編集';
  form.elements.date.value=x.date||today();
  form.elements.bodyWeight.value=x.bodyWeight??'';
  form.elements.bodyFat.value=x.bodyFat??'';
  form.elements.water.value=x.water??'';
  form.elements.sleep.value=x.sleep??'';
  form.elements.steps.value=x.steps??'';
  form.elements.condition.value=x.condition??'';
  form.elements.note.value=x.note||'';
  document.getElementById('bodyDialog').showModal();
}
function removeTraining(id){if(confirm('このトレーニング記録を削除しますか？')){state.training=state.training.filter(x=>x.id!==id);save();render()}}
function removeBody(id){if(confirm('この身体・生活データを削除しますか？')){state.body=state.body.filter(x=>x.id!==id);save();render()}}
window.editTraining=editTraining;window.editBody=editBody;window.removeTraining=removeTraining;window.removeBody=removeBody;


function renderClientSearchResults(query){
  const q=(query||'').trim().toLowerCase();

  if(!q){
    if(currentView==='clients'){
      clientSearchResults.innerHTML=state.clients.length
        ? '<div class="search-help">名前を入力するとクライアントが表示されます</div>'
        : '<div class="search-empty">まだクライアントが登録されていません</div>';
      clientSearchResults.hidden=false;
    }else{
      clientSearchResults.innerHTML='';
      clientSearchResults.hidden=true;
    }
    return;
  }

  const matches=state.clients
    .filter(c=>String(c.name||'').toLowerCase().includes(q))
    .slice(0,30);

  clientSearchResults.innerHTML=matches.length
    ? matches.map(c=>`<button type="button" class="search-result ${c.id===state.activeClientId?'active':''}" data-client-id="${c.id}">
        <strong>${esc(c.name)}</strong>
        <small>${esc(c.goal||'目標未設定')} / ${c.age||'—'}歳 / ${esc(c.sex||'—')} / ${c.height||'—'}cm</small>
        <span class="search-result-arrow" aria-hidden="true">›</span>
      </button>`).join('')
    : '<div class="search-empty">該当するクライアントがいません</div>';
  clientSearchResults.hidden=false;
}

clientSearch.addEventListener('focus',()=>{
  if(currentView==='clients' || clientSearch.value.trim()){
    renderClientSearchResults(clientSearch.value);
  }
});
clientSearch.addEventListener('input',()=>renderClientSearchResults(clientSearch.value));

clientSearchResults.addEventListener('click',e=>{
  const btn=e.target.closest('[data-client-id]');
  if(!btn)return;

  state.activeClientId=btn.dataset.clientId;
  save();

  clientSearch.value='';
  clientSearchResults.hidden=true;

  // 必ず選択したクライアントのダッシュボードへ遷移
  currentView='dashboard';
  closeMobileMenu();
  applyView('dashboard');
  render();
  applyView('dashboard');
  requestAnimationFrame(()=>{
    window.scrollTo({top:0,left:0,behavior:'auto'});
  });
});

document.addEventListener('click',e=>{
  if(currentView!=='clients' && !e.target.closest('.client-search-wrap')){
    clientSearchResults.hidden=true;
  }
});


function renderClientList(){
  if(clientCountLabel)clientCountLabel.textContent=`${state.clients.length}名`;
}
document.getElementById('addClientShortcut')?.addEventListener('click',()=>{
  clientForm.reset();clientSelect.value='';clientDialog.showModal();setTimeout(()=>clientForm.elements.name.focus(),50);
});


function openMobileMenu(){
  sidebar?.classList.add('open');
  if(sidebarBackdrop) sidebarBackdrop.hidden=false;
}
function closeMobileMenu(){
  sidebar?.classList.remove('open');
  if(sidebarBackdrop) sidebarBackdrop.hidden=true;
}
mobileMenuBtn?.addEventListener('click',openMobileMenu);
mobileMenuClose?.addEventListener('click',closeMobileMenu);
sidebarBackdrop?.addEventListener('click',closeMobileMenu);

// Backup
const backupDialog=document.getElementById('backupDialog');
document.getElementById('menuBackupBtn')?.addEventListener('click',()=>{closeMobileMenu();backupDialog.showModal();});
document.getElementById('exportBackupBtn').onclick=()=>{
  download(`pt-analytics-backup-${today()}.json`,JSON.stringify(state,null,2),'application/json');
};
document.getElementById('importBackupInput').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.clients)||!Array.isArray(data.training)||!Array.isArray(data.body)) throw new Error();
    if(confirm('現在の端末データを、このバックアップ内容で置き換えますか？')){
      state=normalizeState(data);save();backupDialog.close();render();
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
    ...tr.map(x=>[x.date,x.exercise,x.weight,x.reps,x.sets,x.rpe,n(e1rm(x.weight,x.reps))]),
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


function signed(v,d=1,unit=''){
  if(v==null || !Number.isFinite(Number(v))) return '—';
  const num=Number(v);
  return `${num>0?'+':''}${num.toFixed(d)}${unit}`;
}
function filterByRange(rows,days){
  if(!days)return rows;
  const cutoff=new Date();cutoff.setHours(0,0,0,0);cutoff.setDate(cutoff.getDate()-days);
  return rows.filter(x=>new Date(x.date+'T00:00:00')>=cutoff);
}
function latestTwo(rows){
  const r=rows.slice().sort((a,b)=>a.date.localeCompare(b.date));
  return r.length>=2?[r[r.length-1],r[r.length-2]]:[r[r.length-1]||null,null];
}
function percentChange(cur,prev){
  if(cur==null||prev==null||Number(prev)===0)return null;
  return ((Number(cur)-Number(prev))/Math.abs(Number(prev)))*100;
}
function groupVolumeByDate(rows){
  const map={};
  rows.forEach(x=>{map[x.date]=(map[x.date]||0)+(Number(x.weight)||0)*(Number(x.reps)||0)*(Number(x.sets)||0)});
  return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([date,value])=>({date,value}));
}

function render(){
  const c=active();
  fillClientSelects();refreshExercises();

  if(!c){
    document.body.classList.add('no-client');
    document.getElementById('clientTitle').textContent='未登録';
    document.getElementById('clientName').textContent='未登録';
    document.getElementById('clientMeta').textContent='クライアントを登録してください';
    document.getElementById('clientGoal').textContent='目標：未登録';
    const ns=document.getElementById('noClientState');if(ns)ns.hidden=false;

    document.getElementById('kpiGrid').innerHTML=[
      ['最新体重','—'],['水分量','—'],['睡眠','—'],['推定1RM BEST','—'],['総ボリューム','—']
    ].map(x=>`<article class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="change">クライアント未登録</div></article>`).join('');

    document.getElementById('trainingTable').innerHTML='<tr><td colspan="6">クライアントを登録してください</td></tr>';
    const bt=document.getElementById('bodyTable');if(bt)bt.innerHTML='<tr><td colspan="8">クライアントを登録してください</td></tr>';
    const cl=document.getElementById('clientList');if(cl)cl.innerHTML='<div class="search-empty">まだクライアントが登録されていません</div>';
    if(clientCountLabel)clientCountLabel.textContent='0名';
    const report=document.getElementById('reportSummary');if(report)report.innerHTML='<div class="report-line"><span>状態</span><strong>未登録</strong></div>';
    ['weightChart','waterChart','sleepChart','stepsChart','ormChart','volumeChart','exerciseWeightChart','exerciseOrmChart','exerciseVolumeChart'].forEach(id=>{
      const s=document.getElementById(id);if(s){s.innerHTML='';emptyChart(s)}
    });
    applyView(currentView);
    return;
  }

  document.body.classList.remove('no-client');
  const ns=document.getElementById('noClientState');if(ns)ns.hidden=true;
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
  const best=trAll.length?Math.max(...trAll.map(x=>e1rm(x.weight,x.reps))):null;
  const vol=trAll.reduce((s,x)=>s+x.weight*x.reps*x.sets,0);
  const kpis=[
    ['最新体重',lastW==null?'—':n(lastW)+' kg'],
    ['水分量',lastWater==null?'—':n(lastWater)+' L'],
    ['睡眠',lastSleep==null?'—':n(lastSleep)+' h'],
    ['推定1RM BEST',best==null?'—':n(best)+' kg'],
    ['総ボリューム',vol?Math.round(vol).toLocaleString()+' kg':'—']
  ];
  document.getElementById('kpiGrid').innerHTML=kpis.map(x=>`<article class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div></article>`).join('');

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

  document.getElementById('trainingTable').innerHTML=tr.slice().reverse().slice(0,20).map(x=>`<tr><td>${x.date}</td><td>${esc(x.exercise)}</td><td>${x.weight}kg</td><td>${x.reps}</td><td>${n(e1rm(x.weight,x.reps))}kg</td><td><div class="table-actions"><button class="edit-btn" onclick="editTraining('${x.id}')">編集</button><button class="action-btn" onclick="removeTraining('${x.id}')">削除</button></div></td></tr>`).join('')||'<tr><td colspan="6">まだ記録がありません</td></tr>';

  const last7=bdAll.slice(-7);
  document.getElementById('conditionSummary').innerHTML=[
    ['💧',avg(last7,'water'),'L','平均水分'],['😴',avg(last7,'sleep'),'h','平均睡眠'],['🚶',avg(last7,'steps'),'','平均歩数'],['⚡',avg(last7,'condition'),'/10','平均体調']
  ].map(([i,v,u,t])=>`<div class="condition"><div class="icon">${i}</div><div class="num">${v==null?'—':(u===''?Math.round(v).toLocaleString():n(v))}${v==null?'':u}</div><div class="txt">${t}</div></div>`).join('');

  document.getElementById('bodyTable').innerHTML=bdAll.slice().reverse().slice(0,20).map(x=>`<tr><td>${x.date}</td><td>${x.bodyWeight||'—'}</td><td>${x.bodyFat||'—'}</td><td>${x.water||'—'}</td><td>${x.sleep||'—'}</td><td>${x.steps?Number(x.steps).toLocaleString():'—'}</td><td>${x.condition||'—'}</td><td><div class="table-actions"><button class="edit-btn" onclick="editBody('${x.id}')">編集</button><button class="action-btn" onclick="removeBody('${x.id}')">削除</button></div></td></tr>`).join('')||'<tr><td colspan="8">まだ記録がありません</td></tr>';

  const startWeight=bd.length?bd.find(x=>x.bodyWeight)?.bodyWeight:null;
  const endWeight=bd.length?[...bd].reverse().find(x=>x.bodyWeight)?.bodyWeight:null;
  const periodBest=tr.length?Math.max(...tr.map(x=>e1rm(x.weight,x.reps))):null;
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


  renderClientList();
  const histName=document.getElementById('trainingHistoryClientName');if(histName)histName.textContent=c.name;

  const progressExercise=progressExerciseSelect?.value || trAll[0]?.exercise || state.exercises[0];
  if(progressExerciseSelect && progressExercise && !progressExerciseSelect.value)progressExerciseSelect.value=progressExercise;

  const rangeDays=Number(progressRangeSelect?.value||90);
  const allExerciseRows=trAll.filter(x=>x.exercise===progressExercise);
  const progressRows=filterByRange(allExerciseRows,rangeDays);
  const [latestSet,prevSet]=latestTwo(allExerciseRows);

  const bestWeight=progressRows.length?Math.max(...progressRows.map(x=>Number(x.weight)||0)):null;
  const bestOrm=progressRows.length?Math.max(...progressRows.map(x=>e1rm(x.weight,x.reps))):null;
  const latestWeight=latestSet?.weight??null;
  const latestOrm=latestSet?e1rm(latestSet.weight,latestSet.reps):null;
  const prevOrm=prevSet?e1rm(prevSet.weight,prevSet.reps):null;

  document.getElementById('progressBestWeight').textContent=bestWeight?`${n(bestWeight)} kg`:'—';
  document.getElementById('progressBestOrm').textContent=bestOrm?`${n(bestOrm)} kg`:'—';
  document.getElementById('progressLatestWeight').textContent=latestWeight?`${n(latestWeight)} kg`:'—';
  document.getElementById('progressRecordCount').textContent=`${progressRows.length}件`;
  document.getElementById('progressWeightChange').textContent=latestSet&&prevSet?signed(Number(latestSet.weight)-Number(prevSet.weight),1,' kg'):'—';
  document.getElementById('progressRepsChange').textContent=latestSet&&prevSet?signed(Number(latestSet.reps)-Number(prevSet.reps),0,'回'):'—';
  document.getElementById('progressOrmChange').textContent=latestSet&&prevSet?signed(latestOrm-prevOrm,1,' kg'):'—';

  const previousBestOrm=allExerciseRows.length>1?Math.max(...allExerciseRows.slice(0,-1).map(x=>e1rm(x.weight,x.reps))):null;
  const prBanner=document.getElementById('prBanner');
  if(latestOrm && previousBestOrm && latestOrm>previousBestOrm){
    prBanner.hidden=false;
    prBanner.textContent=`🏆 自己ベスト更新：推定1RM ${n(latestOrm)} kg`;
  }else if(prBanner){prBanner.hidden=true}

  drawLine('exerciseWeightChart',progressRows.map(x=>({date:x.date,value:x.weight})));
  drawLine('exerciseOrmChart',progressRows.map(x=>({date:x.date,value:e1rm(x.weight,x.reps)})));
  drawBars('exerciseVolumeChart',groupVolumeByDate(progressRows));

  // Client-level progress summary (last 90 days vs previous 90 days)
  const cur90=filterByRange(trAll,90);
  const body90=filterByRange(bdAll,90);
  const now=new Date();now.setHours(0,0,0,0);
  const start90=new Date(now);start90.setDate(start90.getDate()-90);
  const start180=new Date(now);start180.setDate(start180.getDate()-180);
  const prev90=trAll.filter(x=>{const d=new Date(x.date+'T00:00:00');return d>=start180&&d<start90});
  const prevBody90=bdAll.filter(x=>{const d=new Date(x.date+'T00:00:00');return d>=start180&&d<start90});

  const curBest=cur90.length?Math.max(...cur90.map(x=>e1rm(x.weight,x.reps))):null;
  const prevBest=prev90.length?Math.max(...prev90.map(x=>e1rm(x.weight,x.reps))):null;
  const curVol90=cur90.reduce((s,x)=>s+x.weight*x.reps*x.sets,0);
  const prevVol90=prev90.reduce((s,x)=>s+x.weight*x.reps*x.sets,0);
  const curWeight=latest(body90,'bodyWeight');
  const prevWeight=latest(prevBody90,'bodyWeight');

  const summaryItems=[
    ['トレーニング件数',`${cur90.length}件`,percentChange(cur90.length,prev90.length)],
    ['総ボリューム',curVol90?`${Math.round(curVol90).toLocaleString()} kg`:'—',percentChange(curVol90,prevVol90)],
    ['推定1RM BEST',curBest?`${n(curBest)} kg`:'—',percentChange(curBest,prevBest)],
    ['体重',curWeight?`${n(curWeight)} kg`:'—',curWeight!=null&&prevWeight!=null?Number(curWeight)-Number(prevWeight):null]
  ];
  const summaryGrid=document.getElementById('progressSummaryGrid');
  summaryGrid.innerHTML=summaryItems.map(([label,value,delta],i)=>{
    let deltaText='比較データなし',cls='summary-neutral';
    if(delta!=null){
      if(i===3){deltaText=`前期間比 ${signed(delta,1,' kg')}`;cls=delta<0?'summary-positive':delta>0?'summary-negative':'summary-neutral'}
      else {deltaText=`前期間比 ${signed(delta,1,'%')}`;cls=delta>0?'summary-positive':delta<0?'summary-negative':'summary-neutral'}
    }
    return `<div class="summary-tile"><span>${label}</span><strong>${value}</strong><div class="${cls}" style="font-size:12px;margin-top:6px">${deltaText}</div></div>`;
  }).join('');
  drawLine('weightChart',bd.filter(x=>x.bodyWeight).map(x=>({date:x.date,value:x.bodyWeight})));
  drawLine('waterChart',bd.filter(x=>x.water).map(x=>({date:x.date,value:x.water})));
  drawLine('sleepChart',bd.filter(x=>x.sleep).map(x=>({date:x.date,value:x.sleep})));
  drawLine('stepsChart',bd.filter(x=>x.steps).map(x=>({date:x.date,value:x.steps})));
  drawLine('ormChart',tr.map(x=>({date:x.date,value:e1rm(x.weight,x.reps)})));
  drawBars('volumeChart',groupVolumeByDate(tr));
  applyView(currentView);
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

const viewTitles={
  dashboard:'ダッシュボード',
  clients:'クライアント一覧',
  training:'トレーニング',
  body:'身体データ',
  condition:'生活・コンディション',
  report:'レポート'
};

function setActiveNav(view){
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>{
    b.classList.toggle('active',b.dataset.view===view);
  });
}
function applyView(view){
  currentView=viewTitles[view]?view:'dashboard';

  document.querySelectorAll('[data-section]').forEach(el=>{
    el.classList.toggle('view-hidden',el.dataset.section!==currentView);
  });

  document.body.classList.toggle('clients-view',currentView==='clients');

  const title=document.getElementById('viewTitle');
  if(title)title.textContent=viewTitles[currentView];

  setActiveNav(currentView);

  if(currentView==='clients'){
    renderClientSearchResults(clientSearch.value);
  }else{
    clientSearchResults.hidden=true;
  }

  window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    closeMobileMenu();
    applyView(btn.dataset.view);
  });
});


document.getElementById('authForm')?.addEventListener('submit',async e=>{
  e.preventDefault();if(!sb){setAuthMessage('Supabase設定が未完了です。','error');return}
  const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;
  setAuthMessage('ログイン中...');
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error)setAuthMessage(error.message,'error');
});
document.getElementById('signupBtn')?.addEventListener('click',async()=>{
  if(!sb){setAuthMessage('Supabase設定が未完了です。','error');return}
  const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;
  if(!email||password.length<6){setAuthMessage('メールアドレスと6文字以上のパスワードを入力してください。','error');return}
  setAuthMessage('登録中...');
  const {data,error}=await sb.auth.signUp({email,password});
  if(error)setAuthMessage(error.message,'error'); else if(data.session)setAuthMessage('登録しました。','success'); else setAuthMessage('確認メールを確認してください。','success');
});
document.getElementById('menuAccountBtn')?.addEventListener('click',()=>{closeMobileMenu();document.getElementById('accountDialog')?.showModal();});
document.getElementById('logoutBtn')?.addEventListener('click',async()=>{await sb?.auth.signOut();document.getElementById('accountDialog')?.close()});
bootCloud();


document.getElementById('migrateLocalBtn')?.addEventListener('click',async()=>{
  if(!sb||!currentUser)return;
  const legacyKeys=['ptAnalyticsV5','ptAnalyticsV4','ptAnalyticsV3','ptAnalyticsV2','ptAnalytics'];
  let legacy=null;
  for(const k of legacyKeys){
    try{
      const raw=localStorage.getItem(k);
      if(!raw)continue;
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed.clients)&&parsed.clients.length){legacy=normalizeState(parsed);break}
    }catch(e){}
  }
  if(!legacy||!legacy.clients.length){alert('この端末に移行できる旧データが見つかりませんでした。');return}
  if(!confirm(`${legacy.clients.length}名の旧データを現在のクラウドアカウントへ移行しますか？`))return;
  state=legacy;
  ensureUuidState();
  const raw=JSON.stringify(state);localStorage.setItem(KEY,raw);localStorage.setItem('ptAnalyticsV2',raw);
  cloudReady=true;
  await pushFullStateToCloud();
  await fetchCloudState();
  alert('クラウドへの移行が完了しました。');
} );

render();
