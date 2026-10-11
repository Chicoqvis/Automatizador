import test from 'node:test';
import assert from 'node:assert/strict';
import {returnToAnalysis} from '../extensions/reposprint/return-analysis.js';
import {pageRequest} from '../extensions/reposprint/protocol.js';
const phase=(currentPhase='business_approved',targets=[{toPhase:'analyzed'}])=>({lifecycle:{currentPhase},returnTargets:targets});
test('devolução valida o destino, envia justificativa uma vez e confirma nova fase',async()=>{
 const calls=[];let reads=0;const result=await returnToAnalysis('workspace','issue-1',' Ajustar requisito ',async(w,a,id)=>{assert.equal(a,'process.lifecycle.get');assert.equal(id,'issue-1');return ++reads===1?phase():phase('analyzed')},async(a,w,v)=>{calls.push({a,w,v});return {payload:[{result:{data:{ok:true}}}]}});
 assert.deepEqual(result,{submitted:true,confirmed:true,phase:'analyzed'});assert.deepEqual(calls,[{a:'processWorkflow.advance',w:'workspace',v:{issueId:'issue-1',toNodeKey:'analyzed',justification:'Ajustar requisito'}}]);
});
test('fase alterada e destino ausente impedem qualquer escrita',async()=>{
 for(const data of [phase('developed'),phase('business_approved',[])]){let writes=0;await assert.rejects(returnToAnalysis('workspace','issue-1','Revisar',async()=>data,async()=>{writes++}));assert.equal(writes,0)}
});
test('recusa de permissão e falha de rede nunca geram sucesso ou repetição',async()=>{
 for(const response of [{payload:[{result:{data:{ok:false,failures:[{message:'Sem privilégio'}]}}}]},{error:'Não foi possível confirmar a resposta.'}]){let writes=0;await assert.rejects(returnToAnalysis('workspace','issue-1','Revisar',async()=>phase(),async()=>{writes++;return response}));assert.equal(writes,1)}
});
test('escrita confirmada com consulta posterior falha mantém resultado incerto sem reenviar',async()=>{
 let reads=0,writes=0;const result=await returnToAnalysis('workspace','issue-1','Revisar',async()=>{if(++reads>1)throw Error('429');return phase()},async()=>{writes++;return {payload:[{result:{data:{ok:true}}}]}});assert.equal(result.submitted,true);assert.equal(result.confirmed,false);assert.equal(writes,1);
});
test('protocolo usa GET de fase e POST fixo sem override ou credenciais explícitas',async()=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location,calls=[];
 try{globalThis.location={origin:'chrome-extension://test'};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json([{result:{data:{ok:true}}}])};
 await pageRequest('process.lifecycle.get','workspace','issue-1');await pageRequest('processWorkflow.advance','workspace',{issueId:'issue-1',toNodeKey:'analyzed',justification:'Revisar'});
 assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('input')),{'0':{workspaceId:'workspace',issueId:'issue-1'}});
 assert.equal(calls[1].options.method,'POST');assert.deepEqual(JSON.parse(calls[1].options.body),{'0':{workspaceId:'workspace',issueId:'issue-1',toNodeKey:'analyzed',justification:'Revisar'}});
 assert((await pageRequest('processWorkflow.advance','workspace',{issueId:'issue-1',toNodeKey:'developed',justification:'Revisar'})).error);
 assert((await pageRequest('processWorkflow.advance','workspace',{issueId:'issue-1',toNodeKey:'analyzed',justification:'Revisar',isOverride:true})).error);assert.equal(calls.length,2);
 }finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation}
});
