import { workflowError } from './issue-workflow.mjs';
export function issueReference(search){const repository=(search.get('repository')||'').toLowerCase(),number=Number(search.get('number'));if(!/^[-\w.]+\/[-\w.]+$/.test(repository)||!Number.isSafeInteger(number)||number<1)throw workflowError('Referência de issue inválida.');return {repository,number}}
async function revision(title,body){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([title,body])));return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')}
export async function readEditableIssue(entry,connection,api){
  if(!connection||(connection.owner+'/'+connection.repo).toLowerCase()!==entry.repository.toLowerCase())throw workflowError('Conecte o repositório '+entry.repository+' para editar esta issue.',409);
  const response=await api(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/issues/${entry.number}`,connection.token,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw workflowError('Não foi possível abrir a issue no GitHub. Confira o acesso ao repositório.',response.status===404?404:502);
  const issue=await response.json();if(issue.pull_request||issue.number!==entry.number||typeof issue.title!=='string')throw workflowError('O GitHub não retornou a issue esperada.',502);
  const body=typeof issue.body==='string'?issue.body:'';
  return {repository:entry.repository,number:entry.number,title:issue.title,body,revision:await revision(issue.title,body),issueState:issue.state==='closed'?'closed':'open',stateCheckedAt:Date.now(),labels:(issue.labels||[]).map(x=>typeof x==='string'?x:x.name)};
}
export async function updateExistingIssue(entry,connection,body,api){
  const title=typeof body.title==='string'?body.title.trim():'',text=typeof body.body==='string'?body.body:'';
  if(!title||title.length>256||!text.trim()||text.length>60000)throw workflowError('Informe título de até 256 caracteres e conteúdo de até 60.000 caracteres.');
  if(typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision))throw workflowError('Abra a issue antes de atualizar.');
  const current=await readEditableIssue(entry,connection,api);
  // Retrying a lost response is safe: an already-applied edit is not sent twice.
  if(current.title===title&&current.body===text)return {...current,recovered:true};
  if(current.revision!==body.revision)throw workflowError('A issue foi alterada no GitHub desde que você a abriu. Seu rascunho foi preservado. Recarregue a versão do GitHub e revise antes de atualizar.',409);
  const response=await api(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/issues/${entry.number}`,connection.token,{method:'PATCH',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body:text})});
  if(!response.ok)throw workflowError('GitHub não confirmou a atualização. Seu rascunho foi preservado; verifique as permissões e tente novamente.',response.status===403?403:502);
  const updated=await response.json();if(updated.number!==entry.number)throw workflowError('Não foi possível confirmar a atualização da issue.',502);
  return {...current,title,body:text,revision:await revision(title,text),issueState:updated.state==='closed'?'closed':'open',stateCheckedAt:Date.now()};
}
export function revisedMemoryContent(content,body){const marker='Issue revisada e enviada:\n',index=String(content||'').indexOf(marker);return (index>=0?content.slice(0,index):'')+marker+body.slice(0,30000)}
