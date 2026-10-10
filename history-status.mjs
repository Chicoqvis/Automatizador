import { workflowError } from './issue-workflow.mjs';

export function historyStatusTargets(body,entries){
  if(!Array.isArray(body.issues)||body.issues.length>25)throw workflowError('Atualize até 25 issues por consulta.');
  const keys=new Set(body.issues.map(item=>{
    if(!item||!Number.isSafeInteger(item.number)||item.number<1||typeof item.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(item.repository))throw workflowError('Referência de histórico inválida.');
    return item.repository.toLowerCase()+'#'+item.number;
  }));
  return entries.filter(entry=>keys.has(entry.repository.toLowerCase()+'#'+entry.number));
}

export async function refreshIssueStates(entries,connection,githubApi,now=Date.now()){
  if(!connection)throw workflowError('Conecte um repositório GitHub para atualizar os status.',409);
  const repository=(connection.owner+'/'+connection.repo).toLowerCase();
  const targets=entries.filter(entry=>entry.repository.toLowerCase()===repository);
  const updated=[];let cursor=0;
  // At most 25 subrequests per batch, four at a time, within Workers Free limits.
  async function run(){while(cursor<targets.length){const entry=targets[cursor++];let next={...entry};try{
    const response=await githubApi(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/issues/${entry.number}`,connection.token,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error(response.status===404?'Issue não encontrada ou sem permissão de acesso.':response.status===403||response.status===429?'GitHub limitou a consulta ou negou acesso. Tente novamente mais tarde.':'Não foi possível consultar esta issue no GitHub.');
    const issue=await response.json();
    if(issue.pull_request||issue.number!==entry.number||!['open','closed'].includes(issue.state))throw new Error('GitHub não retornou um status válido para esta issue.');
    next.issueState=issue.state;next.stateCheckedAt=now;next.stateCheckError='';
  }catch(error){next.stateCheckError=(error.name==='TimeoutError'?'A consulta demorou mais que o esperado. Tente novamente.':error.message==='Failed to fetch'?'Não foi possível conectar ao GitHub.':error.message||'Falha ao consultar o GitHub.').slice(0,200)}
  updated.push(next)}}
  await Promise.all(Array.from({length:Math.min(4,targets.length)},run));
  return {entries:updated,updated:updated.filter(entry=>!entry.stateCheckError).length,failed:updated.filter(entry=>entry.stateCheckError).length,skipped:entries.length-targets.length};
}
