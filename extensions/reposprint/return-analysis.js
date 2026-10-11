import {processRead} from './process.js';
import {pageRequest,trpcData} from './protocol.js';
export async function returnToAnalysis(workspace,issueId,justification,read=processRead,request=pageRequest){
 if(typeof issueId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(issueId)||typeof justification!=='string'||justification.trim().length<3||justification.length>20000)throw Error('Informe uma justificativa com pelo menos três caracteres.');
 const before=await read(workspace,'process.lifecycle.get',issueId,undefined,undefined,true);
 if(before?.lifecycle?.currentPhase!=='business_approved')throw Error('A issue já não está em Aprovação de negócio. Confira a fase atual.');
 if(!Array.isArray(before.returnTargets)||!before.returnTargets.some(target=>target.toPhase==='analyzed'))throw Error('O RepoSprint não permite devolver esta issue para Análise nesta fase.');
 // Uma única tentativa de escrita: nunca repetir automaticamente uma devolução.
 const response=await request('processWorkflow.advance',workspace,{issueId,toNodeKey:'analyzed',justification:justification.trim()});
 if(response.error)throw Error(response.error);
 const result=trpcData(response.payload);
 if(result?.ok!==true)throw Error(result?.failures?.[0]?.message||'O RepoSprint não confirmou a devolução. Confira sua permissão e a fase atual.');
 try{const after=await read(workspace,'process.lifecycle.get',issueId,undefined,undefined,true);return {submitted:true,confirmed:after?.lifecycle?.currentPhase==='analyzed',phase:after?.lifecycle?.currentPhase||null}}
 catch{return {submitted:true,confirmed:false,phase:null}}
}
