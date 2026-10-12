import {processRead} from './process.js';
import {pageRequest,trpcData} from './protocol.js';
const issueValid=id=>typeof id==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(id);
export function approvalAccess(lifecycle,permissions,identity){
 const reasons=[],phase=lifecycle?.nextManualPhase??lifecycle?.lifecycle?.currentPhase,ready=lifecycle?.readiness;
 if(phase!=='business_approved')reasons.push('A issue não está em Aprovação de negócio.');
 if(!ready||!['mandatoryUnmet','dorMissing','artifactsMissing'].every(key=>Array.isArray(ready[key])))reasons.push('Os requisitos de aprovação ainda não foram informados pelo RepoSprint.');
 else{
  if(ready.phase&&ready.phase!=='business_approved')reasons.push('Os requisitos informados pertencem a outra fase.');
  if(ready.mandatoryUnmet.length||ready.dorMissing.length||ready.artifactsMissing.length||(ready.dodMissing?.length||0))reasons.push('Existem requisitos obrigatórios pendentes no processo.');
  if(ready.sodConflict)reasons.push('A segregação de funções impede esta aprovação.');
 }
 const signer=typeof identity?.userId==='string'&&(lifecycle?.signerCandidates||[]).some(row=>row.userId===identity.userId&&row.sodConflict==null);
 const privilege=permissions?.isOwner===true||(typeof ready?.requiredPermission==='string'&&Array.isArray(permissions?.permissions)&&permissions.permissions.includes(ready.requiredPermission));
 if(!signer&&!privilege)reasons.push('Sua conta não tem permissão para responder a esta aprovação.');
 return {allowed:reasons.length===0,reasons,currentPhase:phase||null};
}
export async function loadApprovalAccess(workspace,issueId,read=processRead){
 if(!issueValid(issueId))throw Error('Issue inválida.');
 const lifecycle=await read(workspace,'process.lifecycle.get',issueId,undefined,undefined,true);
 const permissions=await read(workspace,'workspace.getMyPermissions',undefined,undefined,undefined,true);
 const identity=await read(workspace,'account.identity',undefined,undefined,undefined,true);
 return {...approvalAccess(lifecycle,permissions,identity),checkedAt:Date.now()};
}
export async function replyApproval(workspace,issueId,action,note,read=processRead,request=pageRequest){
 if(!issueValid(issueId)||!['approve','adjust'].includes(action)||typeof note!=='string'||note.trim().length<3||note.length>20000)throw Error('Informe sua avaliação com pelo menos três caracteres.');
 const access=await loadApprovalAccess(workspace,issueId,read);
 if(!access.allowed)throw Object.assign(Error(access.reasons.join(' ')),{code:'APPROVAL_BLOCKED'});
 const response=await request(action==='approve'?'process.lifecycle.advance':'process.lifecycle.requestAdjustment',workspace,{issueId,note:note.trim()});
 if(response.error)throw Object.assign(Error(response.error),{code:response.code});
 const result=trpcData(response.payload);if(result?.ok===false||result?.success===false)throw Error(result.failures?.[0]?.message||'O RepoSprint recusou a resposta.');
 // Resposta recebida não significa necessariamente que todos os aprovadores concluíram a fase.
 try{const phases=await read(workspace,'process.lifecycle.phaseSummaries',[issueId],undefined,undefined,true);if(!Array.isArray(phases))throw Error('Fase inválida.');return {submitted:true,process:phases.find(row=>row.issueId===issueId)||null,checkedAt:Date.now()}}
 catch{return {submitted:true,process:null,checkedAt:Date.now()}}
}
