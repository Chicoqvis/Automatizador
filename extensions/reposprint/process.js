import {pageRequest,trpcData} from './protocol.js';
export function isBusinessApproval(phase){return phase?.currentPhase==='business_approved'&&phase.phaseStatus!=='completed'&&phase.phaseStatus!=='done'}
export function joinProcesses(issues,phases){const map=new Map(phases.map(x=>[x.issueId,x]));return issues.map(issue=>({...issue,process:map.get(issue.id)||null}))}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let nextRequestAt=0,requestTail=Promise.resolve();
export function processRead(workspace,action,value,request=pageRequest,pause=wait){
 const task=requestTail.catch(()=>{}).then(async()=>{for(let attempt=0;attempt<4;attempt++){
 const delay=nextRequestAt-Date.now();if(delay>60000)throw Object.assign(Error('A consulta será retomada automaticamente após a pausa solicitada pelo RepoSprint.'),{retryAt:nextRequestAt});if(delay>0)await pause(delay);
 const result=await request(action,workspace,value);nextRequestAt=Date.now()+1500;
 if(result.rateLimited){nextRequestAt=Date.now()+Math.max(result.retryAfterMs||30000,Math.min(60000,30000*(attempt+1)));if(attempt<3&&nextRequestAt-Date.now()<=60000)continue;const error=Error(result.error);error.retryAt=nextRequestAt;throw error}
 if(result.error)throw Error(result.error);return trpcData(result.payload);
 }});requestTail=task;return task;
}
export async function loadIssueProcess(workspace,ref,request=pageRequest,pause=wait){
 const data=await processRead(workspace,'issue.list',ref.number,request,pause),issues=Array.isArray(data?.issues)?data.issues:[];
 const row=issues.find(x=>Number(x.number)===ref.number&&String(x.githubUrl||'').toLowerCase()==='https://github.com/'+ref.repository.toLowerCase()+'/issues/'+ref.number);
 if(!row)throw Error('Esta issue não foi encontrada no workspace selecionado.');
 const phases=await processRead(workspace,'process.lifecycle.phaseSummaries',[row.id],request,pause);if(!Array.isArray(phases))throw Error('Resposta de fases inválida.');
 return {workspace,checkedAt:Date.now(),items:joinProcesses([row],phases),individual:true};
}
export async function loadProcesses(workspace,request=pageRequest,pause=wait){
 async function read(action,value){return processRead(workspace,action,value,request,pause)}
 const issues=new Map();let expected=null;
 for(let page=1;page<=200;page++){
  const data=await read('process.issueList',page);
  if(!Array.isArray(data?.issues)||!Number.isSafeInteger(data.total)||data.total<0)throw Error('Lista do workspace incompleta. Nenhum aviso foi atualizado.');
  if(expected!==null&&expected!==data.total)throw Error('O workspace mudou durante a consulta. A ferramenta tentará novamente.');expected=data.total;
  for(const row of data.issues){if(typeof row.id!=='string'||issues.has(row.id))throw Error('A paginação mudou durante a consulta. A ferramenta tentará novamente.');issues.set(row.id,{id:row.id,number:row.number,title:row.title,author:row.author,githubUrl:row.githubUrl,state:row.state,deletedAt:row.deletedAt})}
  if(issues.size===expected)break;
  if(!data.issues.length||issues.size>expected||page===200)throw Error('Lista do workspace incompleta. Nenhum aviso foi atualizado.');
 }
 const rows=[...issues.values()],phases=[];
 for(let i=0;i<rows.length;i+=50){const ids=rows.slice(i,i+50).map(x=>x.id),data=await read('process.lifecycle.phaseSummaries',ids);if(!Array.isArray(data))throw Error('Resposta de fases inválida.');const seen=new Set();for(const row of data){if(!ids.includes(row.issueId)||seen.has(row.issueId))throw Error('Resposta de fases inconsistente.');seen.add(row.issueId);phases.push(row)}}
 return {workspace,checkedAt:Date.now(),items:joinProcesses(rows,phases)};
}
