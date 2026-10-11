import {loadProcesses} from './process.js';
let processCache=null,processLoading=null;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type!=='reposprint-process'||new URL(sender.url||'https://invalid').origin!=='https://automacao-issues-ai.automacao-issue-chico.workers.dev')return;
 (async()=>{const saved=await chrome.storage.local.get('reposprintWorkspace'),workspace=saved.reposprintWorkspace||'SxoNSBNfOj5hhl6dw2UmKAgFUqKdF33y';
 if(processCache?.workspace===workspace&&Date.now()-processCache.checkedAt<60000)return processCache;
 if(processLoading&&processLoading.workspace!==workspace)await processLoading.promise.catch(()=>{});
 if(!processLoading){const promise=loadProcesses(workspace).then(data=>{processCache=data;return data}).finally(()=>{processLoading=null});processLoading={workspace,promise}}
 return processLoading.promise;
 })().then(data=>reply({data}),error=>reply({error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['open-reposprint','open-reposprint-backlog'].includes(message?.type)||sender.url?.split('/')[2]!=='automacao-issues-ai.automacao-issue-chico.workers.dev')return;
  if(message.type==='open-reposprint-backlog'){chrome.windows.create({url:chrome.runtime.getURL('backlog.html'),type:'popup',width:1200,height:850}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}
  if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(message.repository)||!Number.isSafeInteger(message.number)||message.number<1)return;
  const params=new URLSearchParams({repository:message.repository,number:String(message.number)});
  chrome.windows.create({url:chrome.runtime.getURL('popup.html')+'?'+params,type:'popup',width:580,height:780}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
});
