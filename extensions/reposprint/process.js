import {pageRequest,trpcData} from './protocol.js';
export function isBusinessApproval(phase){return phase?.currentPhase==='business_approved'&&phase.phaseStatus!=='completed'&&phase.phaseStatus!=='done'}
export function joinProcesses(issues,phases){const map=new Map(phases.map(x=>[x.issueId,x]));return issues.map(issue=>({...issue,process:map.get(issue.id)||null}))}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let nextRequestAt=0,running=false;const queue=[];
function runNext(){if(running||!queue.length)return;running=true;const job=queue.shift();job.run().then(job.resolve,job.reject).finally(()=>{running=false;runNext()})}
export function processRead(workspace,action,value,request=pageRequest,pause=wait,priority=false){
 const run=async()=>{for(let attempt=0;attempt<4;attempt++){
 const delay=nextRequestAt-Date.now();if(delay>60000||(request===pageRequest&&delay>1500))throw Object.assign(Error('A consulta será retomada automaticamente após a pausa solicitada pelo RepoSprint.'),{retryAt:nextRequestAt});if(delay>0)await pause(delay);
 const result=await request(action,workspace,value);nextRequestAt=Date.now()+1500;
 if(result.rateLimited){nextRequestAt=Date.now()+Math.max(result.retryAfterMs||30000,30000);const error=Error(result.error);error.retryAt=nextRequestAt;throw error}
 if(result.error)throw Error(result.error);return trpcData(result.payload);
 }};return new Promise((resolve,reject)=>{const job={run,resolve,reject};priority?queue.unshift(job):queue.push(job);runNext()});
}
export async function loadIssueProcess(workspace,ref,request=pageRequest,pause=wait,knownRow=null){
 const data=knownRow?{issues:[knownRow]}:await processRead(workspace,'issue.list',ref.number,request,pause,true),issues=Array.isArray(data?.issues)?data.issues:[];
 const row=issues.find(x=>Number(x.number)===ref.number&&String(x.githubUrl||'').toLowerCase()==='https://github.com/'+ref.repository.toLowerCase()+'/issues/'+ref.number);
 if(!row)throw Error('Esta issue não foi encontrada no workspace selecionado.');
 const phases=await processRead(workspace,'process.lifecycle.phaseSummaries',[row.id],request,pause,true);if(!Array.isArray(phases))throw Error('Resposta de fases inválida.');
 return {workspace,checkedAt:Date.now(),items:joinProcesses([row],phases),individual:true};
}
export async function loadProcesses(workspace,request=pageRequest,pause=wait,options={}){
 async function read(action,value){return processRead(workspace,action,value,request,pause,!!options.approvals)}
 const seed=new Map();
 if(options.approvals){const backlog=await read('backlog.list');if(!Array.isArray(backlog))throw Error('Resposta do backlog inválida.');for(const x of backlog){if(!x.issueId)continue;const row={id:x.issueId,number:x.number,title:x.title,state:x.state,author:x.author||'',githubUrl:x.githubUrl||'',process:{currentPhase:x.currentPhase,phaseLabel:x.phaseLabel,phaseStatus:x.phaseStatus,enteredCurrentPhaseAt:x.enteredCurrentPhaseAt,phaseAssignee:x.assignedTo||null}};if(isBusinessApproval(row.process)&&row.state==='open')seed.set(row.id,row)}await options.onProgress?.({workspace,checkedAt:Date.now(),items:[...seed.values()],partial:true,total:null,scope:'approvals'});}
 const merged=(issues,phases)=>{const rows=new Map(seed);for(const row of joinProcesses([...issues.values()],phases))rows.set(row.id,row);return [...rows.values()]};
 const phases=[];const issues=new Map();let expected=null;
 for(let page=1;page<=200;page++){
  const data=await read(options.approvals?'process.approvalList':'process.issueList',page);
  if(!Array.isArray(data?.issues)||!Number.isSafeInteger(data.total)||data.total<0)throw Error('Lista do workspace incompleta. Nenhum aviso foi atualizado.');
  if(expected!==null&&expected!==data.total)throw Error('O workspace mudou durante a consulta. A ferramenta tentará novamente.');expected=data.total;
  for(const row of data.issues){if(typeof row.id!=='string'||issues.has(row.id))throw Error('A paginação mudou durante a consulta. A ferramenta tentará novamente.');issues.set(row.id,{id:row.id,number:row.number,title:row.title,author:row.author,githubUrl:row.githubUrl,state:row.state,deletedAt:row.deletedAt})}
  const ids=data.issues.map(x=>x.id);if(ids.length){const current=await read('process.lifecycle.phaseSummaries',ids);if(!Array.isArray(current))throw Error('Resposta de fases inválida.');const seen=new Set();for(const phase of current){if(!ids.includes(phase.issueId)||seen.has(phase.issueId))throw Error('Resposta de fases inconsistente.');seen.add(phase.issueId);phases.push(phase)}}
  await options.onProgress?.({workspace,checkedAt:Date.now(),items:merged(issues,phases),partial:issues.size!==expected,total:expected,scope:options.approvals?'approvals':'workspace'});
  if(issues.size===expected)break;
  if(!data.issues.length||issues.size>expected||page===200)throw Error('Lista do workspace incompleta. Nenhum aviso foi atualizado.');
 }
 return {workspace,checkedAt:Date.now(),items:merged(issues,phases),scope:options.approvals?'approvals':'workspace',partial:false};
}
