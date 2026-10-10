const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function issueMarker(requestId){return requestId?'<!-- automatizador-request:'+requestId+' -->':''}
export function d1OperationStore(db,userId){return {
  read:id=>db.prepare('SELECT * FROM issue_operations WHERE user_id=? AND request_id=?').bind(userId,id).first(),
  async claim(id,fingerprint){const r=await db.prepare("INSERT OR IGNORE INTO issue_operations(user_id,request_id,fingerprint,state,started_at) VALUES(?,?,?,'pending',?)").bind(userId,id,fingerprint,Date.now()).run();return r.meta.changes>0},
  async retry(id){const r=await db.prepare("UPDATE issue_operations SET state='pending',started_at=? WHERE user_id=? AND request_id=? AND state='rejected'").bind(Date.now(),userId,id).run();return r.meta.changes>0},
  save:(id,state,result)=>db.prepare('UPDATE issue_operations SET state=?,result=? WHERE user_id=? AND request_id=?').bind(state,result?JSON.stringify(result):null,userId,id).run()
}}
export async function recoverableIssue(body,repository,store,create,recover){
  if(!body.requestId)return create(body); // Existing clients remain compatible.
  if(!body.title?.trim()||!body.body?.trim())throw fail('Informe título e conteúdo antes de criar a issue.',400);
  if(!/^[a-f0-9-]{36}$/i.test(body.requestId))throw fail('Identificador de envio inválido.',400);
  if(body.expectedRepository?.toLowerCase()!==repository.toLowerCase())throw fail('O repositório conectado mudou. Reconecte o repositório do envio pendente antes de recuperar.');
  const source=JSON.stringify([repository.toLowerCase(),body.title,body.body,body.raw,body.labels,body.projectId,body.statusFieldId,body.statusOptionId]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  const fingerprint=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  let claimed=await store.claim(body.requestId,fingerprint);
  if(!claimed){
    const previous=await store.read(body.requestId);
    if(previous.fingerprint!==fingerprint)throw fail('O conteúdo deste envio mudou. Recupere a tentativa original antes de iniciar outra.');
    if(previous.state==='done')return {...JSON.parse(previous.result),replayed:true};
    if(previous.state==='rejected')claimed=await store.retry(body.requestId);
    if(!claimed){
      const found=await recover(body.requestId,previous.started_at);
      if(found){await store.save(body.requestId,'done',found);return found}
      throw fail('O envio anterior ainda não foi confirmado. Seu conteúdo está preservado. Aguarde e use “Verificar e recuperar envio”. Não reenviamos automaticamente para evitar uma issue duplicada.');
    }
  }
  try{
    const result=await create({...body,_onCreated:async result=>store.save(body.requestId,'done',{...result,recoveryWarning:'Issue recuperada. A aplicação de labels e projeto pode não ter sido concluída; confira no GitHub.'})});
    await store.save(body.requestId,'done',result);return result;
  }catch(error){
    const previous=await store.read(body.requestId);
    if(previous?.state==='done')return JSON.parse(previous.result);
    if(error.creationRejected)await store.save(body.requestId,'rejected');
    throw error;
  }
}
export async function findRecoveredIssue(connection,requestId,startedAt,githubApi){
  const marker=issueMarker(requestId);
  for(let page=1;page<=5;page++){
    const response=await githubApi(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}&since=${encodeURIComponent(new Date(startedAt-60000).toISOString())}`,connection.token);
    if(!response.ok)throw fail('Não foi possível verificar o envio anterior no GitHub. Tente novamente.',502);
    const issues=await response.json();
    const issue=issues.find(item=>!item.pull_request&&typeof item.body==='string'&&item.body.includes(marker));
    if(issue)return {number:issue.number,title:issue.title,url:issue.html_url,repository:connection.owner+'/'+connection.repo,labels:(issue.labels||[]).map(x=>typeof x==='string'?x:x.name),recoveryWarning:'Issue recuperada do GitHub. Confira as labels e o projeto antes de prosseguir.'};
    if(issues.length<100)break;
  }
  return null;
}
