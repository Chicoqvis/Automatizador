import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../cloudflare-app-worker.mjs';
import { validateSavedDraft, rankSimilarIssues, findSimilarIssues, fieldRefinementInstruction } from '../issue-workflow.mjs';
import { formatDraftTopics } from '../draft-prompt.mjs';

test('tópicos compactados ficam em linhas separadas sem alterar hífens comuns',()=>{
  assert.equal(formatDraftTopics('Regras a validar: - Disponibilizar impressão. - Permitir seleção. O objetivo é facilitar o fluxo.'),'Regras a validar:\n• Disponibilizar impressão.\n• Permitir seleção.\n\nO objetivo é facilitar o fluxo.');
  assert.equal(formatDraftTopics('- Primeiro\n- Segundo'),'• Primeiro\n• Segundo');
  assert.equal(formatDraftTopics('Usar o cadastro - quando disponível - sem alterar o fluxo.'),'Usar o cadastro - quando disponível - sem alterar o fluxo.');
});

test('rascunhos são isolados por conta, persistem anexos e impedem edição com revisão antiga',async()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of ['0001_initial.sql','0002_saved_drafts.sql','0003_issue_history.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
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
  assert.equal((await request('/api/history')).data.issues.length,0);db.close();
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
