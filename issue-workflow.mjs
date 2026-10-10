export const DRAFT_FIELDS = ['title','requester','date','units','frequency','problem','description','impacts','today','nonimplementation','motivation','otherMotivation','urgency'];
export function workflowError(message,status=400){return Object.assign(new Error(message),{status})}
export function validateHistoryEntry(item){
  if(!item||!Number.isSafeInteger(item.number)||item.number<1||typeof item.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(item.repository)||typeof item.title!=='string')throw workflowError('Registro de histórico inválido.');
  let url;try{url=new URL(item.url)}catch{throw workflowError('Link da issue inválido.')}
  if(url.origin!=='https://github.com'||url.pathname.toLowerCase()!==('/'+item.repository+'/issues/'+item.number).toLowerCase()||url.search||url.hash)throw workflowError('O link não corresponde à issue.');
  return {issueState:['open','closed'].includes(item.issueState)?item.issueState:'unknown',stateCheckedAt:Number.isFinite(item.stateCheckedAt)&&item.stateCheckedAt>0&&item.stateCheckedAt<=Date.now()+60000?Math.trunc(item.stateCheckedAt):0,stateCheckError:typeof item.stateCheckError==='string'?item.stateCheckError.slice(0,200):'',number:item.number,title:item.title.slice(0,256),url:url.href,repository:item.repository.toLowerCase(),labels:Array.isArray(item.labels)?item.labels.filter(x=>typeof x==='string').slice(0,100):[],project:typeof item.project==='string'?item.project.slice(0,200):'',status:typeof item.status==='string'?item.status.slice(0,200):'',createdAt:typeof item.createdAt==='number'&&Number.isFinite(item.createdAt)&&item.createdAt>0&&item.createdAt<=Date.now()+60000?Math.trunc(item.createdAt):Date.now()};
}
export function fieldRefinementInstruction(body,properties){
  if(!Object.hasOwn(properties,body.field)||body.field==='questions')return '';
  const instruction=typeof body.fieldInstruction==='string'?body.fieldInstruction.trim():'';
  if(instruction.length>2000)throw workflowError('A orientação deve ter até 2.000 caracteres.');
  return '\nRefaça somente o campo '+body.field+'. Use os demais campos como contexto e preserve seus fatos. Retorne o JSON do schema, mas concentre sua análise e melhoria nesse campo.'+(instruction?'\nOrientação de revisão fornecida pelo usuário: '+JSON.stringify(instruction)+'. Aplique-a somente a esse campo, preservando as regras de formato e a distinção entre fatos e hipóteses.':'');
}
export function validateSavedDraft(body){
  const name=typeof body.name==='string'?body.name.trim().slice(0,120):'';
  if(!name)throw workflowError('Informe um nome para o rascunho.');
  if(!body.snapshot||typeof body.snapshot!=='object'||Array.isArray(body.snapshot))throw workflowError('Rascunho inválido.');
  const snapshot={};for(const key of [...DRAFT_FIELDS,'raw','classificationPreference','aiClassification'])snapshot[key]=typeof body.snapshot[key]==='string'?body.snapshot[key]:'';
  snapshot.attachments={};
  for(const field of DRAFT_FIELDS){
    const items=body.snapshot.attachments?.[field];if(!Array.isArray(items))continue;
    snapshot.attachments[field]=items.filter(item=>item&&typeof item.name==='string'&&/^(image|video)\//.test(item.type)&&/^https:\/\/github\.com\/user-attachments\/assets\/[a-zA-Z0-9-]+$/.test(item.url)).map(item=>({name:item.name.slice(0,180),type:item.type,url:item.url,markdown:item.type.startsWith('image/')?'!['+item.name.replace(/[\[\]\r\n]/g,'')+']('+item.url+')':item.url}));
  }
  snapshot.labels=Array.isArray(body.snapshot.labels)?body.snapshot.labels.filter(x=>typeof x==='string').slice(0,100):[];
  snapshot.repository=typeof body.snapshot.repository==='string'?body.snapshot.repository:'';
  snapshot.projectId=typeof body.snapshot.projectId==='string'?body.snapshot.projectId:'';
  snapshot.statusOptionId=typeof body.snapshot.statusOptionId==='string'?body.snapshot.statusOptionId:'';
  if(new TextEncoder().encode(JSON.stringify(snapshot)).length>100000)throw workflowError('O rascunho excede 100 KB.',413);
  return {name,snapshot};
}
const ignored=new Set('melhoria requisito bug incluir adicionar implementar ajustar corrigir novo nova tela inicial para pelo pela pelos pelas com sem uma umas uns tipo como que dos das todas todos'.split(' '));
export function titleWords(title){return [...new Set(String(title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(x=>!ignored.has(x)).slice(0,10)}
export function rankSimilarIssues(title,items){
  const words=titleWords(title);if(!words.length)return [];
  return items.filter(item=>!item.pull_request).map(item=>{const other=titleWords(item.title),shared=words.filter(w=>other.includes(w)).length;return {number:item.number,title:item.title,url:item.html_url,state:item.state,score:shared/Math.max(words.length,other.length,1),shared}}).filter(item=>item.score>=0.35&&(item.shared>=2||words.length===1)).sort((a,b)=>b.score-a.score).slice(0,5);
}
export async function findSimilarIssues(connection,title,api){
  if(!connection)throw workflowError('Conecte um repositório GitHub primeiro.',409);
  const words=titleWords(title);if(!words.length)return {issues:[],limited:false};
  const searches=await Promise.all(words.slice(0,3).map(async word=>{
    const q='repo:'+connection.owner+'/'+connection.repo+' is:issue in:title '+word;
    const response=await api('/search/issues?q='+encodeURIComponent(q)+'&per_page=50&sort=updated',connection.token);
    if(!response.ok)throw workflowError('Não foi possível consultar issues semelhantes no GitHub.',response.status);
    return response.json();
  }));
  const items=[...new Map(searches.flatMap(data=>data.items||[]).map(item=>[item.number,item])).values()];
  return {issues:rankSimilarIssues(title,items),limited:searches.some(data=>data.incomplete_results||data.total_count>50)};
}
