import test from 'node:test';
import assert from 'node:assert/strict';
import {backlogRows,move,snapshot} from '../extensions/reposprint/backlog-model.js';
import {pageRequest} from '../extensions/reposprint/protocol.js';
const fixture=[{issueId:'a',position:0,sprintTarget:'out'},{issueId:'b',position:1,sprintTarget:'active'},{issueId:'c',position:2,sprintTarget:'out'},{issueId:'d',position:3,sprintTarget:'future'}];
test('reordenar coluna preserva todos os IDs e as posições relativas das outras colunas',()=>{
 const original=backlogRows(fixture),moved=move(original,'a','c');assert.deepEqual(moved.map(x=>x.issueId),['c','b','a','d']);assert.deepEqual(original.map(x=>x.issueId),['a','b','c','d']);assert.equal(new Set(moved.map(x=>x.issueId)).size,4);assert.equal(move(original,'a','b'),original);assert.equal(move(original,'missing','a'),original);
 assert.notEqual(snapshot(original),snapshot([...original,{issueId:'new',position:4,sprintTarget:'out'}]));assert.notEqual(snapshot(original),snapshot(original.map(x=>x.issueId==='a'?{...x,sprintTarget:'active'}:x)));
 assert.throws(()=>backlogRows([fixture[0],fixture[0]]));assert.throws(()=>backlogRows({items:fixture}));
});
test('consulta usa GET e reordenação envia todos os IDs por POST com campos observados',async()=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location;let calls=[];
 try{globalThis.location={origin:'chrome-extension://test'};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json([{result:{data:{success:true}}}])};
 await pageRequest('backlog.list','workspace');assert.equal(calls[0].url.pathname,'/trpc/backlog.list');assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('input')),{'0':{organizationId:'workspace'}});
 await pageRequest('backlog.reorder','workspace',['c','b','a','d']);assert.equal(calls[1].options.method,'POST');assert.deepEqual(JSON.parse(calls[1].options.body),{'0':{organizationId:'workspace',orderedIssueIds:['c','b','a','d']}});assert.equal(calls[1].options.credentials,'include');assert((await pageRequest('backlog.reorder','workspace',['a','a'])).error);assert.equal(calls.length,2);
 }finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation}
});
test('ações de card usam IDs individuais, destino validado e histórico somente por GET',async()=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location,calls=[];
 try{globalThis.location={origin:'chrome-extension://test'};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json([{result:{data:{success:true}}}])};
 await pageRequest('backlog.setSprintTarget','workspace',{issueId:'a',sprintTarget:'active'});assert.deepEqual(JSON.parse(calls[0].options.body),{'0':{organizationId:'workspace',issueId:'a',sprintTarget:'active'}});
 await pageRequest('backlog.remove','workspace','a');assert.deepEqual(JSON.parse(calls[1].options.body),{'0':{organizationId:'workspace',issueId:'a'}});
 await pageRequest('backlog.issueHistory','workspace','a');assert(!calls[2].options.method);assert.deepEqual(JSON.parse(calls[2].url.searchParams.get('input')),{'0':{organizationId:'workspace',issueId:'a'}});
 assert((await pageRequest('backlog.setSprintTarget','workspace',{issueId:'a',sprintTarget:'wrong'})).error);assert((await pageRequest('backlog.remove','workspace','../a')).error);assert.equal(calls.length,3);
 }finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation}
});
