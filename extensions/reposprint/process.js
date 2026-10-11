import {pageRequest,trpcData} from './protocol.js';
export function isBusinessApproval(phase){return phase?.currentPhase==='business_approved'&&phase.phaseStatus!=='completed'&&phase.phaseStatus!=='done'}
export function joinProcesses(issues,phases){const map=new Map(phases.map(x=>[x.issueId,x]));return issues.map(issue=>({...issue,process:map.get(issue.id)||null}))}
export async function loadProcesses(workspace,request=pageRequest){
 async function read(action,value){const result=await request(action,workspace,value);if(result.error)throw Error(result.error);return trpcData(result.payload)}
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
