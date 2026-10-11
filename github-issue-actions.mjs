import { workflowError } from './issue-workflow.mjs';
import { readEditableIssue } from './issue-editor.mjs';
import { recoverableIssue } from './issue-recovery.mjs';
export async function labelsRevision(labels){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...new Set(labels)].sort())));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')}
const sameLabels=(a,b)=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
export async function setIssueLabels(entry,connection,body,api,options){
  if(!Array.isArray(body.labels)||body.labels.length>100||body.labels.some(x=>typeof x!=='string'||!x.trim()||x.length>100))throw workflowError('Selecione até 100 labels válidas.');
  const requested=[...new Set(body.labels)],current=await readEditableIssue(entry,connection,api);
  if(sameLabels(current.labels,requested))return {labels:current.labels,labelsRevision:await labelsRevision(current.labels)};
  if(body.labelsRevision!==await labelsRevision(current.labels))throw workflowError('As labels mudaram no GitHub. Reabra a seleção e revise antes de atualizar.',409);
  const available=new Set([...options.labels.map(x=>x.name),...current.labels]);if(requested.some(name=>!available.has(name)))throw workflowError('Uma label selecionada não está disponível neste repositório.');
  const response=await api(`/repos/${connection.owner}/${connection.repo}/issues/${entry.number}/labels`,connection.token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({labels:requested}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw workflowError('GitHub não confirmou as labels. Confira as permissões e tente novamente.',502);
  const labels=(await response.json()).map(x=>typeof x==='string'?x:x.name);return {labels,labelsRevision:await labelsRevision(labels)};
}
export function projectSelections(body){
  if(body.projects!==undefined&&!Array.isArray(body.projects))throw workflowError("Seleção de projetos inválida.");
  const raw=Array.isArray(body.projects)?body.projects:body.projectId?[{id:body.projectId,statusFieldId:body.statusFieldId||'',statusOptionId:body.statusOptionId||''}]:[];
  if(raw.length>5)throw workflowError('Selecione no máximo cinco projetos por envio.');const ids=new Set();
  return raw.map(item=>{if(!item||typeof item.id!=='string'||!item.id||item.id.length>200||ids.has(item.id)||[item.statusFieldId,item.statusOptionId].some(x=>x!==undefined&&typeof x!=='string'))throw workflowError('Seleção de projetos inválida.');ids.add(item.id);return {id:item.id,statusFieldId:item.statusFieldId||'',statusOptionId:item.statusOptionId||''}});
}
export async function addIssueProjects(connection,nodeId,body,options,graphql){
  const choices=projectSelections(body),results=[];if(choices.length&&!nodeId)throw workflowError('Não foi possível identificar a issue no GitHub.',502);
  for(const choice of choices){const project=options.projects.find(x=>x.id===choice.id);let result={id:choice.id,title:project?.title||'Projeto selecionado',status:''};try{
    if(!project)throw new Error('Projeto não disponível para esta conta.');
    const field=(project.singleSelectFields||[]).find(x=>x.id===choice.statusFieldId&&x.name.toLowerCase()==='status');
    if(choice.statusOptionId&&(!field||!field.options.some(x=>x.id===choice.statusOptionId)))throw new Error('Coluna selecionada não pertence ao Status deste projeto.');
    const added=await graphql(connection,'mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}',{projectId:project.id,contentId:nodeId});
    if(choice.statusOptionId){await graphql(connection,'mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}',{projectId:project.id,itemId:added.addProjectV2ItemById.item.id,fieldId:field.id,optionId:choice.statusOptionId});result.status=field.options.find(x=>x.id===choice.statusOptionId).name}
  }catch(error){result.error=error.message||'Não foi possível incluir neste projeto.'}results.push(result)}
  return results;
}
function endpoint(entry,connection){if(!connection||(connection.owner+'/'+connection.repo).toLowerCase()!==entry.repository.toLowerCase())throw workflowError('Conecte o repositório '+entry.repository+' para consultar a conversa.',409);return `/repos/${connection.owner}/${connection.repo}/issues/${entry.number}/comments`}
const commentView=comment=>({id:comment.id,body:String(comment.body||'').replace(/\n?<!-- automatizador-comment:[a-f0-9-]+ -->/g,''),url:comment.html_url,author:comment.user?.login||'GitHub',createdAt:comment.created_at,updatedAt:comment.updated_at||comment.created_at});
export async function listIssueComments(entry,connection,api,page=1,since=''){
  if(!Number.isSafeInteger(page)||page<1||page>1000)throw workflowError('Página de comentários inválida.');
  const response=await api(endpoint(entry,connection)+`?per_page=100&page=${page}`+(since?'&since='+encodeURIComponent(since):''),connection.token,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw workflowError('Não foi possível consultar os comentários no GitHub.',502);
  const raw=await response.json();if(!Array.isArray(raw))throw workflowError('GitHub não retornou comentários válidos.',502);return {raw,comments:await Promise.all(raw.map(async x=>({...commentView(x),revision:await labelsRevision([x.body||''])}))),hasMore:raw.length===100};
}
export async function sendIssueComment(entry,connection,body,api,store){
  const text=typeof body.body==='string'?body.body.trim():'';if(!text||text.length>20000)throw workflowError('Escreva um comentário de até 20.000 caracteres.');
  if(typeof body.requestId!=='string')throw workflowError('Identificador do comentário ausente.');endpoint(entry,connection);
  const payload={requestId:body.requestId,expectedRepository:entry.repository,title:'Comentário da issue #'+entry.number,body:text};
  return recoverableIssue(payload,entry.repository,store,async operation=>{
    const response=await api(endpoint(entry,connection),connection.token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text+'\n<!-- automatizador-comment:'+body.requestId+' -->'}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Object.assign(workflowError('GitHub não confirmou o comentário. Seu texto foi preservado.',502),{creationRejected:response.status>=400&&response.status<500});
    const result=commentView(await response.json());await operation._onCreated(result);return result;
  },async(id,started)=>{const marker='<!-- automatizador-comment:'+id+' -->';for(let page=1;page<=10;page++){const data=await listIssueComments(entry,connection,api,page,new Date(started-60000).toISOString());const found=data.raw.find(x=>String(x.body).includes(marker));if(found)return commentView(found);if(!data.hasMore)break}return null});
}

export async function changeIssueComment(entry,connection,body,method,api){
 if(!Number.isSafeInteger(body.id)||body.id<1||!['PATCH','DELETE'].includes(method))throw workflowError('Comentário inválido.');endpoint(entry,connection);const path='/repos/'+connection.owner+'/'+connection.repo+'/issues/comments/'+body.id;
 const response=await api(path,connection.token,{signal:AbortSignal.timeout(15000)});if(response.status===404&&method==='DELETE')return {deleted:true};if(!response.ok)throw workflowError('Não foi possível consultar o comentário. Confira seu acesso ao GitHub.',502);const current=await response.json();if(String(current.issue_url||'').toLowerCase()!=='https://api.github.com/repos/'+entry.repository.toLowerCase()+'/issues/'+entry.number)throw workflowError('O comentário não pertence a esta issue.');
 const text=typeof body.body==='string'?body.body.trim():'';if(method==='PATCH'&&(!text||text.length>20000))throw workflowError('Escreva um comentário de até 20.000 caracteres.');if(method==='PATCH'&&commentView(current).body.trim()===text)return {comment:commentView(current)};
 if(body.revision!==await labelsRevision([current.body||'']))throw workflowError('Este comentário mudou no GitHub. Atualize a conversa antes de editar ou excluir.',409);
 const markers=String(current.body||'').match(/<!-- automatizador-comment:[a-f0-9-]+ -->/g)||[];const changed=await api(path,connection.token,{method,headers:{'Content-Type':'application/json'},...(method==='PATCH'?{body:JSON.stringify({body:text+(markers.length?'\n'+markers.join('\n'):'')})}:{}),signal:AbortSignal.timeout(30000)});if(!changed.ok)throw workflowError(changed.status===403?'Seu acesso ao GitHub não permite editar ou excluir este comentário.':'O GitHub não confirmou a alteração. Atualize a conversa e tente novamente.',changed.status===403?403:502);return method==='DELETE'?{deleted:true}:{comment:commentView(await changed.json())};
}

export async function readIssueComment(entry,connection,id,api){if(!Number.isSafeInteger(id)||id<1)throw workflowError('Comentário inválido.');endpoint(entry,connection);const response=await api('/repos/'+connection.owner+'/'+connection.repo+'/issues/comments/'+id,connection.token,{signal:AbortSignal.timeout(15000)});if(response.status===404)return null;if(!response.ok)throw workflowError('Não foi possível localizar o comentário da notificação.',502);const comment=await response.json();if(String(comment.issue_url||'').toLowerCase()!=='https://api.github.com/repos/'+entry.repository.toLowerCase()+'/issues/'+entry.number)throw workflowError('O comentário não pertence a esta issue.');return {...commentView(comment),revision:await labelsRevision([comment.body||''])}}
