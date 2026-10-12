import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalAccess,replyApproval} from '../extensions/reposprint/approval-reply.js';
import {pageRequest} from '../extensions/reposprint/protocol.js';
const lifecycle=()=>({lifecycle:{currentPhase:'business_approved'},nextManualPhase:'business_approved',readiness:{phase:'business_approved',requiredPermission:'lifecycle:approve-biz',mandatoryUnmet:[],dorMissing:[],artifactsMissing:[],dodMissing:[],sodConflict:null},signerCandidates:[{userId:'signer',sodConflict:null}]});
const permissions={permissions:['lifecycle:approve-biz'],isOwner:false},identity={userId:'other'};
test('aprovação exige fase, requisitos, permissão ou elegibilidade e segregação de funções',()=>{
 assert.equal(approvalAccess(lifecycle(),permissions,identity).allowed,true);assert.equal(approvalAccess(lifecycle(),{permissions:[]},{userId:'signer'}).allowed,true);assert.equal(approvalAccess(lifecycle(),{isOwner:true},identity).allowed,true);
 for(const patch of [{nextManualPhase:'developed'},{readiness:null},{readiness:{...lifecycle().readiness,sodConflict:{userId:'other'}}},{readiness:{...lifecycle().readiness,mandatoryUnmet:['analyzed']}}])assert.equal(approvalAccess({...lifecycle(),...patch},permissions,identity).allowed,false);
 assert.equal(approvalAccess(lifecycle(),{permissions:[]},identity).allowed,false);
});
test('aprovar e solicitar ajuste usam nota e fase fixas, preflight e envio único',async()=>{
 for(const action of ['approve','adjust']){const calls=[];const read=async(w,a)=>a==='process.lifecycle.get'?lifecycle():a==='workspace.getMyPermissions'?permissions:a==='account.identity'?identity:[{issueId:'issue',currentPhase:action==='approve'?'developed':'analyzed',phaseLabel:action==='approve'?'Desenvolvimento':'Análise'}];const result=await replyApproval('workspace','issue',action,' Avaliação validada ',read,async(a,w,value)=>{calls.push({a,w,value});return {payload:[{result:{data:{success:true}}}]}});assert.equal(result.submitted,true);assert.equal(calls.length,1);assert.equal(calls[0].a,action==='approve'?'process.lifecycle.advance':'process.lifecycle.requestAdjustment');assert.deepEqual(calls[0].value,{issueId:'issue',note:'Avaliação validada'});assert(result.process.currentPhase)}
});
test('bloqueio e erro de escrita não confirmam ação nem repetem POST',async()=>{
 let writes=0;await assert.rejects(replyApproval('workspace','issue','approve','Validar',async(w,a)=>a==='process.lifecycle.get'?{...lifecycle(),nextManualPhase:'developed'}:a==='workspace.getMyPermissions'?permissions:identity,async()=>{writes++}),e=>e.code==='APPROVAL_BLOCKED');assert.equal(writes,0);
 const read=async(w,a)=>a==='process.lifecycle.get'?lifecycle():a==='workspace.getMyPermissions'?permissions:identity;
 await assert.rejects(replyApproval('workspace','issue','adjust','Revisar',read,async()=>{writes++;return {error:'Timeout'}}));assert.equal(writes,1);
});
test('aprovação recebida mantém a fase quando há outros requisitos ou aprovadores',async()=>{
 const read=async(w,a)=>a==='process.lifecycle.get'?lifecycle():a==='workspace.getMyPermissions'?permissions:a==='account.identity'?identity:[{issueId:'issue',currentPhase:'business_approved',phaseStatus:'pending'}];const result=await replyApproval('workspace','issue','approve','Validar',read,async()=>({payload:[{result:{data:{success:true}}}]}));assert.equal(result.submitted,true);assert.equal(result.process.currentPhase,'business_approved');
});
test('protocolo de resposta usa campos observados e recusa override e fase arbitrária',async()=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location,calls=[];
 try{globalThis.location={origin:'chrome-extension://test'};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json([{result:{data:{success:true}}}])};await pageRequest('process.lifecycle.advance','workspace',{issueId:'issue',note:'Validar'});await pageRequest('process.lifecycle.requestAdjustment','workspace',{issueId:'issue',note:'Revisar'});await pageRequest('workspace.getMyPermissions','workspace');assert.deepEqual(JSON.parse(calls[0].options.body),{'0':{workspaceId:'workspace',issueId:'issue',note:'Validar',toPhase:'business_approved'}});assert.deepEqual(JSON.parse(calls[1].options.body),{'0':{workspaceId:'workspace',issueId:'issue',note:'Revisar',phase:'business_approved'}});assert.deepEqual(JSON.parse(calls[2].url.searchParams.get('input')),{'0':{organizationId:'workspace'}});assert((await pageRequest('process.lifecycle.advance','workspace',{issueId:'issue',note:'Validar',isOverride:true})).error);assert.equal(calls.length,3);
 globalThis.fetch=async()=>Response.json({user:{id:'signer'},session:{token:'must-not-leave-extension'}});const session=await pageRequest('account.identity','workspace');assert.deepEqual(session.payload,[{result:{data:{userId:'signer'}}}]);assert(!JSON.stringify(session).includes('must-not-leave-extension'));
 }finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation}
});
