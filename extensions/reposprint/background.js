import {loadProcesses,loadIssueProcess} from './process.js';
let processCache=null,processLoading=null;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type!=='reposprint-process'||new URL(sender.url||'https://invalid').origin!=='https://automacao-issues-ai.automacao-issue-chico.workers.dev')return;
 (async()=>{const saved=await chrome.storage.local.get(['reposprintWorkspace','reposprintProcessCache']),workspace=saved.reposprintWorkspace||'SxoNSBNfOj5hhl6dw2UmKAgFUqKdF33y';
 if(message.reference){const ref=message.reference;if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(ref.repository)||!Number.isSafeInteger(ref.number)||ref.number<1)throw Error('Issue inválida.');const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);return loadIssueProcess(workspace,ref).finally(()=>clearInterval(keepAlive))}
 processCache??=saved.reposprintProcessCache;
 if(processCache?.workspace===workspace&&Date.now()-processCache.checkedAt<180000)return processCache;
 if(processLoading&&processLoading.workspace!==workspace)await processLoading.promise.catch(()=>{});
 if(!processLoading){const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);const promise=loadProcesses(workspace).then(async data=>{processCache=data;await chrome.storage.local.set({reposprintProcessCache:data});return data}).finally(()=>{clearInterval(keepAlive);processLoading=null});processLoading={workspace,promise}}
 return processLoading.promise;
 })().then(data=>reply({data}),error=>reply({error:error.message,retryAt:error.retryAt}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['open-reposprint','open-reposprint-backlog'].includes(message?.type)||sender.url?.split('/')[2]!=='automacao-issues-ai.automacao-issue-chico.workers.dev')return;
  if(message.type==='open-reposprint-backlog'){chrome.windows.create({url:chrome.runtime.getURL('backlog.html'),type:'popup',width:1200,height:850}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}
  if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(message.repository)||!Number.isSafeInteger(message.number)||message.number<1)return;
  const params=new URLSearchParams({repository:message.repository,number:String(message.number)});
  chrome.windows.create({url:chrome.runtime.getURL('popup.html')+'?'+params,type:'popup',width:580,height:780}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
});
