import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {approvalReport,nextRepoState,d1RepoState} from '../repo-process-state.mjs';
import {loadProcesses,isBusinessApproval,processRead,loadIssueProcess} from '../extensions/reposprint/process.js';
import {pageRequest} from '../extensions/reposprint/protocol.js';
const item={id:'task-a',number:42,title:'Task',author:'Chicoqvis',repository:'owner/repo',enteredAt:'2026-10-09T20:15:00Z'};
let checkedAt=Date.now();
const report=(items=[item],unknownIssueIds=[])=>approvalReport({workspace:'workspace',checkedAt:++checkedAt,githubLogin:'Chicoqvis',unknownIssueIds,items},'chicoqvis');
test('avisos são únicos por entrada, preservam fase desconhecida e concluem só após saída confirmada',()=>{
 let state=nextRepoState(null,report());assert.equal(state.events.length,1);assert.equal(state.events[0].read,false);
 state.events[0].read=true;state=nextRepoState(state,report());assert.equal(state.events.length,1);assert.equal(state.events[0].read,true);
 state=nextRepoState(state,report([],['task-a']));assert.equal(state.events[0].resolved,false);
 const stale=report([]);state=nextRepoState(state,report());state=nextRepoState(state,stale);assert.equal(state.events[0].resolved,false);
 state=nextRepoState(state,report([]));assert.equal(state.events[0].resolved,true);
 state=nextRepoState(state,report([{...item,enteredAt:'2026-10-11T12:00:00Z'}]));assert.equal(state.events.length,2);assert.equal(state.events[1].resolved,false);assert.equal(state.events[1].read,false);
 assert.throws(()=>approvalReport({workspace:'workspace',checkedAt:Date.now(),unknownIssueIds:[],items:[item],githubLogin:'other'},'chicoqvis'));
 assert.throws(()=>report([{...item,author:'other'}]));assert.throws(()=>report([item,item]));
});
test('armazenamento e leitura isolam conta e workspace sem perder deduplicação',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0012_repo_process.sql',import.meta.url),'utf8'));
 const db={prepare(sql){let values=[];return {bind(...v){values=v;return this},async first(){return sqlite.prepare(sql).get(...values)||null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}}}}};
 const alice=d1RepoState(db,'alice'),bob=d1RepoState(db,'bob');await alice.sync(report());assert.equal((await bob.list()).items.length,0);
 await bob.sync(report([{...item,title:'Bob'}]));await alice.read();assert.equal((await alice.list()).items[0].read,true);assert.equal((await bob.list()).items[0].read,false);
 await alice.sync(report());assert.equal((await alice.list()).items.length,1);await alice.sync(report([]));assert.equal((await alice.list()).pendingCount,0);assert.equal((await bob.list()).pendingCount,1);sqlite.close();
});
test('consulta pagina todo workspace, cruza fase atual e rejeita paginação instável',async()=>{
 const calls=[],rows=Array.from({length:51},(_,i)=>({id:'task-'+i,number:i+1,title:'Task '+i,author:i?'other':'Chicoqvis'}));
 const request=async(action,workspace,value)=>{calls.push({action,value});const data=action==='process.issueList'?{total:51,issues:rows.slice((value-1)*50,value*50)}:value.map(id=>({issueId:id,currentPhase:id==='task-0'?'business_approved':'analyzed',phaseStatus:'pending'}));return {payload:[{result:{data}}]}};
 const data=await loadProcesses('workspace',request);assert.equal(data.items.length,51);assert.equal(calls.filter(x=>x.action==='process.issueList').length,2);assert.equal(calls.filter(x=>x.action==='process.lifecycle.phaseSummaries').length,2);assert.equal(data.items.filter(x=>isBusinessApproval(x.process)).length,1);assert.equal(isBusinessApproval({currentPhase:'business_approved',phaseStatus:'completed'}),false);
 await assert.rejects(loadProcesses('workspace',async action=>({payload:[{result:{data:action==='process.issueList'?{total:51,issues:rows.slice(0,50)}:[]}}]}),async()=>{}),/paginação/);
 await assert.rejects(loadProcesses('workspace',async()=>({error:'Sessão expirada'})),/Sessão/);
});
test('protocolo de consulta é GET, usa workspaceId nas fases e não aceita aprovação',async()=>{
 const oldLocation=globalThis.location,oldFetch=globalThis.fetch,calls=[];
 try{globalThis.location={origin:'chrome-extension://test'};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json([{result:{data:[]}}])};await pageRequest('process.issueList','workspace',2);await pageRequest('process.lifecycle.phaseSummaries','workspace',['task-a']);
 assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('input')),{'0':{organizationId:'workspace',sortBy:'createdAt',sortOrder:'desc',page:2,limit:50}});
 assert.deepEqual(JSON.parse(calls[1].url.searchParams.get('input')),{'0':{workspaceId:'workspace',issueIds:['task-a']}});assert(calls.every(x=>!x.options.method&&x.options.credentials==='include'));
 assert((await pageRequest('process.approve','workspace','task-a')).error);assert((await pageRequest('process.lifecycle.phaseSummaries','workspace',['../bad'])).error);assert.equal(calls.length,2);
 globalThis.fetch=async()=>new Response('',{status:429,headers:{'Retry-After':'45'}});const limited=await pageRequest('process.issueList','workspace',1);assert.equal(limited.rateLimited,true);assert.equal(limited.retryAfterMs,45000);assert(!limited.error.includes('HTTP 429'));
 }finally{globalThis.location=oldLocation;globalThis.fetch=oldFetch}
});
test('limite de consultas retorna pausa imediatamente sem repetir a requisição',async()=>{
 const calls=[],pauses=[];let limited=true;
 const request=async(action,workspace,page)=>{calls.push(page);if(limited){limited=false;return {rateLimited:true,retryAfterMs:35000,error:'Pausa automática'}}return {payload:[{result:{data:{issues:[]}}}]}};
 await assert.rejects(processRead('workspace','process.issueList',7,request,async ms=>pauses.push(ms)),error=>error.retryAt>Date.now()+34000);assert.deepEqual(calls,[7]);
});
test('aprovações do backlog aparecem antes de consultar a lista e sobrevivem a uma pausa',async()=>{
 const progress=[],calls=[];const request=async action=>{calls.push(action);return action==='backlog.list'?{payload:[{result:{data:[{issueId:'approval',number:3920,title:'Aprovar task',state:'open',currentPhase:'business_approved',phaseLabel:'Aprovação de negócio',phaseStatus:'pending'}]}}]}:{rateLimited:true,retryAfterMs:30000,error:'Pausa automática'}};
 await assert.rejects(loadProcesses('workspace',request,async()=>{},{approvals:true,onProgress:data=>progress.push(data)}),error=>error.retryAt>Date.now());assert.equal(progress.length,1);assert.equal(progress[0].items[0].number,3920);assert.equal(progress[0].items[0].process.currentPhase,'business_approved');assert.equal(progress[0].partial,true);assert.deepEqual(calls,['backlog.list','process.approvalList']);
});
test('abrir processo de uma issue não varre o workspace e confere o repositório',async()=>{
 const calls=[],request=async(action,workspace,value)=>{calls.push({action,value});return {payload:[{result:{data:action==='issue.list'?{issues:[{id:'other',number:42,githubUrl:'https://github.com/other/repo/issues/42'},{id:'correct',number:42,title:'Minha task',githubUrl:'https://github.com/owner/repo/issues/42'}]}:[{issueId:'correct',currentPhase:'business_approved',phaseStatus:'pending'}]}}]}};
 const result=await loadIssueProcess('workspace',{repository:'owner/repo',number:42},request,async()=>{});assert.equal(result.items[0].id,'correct');assert.deepEqual(calls.map(x=>x.action),['issue.list','process.lifecycle.phaseSummaries']);assert.deepEqual(calls[1].value,['correct']);
});
test('ID já conhecido elimina a busca e consulta somente a fase da issue',async()=>{
 const calls=[],row={id:'known',number:42,githubUrl:'https://github.com/owner/repo/issues/42'};
 const result=await loadIssueProcess('workspace',{repository:'owner/repo',number:42},async(action,workspace,value)=>{calls.push({action,value});return {payload:[{result:{data:[]}}]}},async()=>{},row);
 assert.deepEqual(calls,[{action:'process.lifecycle.phaseSummaries',value:['known']}]);assert.equal(result.items[0].process,null);
});
test('consulta individual passa à frente das consultas gerais que aguardam na fila',async()=>{
 const order=[];let release,started;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
 const request=async(action,workspace,value)=>{order.push(value);if(value==='first'){started();await gate}return {payload:[{result:{data:[]}}]}};
 const first=processRead('workspace','issue.list','first',request,async()=>{});await ready;
 const background=processRead('workspace','issue.list','background',request,async()=>{}),individual=processRead('workspace','issue.list','individual',request,async()=>{},true);release();await Promise.all([first,background,individual]);assert.deepEqual(order,['first','individual','background']);
});
test('aprovações incluem todos os autores e publicam fases antes da última página',async()=>{
 const rows=Array.from({length:51},(_,i)=>({id:'a-'+i,number:i+1,author:i===50?'other':'Chicoqvis'})),calls=[],progress=[];
 const request=async(action,workspace,value)=>{calls.push(action);return {payload:[{result:{data:action==='backlog.list'?[]:action==='process.approvalList'?{total:51,issues:rows.slice((value-1)*50,value*50)}:value.map(id=>({issueId:id,currentPhase:id==='a-0'||id==='a-50'?'business_approved':'analyzed',phaseStatus:'pending'}))}}]}};
 const result=await loadProcesses('workspace',request,async()=>{},{approvals:true,onProgress:data=>progress.push(data)});
 assert.deepEqual(calls,['backlog.list','process.approvalList','process.lifecycle.phaseSummaries','process.approvalList','process.lifecycle.phaseSummaries']);assert.equal(progress[1].items.length,50);assert.equal(progress[1].partial,true);assert.equal(progress[1].items[0].process.currentPhase,'business_approved');assert.equal(result.partial,false);assert.deepEqual(result.items.filter(x=>isBusinessApproval(x.process)).map(x=>x.author),['Chicoqvis','other']);
});
test('fases puladas não contam como pendentes e fases do backlog dispensam outra consulta',async()=>{
 const calls=[],backlog=[{issueId:'pending',number:1,title:'Pendente',state:'open',currentPhase:'business_approved',phaseStatus:'pending'},{issueId:'skipped',number:2,title:'Pulada',state:'open',currentPhase:'business_approved',phaseStatus:'skipped'}];
 const result=await loadProcesses('workspace',async action=>{calls.push(action);return {payload:[{result:{data:action==='backlog.list'?backlog:{total:2,issues:backlog.map(x=>({id:x.issueId,number:x.number,title:x.title,state:x.state,author:'other'}))}}}]}},async()=>{},{approvals:true});
 assert.deepEqual(calls,['backlog.list','process.approvalList']);assert.deepEqual(result.items.filter(x=>isBusinessApproval(x.process)).map(x=>x.id),['pending']);
});
test('referência para responder usa issue.detail somente por GET e valida o ID',async()=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location,calls=[];try{globalThis.location={origin:'chrome-extension://test'};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json([{result:{data:{id:'issue-a'}}}])};await pageRequest('issue.detail','workspace','issue-a');assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('input')),{'0':{organizationId:'workspace',issueId:'issue-a'}});assert.equal(calls[0].options.method,undefined);assert((await pageRequest('issue.detail','workspace','../other')).error);assert.equal(calls.length,1)}finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation}
});
