import {loadProcesses,loadIssueProcess} from './process.js';
let processCache=null,processLoading=null;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type!=='reposprint-process'||new URL(sender.url||'https://invalid').origin!=='https://automacao-issues-ai.automacao-issue-chico.workers.dev')return;
 (async()=>{const saved=await chrome.storage.local.get(['reposprintWorkspace','reposprintProcessCache','reposprintIssueCache']),workspace=saved.reposprintWorkspace||'SxoNSBNfOj5hhl6dw2UmKAgFUqKdF33y';

 if(message.reference){const ref=message.reference;if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(ref.repository)||!Number.isSafeInteger(ref.number)||ref.number<1)throw Error('Issue inválida.');
 const key=workspace+'/'+ref.repository.toLowerCase()+'#'+ref.number,cache=saved.reposprintIssueCache||{},cached=cache[key],full=processCache?.workspace===workspace?processCache:saved.reposprintProcessCache?.workspace===workspace?saved.reposprintProcessCache:null;
 const known=full?.items.find(x=>Number(x.number)===ref.number&&String(x.githubUrl||'').toLowerCase()==='https://github.com/'+ref.repository.toLowerCase()+'/issues/'+ref.number);
 if(cached&&Date.now()-cached.checkedAt<60000)return cached;
 if(known&&Date.now()-full.checkedAt<60000)return {workspace,checkedAt:full.checkedAt,items:[known],individual:true};
 const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
 return loadIssueProcess(workspace,ref,undefined,undefined,cached?.items[0]||known||null).then(async data=>{const latest=(await chrome.storage.local.get('reposprintIssueCache')).reposprintIssueCache||{};latest[key]=data;const entries=Object.entries(latest).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,100);await chrome.storage.local.set({reposprintIssueCache:Object.fromEntries(entries)});return data}).finally(()=>clearInterval(keepAlive));
 }

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
