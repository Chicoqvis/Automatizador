// Somente consulta fixa; nunca recebe URL, credencial ou ação de aprovação da página.
window.addEventListener('message',event=>{
 if(event.source===window&&event.origin===location.origin&&event.data?.type==='automacao-repo-process-ping')window.postMessage({type:'automacao-repo-process-ready',id:event.data.id},location.origin);
 if(event.source!==window||event.origin!==location.origin||event.data?.type!=='automacao-repo-process-request'||typeof event.data.id!=='string'||event.data.id.length>80)return;
 const id=event.data.id;chrome.runtime.sendMessage({type:'reposprint-process'},result=>{const error=chrome.runtime.lastError?.message;window.postMessage({type:'automacao-repo-process-result',id,...(error?{error:'Recarregue a extensão RepoSprint e esta página.'}:result)},location.origin)});
});
