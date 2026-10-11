// Consultas e devolução fixa para Análise; não recebe URLs ou credenciais.
window.addEventListener('message',event=>{
 if(event.source===window&&event.origin===location.origin&&event.data?.type==='automacao-repo-process-ping')window.postMessage({type:'automacao-repo-process-ready',id:event.data.id,version:chrome.runtime.getManifest().version},location.origin);
 if(event.source!==window||event.origin!==location.origin||event.data?.type!=='automacao-repo-process-request'||typeof event.data.id!=='string'||event.data.id.length>80)return;
 const id=event.data.id;chrome.runtime.sendMessage({type:'reposprint-process',reference:event.data.reference,scope:event.data.scope,issueId:event.data.issueId,justification:event.data.justification,cacheOnly:event.data.cacheOnly===true},result=>{const error=chrome.runtime.lastError?.message;window.postMessage({type:'automacao-repo-process-result',id,...(error?{error:'Recarregue a extensão RepoSprint e esta página.'}:result)},location.origin)});
});

chrome.runtime.onMessage.addListener(message=>{if(message?.type==='reposprint-process-progress')window.postMessage({type:'automacao-repo-process-progress',data:message.data},location.origin)});
