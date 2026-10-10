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
  for(const file of ['0001_initial.sql','0002_saved_drafts.sql','0003_issue_history.sql','0004_account_memory.sql','0005_daily_usage.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
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
  assert.equal((await request('/api/admin/quotas')).status,403);
  assert.equal((await request('/api/admin/quotas','GET',undefined,'unknown')).status,401);
  db.prepare("UPDATE users SET role='admin' WHERE id='alice'").run();
  const quotaData=await request('/api/admin/quotas');assert.equal(quotaData.status,200);assert.equal(quotaData.data.quotas.length,4);assert(quotaData.data.quotas[1].used>=2);
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
  assert.equal((await request('/api/history','DELETE')).status,200);
  assert.equal((await request('/api/history')).data.issues.length,0);
  for(const user of ['alice','bob'])db.prepare('INSERT INTO account_memory VALUES(?,?,?,?,?,?)').run(user,'owner/repo',1,'Filtro marcação agendamento','Filtro marcação agendamento. MEMORIA_PRIVADA_'+user,Date.now());
  let modelInput;env.AI={run:async(model,input)=>{modelInput=input;return {response:{title:'Filtro marcação',description:'Análise atual',classification:'requisito',questions:[]}}}};
  const generated=await request('/api/draft','POST',{raw:'Filtro marcação agendamento',userId:'bob',memoryUsed:[{reference:'REFERENCIA_INJETADA'}]});
  assert.equal(generated.status,200);assert.equal(generated.data.memoryUsed.length,1);
  assert(modelInput.messages[0].content.includes('MEMORIA_PRIVADA_alice'));assert(!modelInput.messages[0].content.includes('MEMORIA_PRIVADA_bob'));assert(!modelInput.messages[0].content.includes('REFERENCIA_INJETADA'));
  assert.equal((await request('/api/memory','DELETE')).status,200);
  assert.equal((await request('/api/memory')).data.count,0);assert.equal((await request('/api/memory','GET',undefined,'bob')).data.count,1);
  const cleared=await request('/api/draft','POST',{raw:'Filtro marcação agendamento'});assert.equal(cleared.data.memoryUsed.length,0);assert(!modelInput.messages[0].content.includes('MEMORIA_PRIVADA_bob'));
  env.AI.run=async()=>{throw new Error('3036: You have used up your daily free allocation of 10,000 neurons.')};
  const limited=await request('/api/draft','POST',{raw:'Filtro marcação agendamento',field:'description'});
  assert.equal(limited.status,429);assert.equal(limited.data.code,'AI_DAILY_QUOTA_EXCEEDED');assert(limited.data.retryAfter>0);assert.match(limited.data.error,/Seu texto foi preservado/);
  env.AI.run=async()=>{throw new Error('3040: Capacity temporarily exceeded')};
  const unavailable=await request('/api/draft','POST',{raw:'Filtro marcação agendamento'});assert.equal(unavailable.status,502);assert.equal(unavailable.data.code,undefined);db.close();
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
