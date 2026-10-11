import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../cloudflare-app-worker.mjs';
import { validateSavedDraft, rankSimilarIssues, findSimilarIssues, fieldRefinementInstruction } from '../issue-workflow.mjs';
import { formatDraftTopics } from '../draft-prompt.mjs';
import { memoryContent,selectAccountMemory } from '../account-memory.mjs';
import { dailyAiQuotaError } from '../ai-quota.mjs';
import { quotaSummary, measuredAiUsage } from '../daily-usage.mjs';
import { recoverableIssue, d1OperationStore, issueMarker, findRecoveredIssue } from '../issue-recovery.mjs';
import { historyStatusTargets, refreshIssueStates } from '../history-status.mjs';
import { readEditableIssue, updateExistingIssue, revisedMemoryContent } from '../issue-editor.mjs';
import { labelsRevision, setIssueLabels, projectSelections, addIssueProjects, listIssueComments, sendIssueComment } from '../github-issue-actions.mjs';

test('cotas calculam saldo, renovação e não inventam tokens ausentes',()=>{
  const now=Date.parse('2026-10-10T23:00:00Z');
  const result=quotaSummary({neurons:1200.2,requests:50,rows_read:10,rows_written:5},now);
  assert.equal(result.quotas[0].remaining,8799);assert.equal(result.quotas[1].remaining,99950);assert.equal(result.resetAt,now+3600000);
  assert.equal(quotaSummary({ai_unknown:1},now).quotas[0].remaining,null);
  assert.equal(quotaSummary({ai_unknown:1,ai_exhausted:1},now).quotas[0].remaining,0);
  assert.equal(quotaSummary({requests:200000},now).quotas[1].remaining,0);
  assert.equal(quotaSummary(null,now+3600000).quotas[0].remaining,10000);
  assert.equal(measuredAiUsage({},'@cf/meta/llama-3.3-70b-instruct-fp8-fast').aiUnknown,1);
  assert.equal(measuredAiUsage({usage:{prompt_tokens:1000,completion_tokens:1000}},'@cf/meta/llama-3.3-70b-instruct-fp8-fast').neurons,231.473);
  assert.equal(quotaSummary({requests:79999},now).alerts.length,0);
  assert.equal(quotaSummary({requests:80000},now).alerts[0].threshold,80);
  assert.equal(quotaSummary({requests:94999},now).alerts[0].threshold,80);
  assert.equal(quotaSummary({requests:95000},now).alerts[0].threshold,95);
  assert.equal(quotaSummary({neurons:9900,ai_unknown:1},now).alerts.length,0);
  assert.equal(quotaSummary({requests:100000},now).alerts[0].exhausted,true);
  assert.equal(quotaSummary(null,now+3600000).alerts.length,0);
});

test('cota diária calcula a próxima meia-noite UTC sem confundir indisponibilidade',()=>{
  const now=Date.parse('2026-10-10T22:30:00Z');
  const error=dailyAiQuotaError(new Error('3036: You have used up your daily free allocation of 10,000 neurons.'),now);
  assert.equal(error.status,429);assert.equal(error.retryAfter,5400);
  assert.equal(error.resetAt,Date.parse('2026-10-11T00:00:00Z'));
  assert.match(error.message,/1 h e 30 min/);assert.match(error.message,/21h/);
  assert.match(dailyAiQuotaError({code:3036},Date.parse('2026-10-10T23:59:40Z')).message,/1 min/);
  assert.equal(dailyAiQuotaError(new Error('3040: Capacity temporarily exceeded')),null);
  assert.equal(dailyAiQuotaError(new Error('429: Too many requests')),null);
});

test('tópicos compactados ficam em linhas separadas sem alterar hífens comuns',()=>{
  assert.equal(formatDraftTopics('Regras a validar: - Disponibilizar impressão. - Permitir seleção. O objetivo é facilitar o fluxo.'),'Regras a validar:\n• Disponibilizar impressão.\n• Permitir seleção.\n\nO objetivo é facilitar o fluxo.');
  assert.equal(formatDraftTopics('- Primeiro\n- Segundo'),'• Primeiro\n• Segundo');
  assert.equal(formatDraftTopics('Usar o cadastro - quando disponível - sem alterar o fluxo.'),'Usar o cadastro - quando disponível - sem alterar o fluxo.');
});

test('rascunhos são isolados por conta, persistem anexos e impedem edição com revisão antiga',async()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of ['0001_initial.sql','0002_saved_drafts.sql','0003_issue_history.sql','0004_account_memory.sql','0005_daily_usage.sql','0006_issue_operations.sql','0007_daily_issue_count.sql','0008_saved_repositories.sql','0009_notifications_memory_controls.sql','0010_pending_mentions.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  for(const id of ['alice','bob']){
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(id,id,id,'user',1,Date.now(),'salt','hash');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(id).digest('hex'),id,Date.now()+60000);
  }
  const env={DB:{prepare(sql){let values=[];return {bind(...args){values=args;return this},async first(){return db.prepare(sql).get(...values)||null},async all(){return {results:db.prepare(sql).all(...values)}},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}}}}}}};
  env.DB.batch=statements=>Promise.all(statements.map(statement=>statement.run()));
  async function request(path,method='GET',body,account='alice'){
    const response=await worker.fetch(new Request('https://test.example'+path,{method,headers:{Cookie:'automacao_session='+account,Origin:'https://test.example','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);
    return {status:response.status,data:await response.json()};
  }

 const beforeRenew=await request('/api/auth/me'),bobExpiry=(await request('/api/auth/me','GET',undefined,'bob')).data.expiresAt;assert(beforeRenew.data.expiresAt>Date.now());const renewResponse=await worker.fetch(new Request('https://test.example/api/auth/renew',{method:'POST',headers:{Cookie:'automacao_session=alice',Origin:'https://test.example','Content-Type':'application/json'},body:'{}'}),env);assert.equal(renewResponse.status,200);assert(renewResponse.headers.get('set-cookie').includes('Max-Age=43200'));assert(renewResponse.headers.get('set-cookie').includes('HttpOnly'));const renewed=await renewResponse.json();assert(renewed.expiresAt-Date.now()>43190000);assert.equal((await request('/api/auth/me','GET',undefined,'bob')).data.expiresAt,bobExpiry);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('expired').digest('hex'),'alice',Date.now()-1);assert.equal((await request('/api/auth/renew','POST',{},'expired')).status,401);
  assert.equal((await request('/api/admin/quotas')).status,403);
  assert.equal((await request('/api/admin/usage')).status,403);
  assert.equal((await request('/api/admin/quotas','GET',undefined,'unknown')).status,401);
  db.prepare("UPDATE users SET role='admin' WHERE id='alice'").run();
  const quotaData=await request('/api/admin/quotas');assert.equal(quotaData.status,200);assert.equal(quotaData.data.quotas.length,4);assert(quotaData.data.quotas[1].used>=2);
  assert.equal((await request('/api/admin/usage')).status,200);
  const snapshot={description:'Proposta funcional',raw:'Relato de teste',labels:['bug'],attachments:{description:[{name:'print.png',url:'https://github.com/user-attachments/assets/abcd-1234',type:'image/png',markdown:'conteúdo adulterado'}]}};
  const created=await request('/api/drafts','POST',{name:'Meu rascunho',snapshot});assert.equal(created.status,200);const {id,revision}=created.data.draft;
  assert.equal((await request('/api/drafts',undefined,undefined,'bob')).data.drafts.length,0);
  assert.equal((await request('/api/drafts/'+id,'GET',undefined,'bob')).status,404);
  assert.equal((await request('/api/drafts','POST',{id,revision,name:'Ataque',snapshot},'bob')).status,409);
  const loaded=await request('/api/drafts/'+id);assert.equal(loaded.data.draft.snapshot.description,snapshot.description);assert(loaded.data.draft.snapshot.attachments.description[0].markdown.startsWith('![print.png]'));
  assert.equal((await request('/api/drafts','POST',{id,revision,name:'Atualizado',snapshot})).data.draft.revision,2);
  assert.equal((await request('/api/drafts','POST',{id,revision,name:'Versão antiga',snapshot})).status,409);
  assert.equal((await request('/api/drafts/'+id,'DELETE',{revision:2},'bob')).status,409);
  assert.equal((await request('/api/drafts/'+id,'DELETE',{revision:2})).status,200);
  assert.equal((await request('/api/drafts/'+id)).status,404);
  assert.equal((await request('/api/drafts','GET',undefined,'unknown')).status,401);
  const entry={number:42,title:'Filtro por paciente',repository:'owner/repo',url:'https://github.com/owner/repo/issues/42',createdAt:Date.now(),labels:['melhoria']};
  assert.equal((await request('/api/history','POST',{issues:[entry]})).status,200);
  assert.equal((await request('/api/history','POST',{issues:[entry]})).status,200);
  assert.equal((await request('/api/history')).data.issues.length,1);
  assert.equal((await request('/api/history','GET',undefined,'bob')).data.issues.length,0);
  assert.equal((await request('/api/history','DELETE',undefined,'bob')).status,200);
  assert.equal((await request('/api/history')).data.issues.length,1);
  assert.equal((await request('/api/history','POST',{issues:[{...entry,url:'https://example.com/issues/42'}]})).status,400);
  assert.equal((await request('/api/history/statuses','POST',{issues:[entry]})).status,409);
  assert.equal((await request('/api/history/statuses','POST',{issues:[entry]},'unknown')).status,401);
  const bytes=new Uint8Array(32);env.GITHUB_TOKEN_ENCRYPTION_KEY=Buffer.from(bytes).toString('base64url');
  const encryptionKey=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']),iv=new Uint8Array(12),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},encryptionKey,new TextEncoder().encode('test-token'));
  const tokenCipher=Buffer.from(iv).toString('base64url')+'.'+Buffer.from(cipher).toString('base64url');
  for(const user of ['alice','bob'])db.prepare('INSERT INTO github_connections VALUES(?,?,?,?,?,?,?)').run(user,'owner','repo','https://github.com/owner/repo','',tokenCipher,Date.now());
  const bobEntry={...entry,number:43,url:'https://github.com/owner/repo/issues/43'};await request('/api/history','POST',{issues:[bobEntry]},'bob');
  const originalFetch=globalThis.fetch;let apiCalls=0;
  db.prepare('INSERT INTO saved_repositories SELECT user_id,lower(owner||\'/\'||repo),owner,repo,repository_url,github_user,token_cipher,updated_at FROM github_connections WHERE user_id=\'alice\'').run();
  const savedRepos=(await request('/api/github/repositories')).data.repositories;assert.equal(savedRepos.length,1);assert.equal(savedRepos[0].repository,'owner/repo');assert.equal(savedRepos[0].token_cipher,undefined);assert.equal((await request('/api/github/repositories','GET',undefined,'bob')).data.repositories.length,0);
  assert.equal((await request('/api/github/switch','POST',{repository:'owner/repo'},'bob')).status,404);
  try{
    globalThis.fetch=async(url,options)=>{apiCalls++;assert.equal(new URL(url).pathname,'/repos/owner/repo/issues/42');assert.equal(options.headers.Authorization,'Bearer test-token');return Response.json({number:42,state:'closed'})};
    assert.equal((await request('/api/history/statuses','POST',{issues:[bobEntry]})).data.updated,0);assert.equal(apiCalls,0);
    assert.equal((await request('/api/history/statuses','POST',{issues:[entry]})).data.updated,1);
    const closed=(await request('/api/history')).data.issues[0];assert.equal(closed.issueState,'closed');assert(closed.stateCheckedAt>0);
    assert.equal((await request('/api/history','GET',undefined,'bob')).data.issues[0].issueState,'unknown');
    globalThis.fetch=async()=>Response.json({message:'Not found'},{status:404});
    assert.equal((await request('/api/history/statuses','POST',{issues:[entry]})).data.failed,1);
    const retained=(await request('/api/history')).data.issues[0];assert.equal(retained.issueState,'closed');assert.equal(retained.stateCheckedAt,closed.stateCheckedAt);assert.match(retained.stateCheckError,/não encontrada/);
    globalThis.fetch=async()=>Response.json({number:42,state:'open'});await request('/api/history/statuses','POST',{issues:[entry]});assert.equal((await request('/api/history')).data.issues[0].issueState,'open');
    assert.equal((await request('/api/history/statuses','POST',{issues:Array(26).fill(entry)})).status,400);
    globalThis.fetch=async()=>Response.json({number:42,title:'Título atual',body:'Conteúdo atual',state:'closed',labels:[{name:'melhoria'}]});
    const editPath='/api/history/issue?repository=owner%2Frepo&number=42';
    assert.equal((await request(editPath,'GET',undefined,'bob')).status,404);
    assert.equal((await request('/api/history/comment-draft?repository=owner%2Frepo&number=42','POST',{},'bob')).status,404);for(const action of ['labels','comments','projects'])assert.equal((await request('/api/history/'+action+'?repository=owner%2Frepo&number=42',action==='projects'?'POST':'GET',action==='projects'?{projects:[]}:undefined,'bob')).status,404);
    const editable=(await request(editPath)).data.issue;assert.equal(editable.body,'Conteúdo atual');let patches=0;
    globalThis.fetch=async(url,options)=>{if(options.method==='PATCH'){patches++;const patch=JSON.parse(options.body);assert.deepEqual(Object.keys(patch).sort(),['body','title']);return Response.json({number:42,title:patch.title,body:patch.body,state:'closed'})}return Response.json({number:42,title:'Título atual',body:'Conteúdo atual',state:'closed',labels:[{name:'melhoria'}]})};
    assert.equal((await request(editPath,'PATCH',{title:'Título revisado',body:'Conteúdo revisado',revision:editable.revision})).status,200);assert.equal(patches,1);
    const saved=(await request('/api/history')).data.issues[0];assert.equal(saved.title,'Título revisado');assert.equal(saved.issueState,'closed');
    globalThis.fetch=async()=>Response.json({number:42,title:'Alteração de outra pessoa',body:'Outro texto',state:'open'});
    assert.equal((await request(editPath,'PATCH',{title:'Tentativa',body:'Meu texto',revision:editable.revision})).status,409);
    let createPosts=0;globalThis.fetch=async()=>{createPosts++;return Response.json({number:44,title:'Nova issue',state:'open',labels:[],html_url:'https://github.com/owner/repo/issues/44'})};
    const createBody={requestId:crypto.randomUUID(),expectedRepository:'owner/repo',title:'Nova issue',body:'Texto',labels:[]};
    assert.equal((await request('/api/github/issues','POST',createBody)).status,201);assert.equal((await request('/api/github/issues','POST',createBody)).status,201);assert.equal(createPosts,1);
    assert.equal((await request('/api/admin/usage')).data.days[0].issues_created,1);db.prepare("DELETE FROM account_memory WHERE user_id='alice' AND number=44").run();
  }finally{globalThis.fetch=originalFetch;db.prepare('DELETE FROM github_connections').run();await request('/api/history','DELETE',undefined,'bob')}
  assert.equal((await request('/api/history','DELETE')).status,200);
  assert.equal((await request('/api/history')).data.issues.length,0);
  for(const user of ['alice','bob'])db.prepare('INSERT INTO account_memory(user_id,repository,number,title,content,created_at) VALUES(?,?,?,?,?,?)').run(user,'owner/repo',1,'Filtro marcação agendamento','Filtro marcação agendamento. MEMORIA_PRIVADA_'+user,Date.now());
  db.prepare('INSERT INTO account_memory(user_id,repository,number,title,content,created_at) VALUES(?,?,?,?,?,?)').run('alice','owner/repo',2,'Memória antiga','Conteúdo antigo somente de Alice',Date.now());
  const memoryPath='/api/memory/entry?repository=owner%2Frepo&number=2';
 assert.equal((await request(memoryPath,'PATCH',{enabled:false,outdated:true},'bob')).status,404);assert.equal((await request(memoryPath,'PATCH',{enabled:false,outdated:true})).status,200);const disabled=await request(memoryPath);assert.equal(disabled.data.entry.enabled,0);assert.equal(disabled.data.entry.outdated,1);assert.equal((await request(memoryPath,'PATCH',{enabled:true,outdated:false})).status,200);
 const {d1Notifications}=await import('../account-notifications.mjs');const aliceStore=d1Notifications(env.DB,'alice');await aliceStore.add([{id:501,repository:'owner/repo',number:42,body:'Teste',createdAt:new Date().toISOString()}]);assert.equal((await request('/api/notifications')).data.items.length,1);assert.equal((await request('/api/notifications','GET',undefined,'bob')).data.items.length,0);await request('/api/notifications/read','PATCH',{ids:[{id:501,repository:'owner/repo'}]},'bob');assert.equal((await aliceStore.list())[0].read,false);await request('/api/notifications/read','PATCH',{ids:[{id:501,repository:'owner/repo'}]});assert.equal((await request('/api/notifications')).data.items[0].read,true);
 await aliceStore.add([{id:601,repository:'owner/repo',number:42,body:'@alice preciso de um exemplo',mentionedLogin:'alice',createdAt:new Date().toISOString()}]);assert.equal((await request('/api/pending-mentions')).data.count,1);assert.equal((await request('/api/pending-mentions','GET',undefined,'bob')).data.items.length,0);assert.equal((await request('/api/pending-mentions','PATCH',{id:601,repository:'owner/repo',resolved:true},'bob')).status,404);assert.equal((await request('/api/pending-mentions','PATCH',{id:601,repository:'owner/repo',resolved:true})).status,200);assert.equal((await request('/api/pending-mentions')).data.count,0);assert.equal((await request('/api/pending-mentions')).data.items[0].resolved,true);
 const bobStore=d1Notifications(env.DB,'bob');await bobStore.add([{id:701,repository:'owner/repo',number:43,createdAt:new Date().toISOString()}]);assert.equal((await request('/api/notifications','DELETE')).status,200);assert.equal((await aliceStore.list()).length,0);assert.equal((await bobStore.list()).length,1);assert.equal((await request('/api/pending-mentions')).data.items.length,1);await aliceStore.add([{id:801,repository:'owner/repo',number:44,createdAt:new Date(Date.now()-60000).toISOString()}]);assert.equal((await aliceStore.list()).length,0);await aliceStore.add([{id:802,repository:'owner/repo',number:44,createdAt:new Date(Date.now()+1000).toISOString()}]);assert.equal((await aliceStore.list()).length,1);



  assert.equal((await request('/api/memory/entries')).data.entries.length,2);
  assert.equal((await request('/api/memory/entries','GET',undefined,'bob')).data.entries.length,1);
  assert.equal((await request('/api/memory/entries?q=somente')).data.entries.length,1);
  assert.equal((await request('/api/memory/entries?q=somente','GET',undefined,'bob')).data.entries.length,0);
  assert.equal((await request('/api/memory/entries?q=%25')).data.entries.length,0);
  assert.equal((await request(memoryPath,'GET',undefined,'bob')).status,404);
  assert.equal((await request(memoryPath,'DELETE',undefined,'bob')).status,404);
  assert.equal((await request(memoryPath)).data.entry.content,'Conteúdo antigo somente de Alice');
  assert.equal((await request(memoryPath,'DELETE')).status,200);
  assert.equal((await request('/api/memory')).data.count,1);
  assert.equal((await request('/api/memory','GET',undefined,'bob')).data.count,1);
  let modelInput;env.AI={run:async(model,input)=>{modelInput=input;return {response:{title:'Filtro marcação',description:'Análise atual',classification:'requisito',questions:[]}}}};
  const generated=await request('/api/draft','POST',{raw:'Filtro marcação agendamento',userId:'bob',memoryUsed:[{reference:'REFERENCIA_INJETADA'}]});
  assert.equal(generated.status,200);assert.equal(generated.data.memoryUsed.length,1);
  assert(modelInput.messages[0].content.includes('MEMORIA_PRIVADA_alice'));assert(!modelInput.messages[0].content.includes('MEMORIA_PRIVADA_bob'));assert(!modelInput.messages[0].content.includes('REFERENCIA_INJETADA'));
  assert.equal((await request('/api/memory/entry?repository=owner%2Frepo&number=1','DELETE')).status,200);
  assert.equal((await request('/api/memory')).data.count,0);assert.equal((await request('/api/memory','GET',undefined,'bob')).data.count,1);
  const cleared=await request('/api/draft','POST',{raw:'Filtro marcação agendamento'});assert.equal(cleared.data.memoryUsed.length,0);assert(!modelInput.messages[0].content.includes('MEMORIA_PRIVADA_bob'));
  assert.equal((await request('/api/memory','DELETE')).status,200);
  env.AI.run=async()=>{throw new Error('3036: You have used up your daily free allocation of 10,000 neurons.')};
  const limited=await request('/api/draft','POST',{raw:'Filtro marcação agendamento',field:'description'});
  assert.equal(limited.status,429);assert.equal(limited.data.code,'AI_DAILY_QUOTA_EXCEEDED');assert(limited.data.retryAfter>0);assert.match(limited.data.error,/Seu texto foi preservado/);
  env.AI.run=async()=>{throw new Error('3040: Capacity temporarily exceeded')};
  const unavailable=await request('/api/draft','POST',{raw:'Filtro marcação agendamento'});assert.equal(unavailable.status,502);assert.equal(unavailable.data.code,undefined);
  assert.equal((await request('/api/admin/usage')).data.days[0].ai_calls,4);
  const body={requestId:crypto.randomUUID(),expectedRepository:'owner/repo',title:'Título',body:'Descrição',raw:'Relato',labels:['melhoria'],projectId:'',statusFieldId:'',statusOptionId:''};
  const store=d1OperationStore(env.DB,'alice');let posts=0;
  const result={number:99,title:body.title,url:'https://github.com/owner/repo/issues/99',repository:'owner/repo',labels:['melhoria']};
  const create=async payload=>{posts++;await payload._onCreated(result);return result};
  assert.equal((await recoverableIssue(body,'owner/repo',store,create,async()=>null)).number,99);
  assert.equal((await recoverableIssue(body,'owner/repo',store,create,async()=>null)).number,99);assert.equal(posts,1);
  await assert.rejects(()=>recoverableIssue({...body,body:'Conteúdo alterado'},'owner/repo',store,create,async()=>null),e=>e.status===409);
  await assert.rejects(()=>recoverableIssue(body,'other/repo',store,create,async()=>null),e=>e.status===409);
  const rejected={...body,requestId:crypto.randomUUID()};
  await assert.rejects(()=>recoverableIssue(rejected,'owner/repo',store,async()=>{throw Object.assign(new Error('Sem permissão'),{creationRejected:true})},async()=>null));
  assert.equal((await recoverableIssue(rejected,'owner/repo',store,create,async()=>null)).number,99);
  const uncertain={...body,requestId:crypto.randomUUID()};let uncertainPosts=0;
  await assert.rejects(()=>recoverableIssue(uncertain,'owner/repo',store,async()=>{uncertainPosts++;throw new Error('Conexão caiu')},async()=>null));
  await assert.rejects(()=>recoverableIssue(uncertain,'owner/repo',store,async()=>{uncertainPosts++},async()=>null),e=>e.status===409);
  assert.equal((await recoverableIssue(uncertain,'owner/repo',store,async()=>{uncertainPosts++},async()=>result)).number,99);assert.equal(uncertainPosts,1);
  const afterCreate={...body,requestId:crypto.randomUUID()};assert.equal((await recoverableIssue(afterCreate,'owner/repo',store,async payload=>{await payload._onCreated(result);throw new Error('Falhou a inclusão de labels')},async()=>null)).number,99);
  const concurrent={...body,requestId:crypto.randomUUID()};let release,entered,concurrentPosts=0;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const first=recoverableIssue(concurrent,'owner/repo',store,async payload=>{concurrentPosts++;entered();await gate;await payload._onCreated(result);return result},async()=>null);
  await started;await assert.rejects(()=>recoverableIssue(concurrent,'owner/repo',store,async()=>{concurrentPosts++},async()=>null),e=>e.status===409);release();await first;assert.equal(concurrentPosts,1);
  assert.equal(await d1OperationStore(env.DB,'bob').read(body.requestId),null);
  const commentEntry={repository:'owner/repo',number:42},commentBody={body:'Comentário novo',requestId:crypto.randomUUID()};let commentPosts=0;
  const commentApi=async(path,token,init)=>{commentPosts++;assert.equal(init.method,'POST');const value=JSON.parse(init.body).body;return Response.json({id:1,body:value,html_url:'https://github.com/owner/repo/issues/42#issuecomment-1',user:{login:'alice'},created_at:new Date().toISOString()})};
  const posted=await sendIssueComment(commentEntry,{owner:'owner',repo:'repo',token:'test'},commentBody,commentApi,store);assert.equal(posted.body,'Comentário novo');await sendIssueComment(commentEntry,{owner:'owner',repo:'repo',token:'test'},commentBody,commentApi,store);assert.equal(commentPosts,1);
  db.close();
});

test('labels são substituídas somente após verificar a revisão e projetos reportam resultados individuais',async()=>{
  const entry={repository:'o/r',number:42},connection={owner:'o',repo:'r',token:'test'},revision=await labelsRevision(['bug']);let puts=0;
  const api=async(path,token,init)=>{if(init.method==='PUT'){puts++;assert.deepEqual(JSON.parse(init.body),{labels:[]});return Response.json([])}return Response.json({number:42,title:'Teste',body:'Texto',state:'open',labels:[{name:'bug'}]})};
  assert.deepEqual((await setIssueLabels(entry,connection,{labels:[],labelsRevision:revision},api,{labels:[{name:'bug'}]})).labels,[]);assert.equal(puts,1);
  await assert.rejects(()=>setIssueLabels(entry,connection,{labels:['melhoria'],labelsRevision:'outdated'},api,{labels:[{name:'melhoria'}]}),error=>error.status===409);assert.equal(puts,1);
  assert.throws(()=>projectSelections({projects:[{id:'one'},{id:'one'}]}));assert.throws(()=>projectSelections({projects:Array.from({length:6},(_,i)=>({id:String(i)}))}));
  const options={projects:[{id:'one',title:'Primeiro',singleSelectFields:[]},{id:'two',title:'Segundo',singleSelectFields:[]}]};let calls=0;
  const results=await addIssueProjects(connection,'ISSUE42',{projects:[{id:'one'},{id:'two'}]},options,async(c,q,v)=>{calls++;if(v.projectId==='two')throw new Error('Sem acesso');return {addProjectV2ItemById:{item:{id:'item'}}}});
  assert.equal(calls,2);assert.equal(results[0].error,undefined);assert.equal(results[1].error,'Sem acesso');
  const comments=await listIssueComments(entry,connection,async()=>Response.json([{id:1,body:'Texto\n<!-- automatizador-comment:abc-def -->',user:{login:'alice'}}]));assert.equal(comments.comments[0].body,'Texto');
});

test('recuperação procura o marcador no GitHub sem criar outra issue',async()=>{
  const id=crypto.randomUUID();let calls=0;
  const found=await findRecoveredIssue({owner:'owner',repo:'repo',token:'token'},id,Date.now(),async(path,token)=>{calls++;assert.equal(token,'token');assert(path.includes('state=all'));return Response.json([{number:42,title:'Recuperada',body:issueMarker(id),html_url:'https://github.com/owner/repo/issues/42',labels:[{name:'melhoria'}]}])});
  assert.equal(found.number,42);assert.equal(calls,1);
  assert.equal(await findRecoveredIssue({owner:'o',repo:'r',token:'token'},id,Date.now(),async()=>Response.json([{number:1,body:'Outra solicitação'}])),null);
});

test('consulta de status usa somente referências salvas e não muda o status do projeto',async()=>{
  const entry={repository:'owner/repo',number:42,issueState:'open',status:'Em análise',stateCheckedAt:123};
  assert.deepEqual(historyStatusTargets({issues:[{repository:'owner/repo',number:99}]},[entry]),[]);
  assert.throws(()=>historyStatusTargets({issues:[{repository:'../repo',number:0}]},[entry]));
  const report=await refreshIssueStates([entry,{...entry,repository:'other/repo'}],{owner:'owner',repo:'repo',token:'test'},async()=>Response.json({number:42,state:'closed'}),500);
  assert.equal(report.updated,1);assert.equal(report.skipped,1);assert.equal(report.entries[0].status,'Em análise');assert.equal(report.entries[0].stateCheckedAt,500);
  const failed=await refreshIssueStates([entry],{owner:'owner',repo:'repo',token:'test'},async()=>Response.json({number:42,state:'closed',pull_request:{}}));assert.equal(failed.failed,1);assert.equal(failed.entries[0].issueState,'open');
});

test('edição protege mudanças concorrentes e recupera resposta perdida sem outro PATCH',async()=>{
  const entry={repository:'o/r',number:42},connection={owner:'o',repo:'r',token:'test'};let current={number:42,title:'Original',body:'Texto original',state:'closed',labels:[]},patches=0;
  const api=async(path,token,options={})=>{if(options.method==='PATCH'){patches++;const body=JSON.parse(options.body);current={...current,...body};return Response.json(current)}return Response.json(current)};
  const initial=await readEditableIssue(entry,connection,api),payload={title:'Revisado',body:'Texto revisado',revision:initial.revision};
  const updated=await updateExistingIssue(entry,connection,payload,api);assert.equal(updated.issueState,'closed');assert.equal(patches,1);
  assert.equal((await updateExistingIssue(entry,connection,payload,api)).recovered,true);assert.equal(patches,1);
  current.body='Outra alteração';await assert.rejects(()=>updateExistingIssue(entry,connection,payload,api),error=>error.status===409);assert.equal(patches,1);
  await assert.rejects(()=>readEditableIssue(entry,{...connection,repo:'outro'},api),error=>error.status===409);
  assert.equal(revisedMemoryContent('Relato original:\nMinha ideia\n\nIssue revisada e enviada:\nAntiga','Nova'),'Relato original:\nMinha ideia\n\nIssue revisada e enviada:\nNova');
});

test('memória usa conteúdos relacionados e respeita o repositório',()=>{
  const entries=[{repository:'o/r',number:1,title:'Filtro agenda marcação',content:memoryContent({raw:'Filtro agenda marcação',body:'Regras funcionais'}),created_at:1},{repository:'outro/repo',number:2,title:'Filtro agenda marcação',content:'Outro projeto',created_at:2}];
  assert.deepEqual(selectAccountMemory('Filtro agenda marcação',entries,'o/r').map(x=>x.number),[1]);
  assert.equal(selectAccountMemory('Impressão estoque medicamentos',entries).length,0);
});

test('orientação de revisão fica limitada ao campo escolhido',()=>{
  const properties={description:{},problem:{}};
  const instruction=fieldRefinementInstruction({field:'description',fieldInstruction:'Detalhe as regras e considere a unidade Centro'},properties);
  assert(instruction.includes('somente o campo description'));assert(instruction.includes('Detalhe as regras'));
  assert.equal(fieldRefinementInstruction({field:'desconhecido',fieldInstruction:'Instrução'},properties),'');
  assert.throws(()=>fieldRefinementInstruction({field:'description',fieldInstruction:'x'.repeat(2001)},properties),e=>e.status===400);
});

test('validação dos rascunhos limita tamanho e elimina anexos inseguros',()=>{
  assert.throws(()=>validateSavedDraft({name:' ',snapshot:{}}));
  assert.throws(()=>validateSavedDraft({name:'Teste',snapshot:{raw:'a'.repeat(110000)}}),e=>e.status===413);
  const draft=validateSavedDraft({name:'Teste',snapshot:{attachments:{description:[{name:'x.png',type:'image/png',url:'javascript:alert(1)'}]}}});assert.equal(draft.snapshot.attachments.description.length,0);
});

test('busca compara títulos, exclui pull requests e consulta o repositório conectado',async()=>{
  const title='[MELHORIA] - Filtro por Tipo de Paciente na Nova Marcação';
  const items=[{number:1,title:'Filtro por tipo de paciente na marcação',html_url:'https://github.com/o/r/issues/1',state:'open'},{number:2,title:'Erro ao imprimir boleto'},{number:3,title,pull_request:{}}];
  assert.deepEqual(rankSimilarIssues(title,items).map(x=>x.number),[1]);let calls=0;
  const result=await findSimilarIssues({owner:'o',repo:'r',token:'token'},title,async(path,token)=>{calls++;assert.equal(token,'token');assert(decodeURIComponent(path).includes('repo:o/r is:issue in:title'));return new Response(JSON.stringify({items,total_count:3}))});assert.equal(result.issues.length,1);assert(calls<=3);
  await assert.rejects(()=>findSimilarIssues(null,title,()=>{}),e=>e.status===409);
});

 test('notificações filtram issues da conta, respeitam marco inicial e paginam sem perder o cursor',async()=>{
 const {commentNotifications}=await import('../comment-notifications.mjs');const since=Date.now()-60000;let calls=0;
 const report=await commentNotifications({owner:'owner',repo:'repo',token:'secret'},[{repository:'owner/repo',number:42,title:'Minha issue'},{repository:'outro/repo',number:99,title:'Outro repo'}],new URLSearchParams({since:String(since),page:'2'}),async(url,token)=>{calls++;assert(url.includes('page=2'));assert.equal(token,'secret');return new Response(JSON.stringify([{id:1,issue_url:'https://api.github.com/repos/owner/repo/issues/42',body:'Comentário novo',created_at:new Date(since+1000).toISOString(),user:{login:'colega'}},{id:2,issue_url:'https://api.github.com/repos/owner/repo/issues/99',body:'Não pertence à conta',created_at:new Date().toISOString()},{id:3,issue_url:'https://api.github.com/repos/owner/repo/issues/42',created_at:new Date(since-1000).toISOString()}]))});
 assert.equal(calls,1);assert.equal(report.comments.length,1);assert.equal(report.comments[0].number,42);assert.equal(report.comments[0].author,'colega');assert.equal(report.hasMore,false);await assert.rejects(commentNotifications({},[],new URLSearchParams({since:'NaN'}),()=>{}));
 });

 test('sugestão de comentário usa descrição e comentários recentes sem escrever no GitHub',async()=>{
 const {suggestComment}=await import('../comment-ai.mjs');let methods=[];const result=await suggestComment({repository:'owner/repo',number:42},{owner:'owner',repo:'repo',token:'token'},{instruction:'Peça um exemplo'},async(url,token,options={})=>{methods.push(options.method||'GET');return new Response(JSON.stringify(url.includes('/comments?')?[{id:1,body:'Qual unidade?',user:{login:'colega'},created_at:new Date().toISOString()}]:{number:42,title:'Filtro',body:'Todas as unidades',comments:1,labels:[],state:'open'}))},async(messages,schema)=>{const context=JSON.parse(messages[1].content);assert.equal(context.description,'Todas as unidades');assert.equal(context.comments[0].text,'Qual unidade?');assert.equal(context.instruction,'Peça um exemplo');assert(messages[0].content.includes('Não invente'));return {response:JSON.stringify({reply:'O filtro atende todas as unidades. Pode informar um exemplo?'})}});assert.equal(result.commentsUsed,1);assert.equal(result.contextLimited,false);assert(methods.every(m=>m==='GET'));assert(result.reply.includes('exemplo'));
 });

 test('memória desativada ou desatualizada não participa das referências',()=>{const entry={repository:'owner/repo',number:1,title:'Filtro agenda tipo',content:'Filtro agenda tipo',created_at:Date.now()};assert.equal(selectAccountMemory('Filtro agenda tipo',[entry]).length,1);assert.equal(selectAccountMemory('Filtro agenda tipo',[{...entry,enabled:0}]).length,0);assert.equal(selectAccountMemory('Filtro agenda tipo',[{...entry,outdated:1}]).length,0)});

 test('resposta específica carrega o comentário real e rejeita comentários de outra issue',async()=>{const {suggestComment}=await import('../comment-ai.mjs');let foreign=false,calls=0;const api=async url=>new Response(JSON.stringify(url.includes('/issues/comments/7')?{id:7,user:{login:'colega'},body:'Qual unidade?',issue_url:'https://api.github.com/repos/owner/repo/issues/'+(foreign?99:42)}:url.includes('/comments?')?[]:{number:42,title:'Filtro',body:'Todas as unidades',comments:0,labels:[],state:'open'}));const run=async messages=>{calls++;const context=JSON.parse(messages[1].content);assert.equal(context.targetComment.id,7);assert.equal(context.targetComment.text,'Qual unidade?');return {reply:'Todas as unidades.'}};const result=await suggestComment({repository:'owner/repo',number:42},{owner:'owner',repo:'repo',token:'token'},{targetCommentId:7},api,run);assert(result.reply.includes('#issuecomment-7'));assert(result.reply.includes('@colega'));foreign=true;await assert.rejects(suggestComment({repository:'owner/repo',number:42},{owner:'owner',repo:'repo',token:'token'},{targetCommentId:7},api,run),/não pertence/);assert.equal(calls,1)});

 test('editar comentário preserva marcador, detecta conflitos e valida issue antes de excluir',async()=>{const {changeIssueComment,labelsRevision}=await import('../github-issue-actions.mjs');let raw='Texto original\n<!-- automatizador-comment:abcd-1234 -->',foreign=false,writes=[];const api=async(url,token,opts={})=>{if(opts.method){writes.push(opts);if(opts.method==='DELETE')return new Response(null,{status:204});raw=JSON.parse(opts.body).body;return new Response(JSON.stringify({id:1,body:raw,user:{login:'alice'}}))}return new Response(JSON.stringify({id:1,body:raw,user:{login:'alice'},issue_url:'https://api.github.com/repos/owner/repo/issues/'+(foreign?99:42)}))};const entry={repository:'owner/repo',number:42},connection={owner:'owner',repo:'repo',token:'secret'},revision=await labelsRevision([raw]);await changeIssueComment(entry,connection,{id:1,body:'Texto editado',revision},'PATCH',api);assert(raw.includes('abcd-1234'));assert.equal(writes.length,1);await changeIssueComment(entry,connection,{id:1,body:'Texto editado',revision},'PATCH',api);assert.equal(writes.length,1);await assert.rejects(changeIssueComment(entry,connection,{id:1,revision},'DELETE',api),/mudou/);foreign=true;await assert.rejects(changeIssueComment(entry,connection,{id:1,revision:await labelsRevision([raw])},'DELETE',api),/não pertence/);foreign=false;await changeIssueComment(entry,connection,{id:1,revision:await labelsRevision([raw])},'DELETE',api);assert.equal(writes.at(-1).method,'DELETE')});

 test('comentário de origem carrega com data de edição e valida a issue',async()=>{const {readIssueComment}=await import('../github-issue-actions.mjs');const entry={repository:'owner/repo',number:42},connection={owner:'owner',repo:'repo',token:'secret'};const api=async()=>new Response(JSON.stringify({id:1,body:'Editado',created_at:'2026-10-10T12:00:00Z',updated_at:'2026-10-10T13:00:00Z',issue_url:'https://api.github.com/repos/owner/repo/issues/42'}));const comment=await readIssueComment(entry,connection,1,api);assert.equal(comment.updatedAt,'2026-10-10T13:00:00Z');assert.equal(comment.revision.length,64);assert.equal(await readIssueComment(entry,connection,1,async()=>new Response(null,{status:404})),null);await assert.rejects(readIssueComment({...entry,number:99},connection,1,api),/não pertence/)});

 test('menções são exatas e a identidade de envio é conferida',async()=>{const {mentionsGithubUser,githubAccount,verifyCommentAccount}=await import('../github-account.mjs');assert(mentionsGithubUser('Olá @Chicoqvis, poderia verificar?','chicoqvis'));for(const text of ['@chicoqvis-outro','email@chicoqvis','@outra-conta','@chicoqvis/time','\x60@chicoqvis\x60','<!-- @chicoqvis -->','> @chicoqvis'])assert.equal(mentionsGithubUser(text,'chicoqvis'),false,text);const connection={owner:'owner',repo:'repo',token:'token'},api=async()=>new Response(JSON.stringify({login:'Chicoqvis'}));assert.equal(await githubAccount(connection,api,'owner/repo'),'Chicoqvis');await verifyCommentAccount({expectedGithubLogin:'chicoqvis'},connection,api);await assert.rejects(verifyCommentAccount({expectedGithubLogin:'outro'},connection,api),/mudou/)});
 test('menção é detectada no conteúdo inteiro antes de truncar o aviso',async()=>{const {commentNotifications}=await import('../comment-notifications.mjs');const since=Date.now()-60000,report=await commentNotifications({owner:'owner',repo:'repo',token:'token',githubLogin:'chicoqvis'},[{repository:'owner/repo',number:42,title:'Minha issue'}],new URLSearchParams({since:String(since)}),async()=>new Response(JSON.stringify([{id:1,body:'Texto '.repeat(100)+' @chicoqvis',created_at:new Date().toISOString(),issue_url:'https://api.github.com/repos/owner/repo/issues/42'}])));assert.equal(report.comments[0].mentionedLogin,'chicoqvis');assert.equal(report.comments[0].body.length,500)});
