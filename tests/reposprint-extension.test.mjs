import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates,trpcData,pageRequest} from '../extensions/reposprint/protocol.js';
test('busca confere número exato, deduplica e mantém identificação do repositório',()=>{
 const item={id:'internal-42',number:42,title:'Tarefa',repositoryId:'repo-1',repository:{fullName:'owner/repo'}};
 assert.deepEqual(candidates({issues:[item,item,{...item,id:'other',number:142},{...item,id:'../../invalid'}]},42).map(x=>[x.id,x.repository]),[['internal-42','owner/repo']]);
 assert.equal(trpcData([{result:{data:{success:true}}}]).success,true);
 assert.throws(()=>trpcData([{error:{message:'unauthorized'}}]));
 assert.throws(()=>trpcData([]));
});
test('chamadas usam sessão da página, endpoints fixos e confirmação explícita do serviço',async()=>{
 const oldLocation=globalThis.location,oldFetch=globalThis.fetch;const requests=[];
 try{globalThis.location={origin:'https://reposprint.com'};globalThis.fetch=async(url,options)=>{requests.push({url:new URL(url),options});return Response.json([{result:{data:{success:true}}}])};
 assert((await pageRequest('issue.list','workspace',42)).payload);assert.equal(requests[0].url.pathname,'/trpc/issue.list');assert.equal(JSON.parse(requests[0].url.searchParams.get('input'))['0'].search,'42');assert.equal(requests[0].options.credentials,'include');assert(!requests[0].options.headers);
 await pageRequest('backlog.add','workspace','internal-42');assert.equal(requests[1].options.method,'POST');assert.deepEqual(JSON.parse(requests[1].options.body),{'0':{organizationId:'workspace',issueIds:['internal-42']}});assert.deepEqual(Object.keys(requests[1].options.headers),['Content-Type']);
 assert((await pageRequest('other','workspace','id')).error);assert((await pageRequest('backlog.add','workspace','../id')).error);assert.equal(requests.length,2);
 globalThis.fetch=async()=>new Response('',{status:401});assert.match((await pageRequest('issue.list','workspace',42)).error,/Entre novamente/);
 globalThis.fetch=async()=>{throw Error('timeout')};assert.match((await pageRequest('backlog.add','workspace','id')).error,/antes de repetir/);
 }finally{globalThis.location=oldLocation;globalThis.fetch=oldFetch}
});
