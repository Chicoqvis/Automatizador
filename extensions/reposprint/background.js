import {returnToAnalysis} from './return-analysis.js';
import {loadProcesses,loadIssueProcess,processRead} from './process.js';
let processCache=null,processRevision=0;const processLoads=new Map(),returnJobs=new Set();
async function publishProgress(data){const tabs=await chrome.tabs.query({url:"https://automacao-issues-ai.automacao-issue-chico.workers.dev/*"});await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:"reposprint-process-progress",data})));}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type!=='reposprint-process'||new URL(sender.url||'https://invalid').origin!=='https://automacao-issues-ai.automacao-issue-chico.workers.dev')return;
 (async()=>{const saved=await chrome.storage.local.get(['reposprintWorkspace','reposprintProcessCache','reposprintIssueCache','reposprintApprovalCache','reposprintProcessProgress']),workspace=saved.reposprintWorkspace||'SxoNSBNfOj5hhl6dw2UmKAgFUqKdF33y';


 if(message.scope==='health'){const rows=await processRead(workspace,'backlog.list',undefined,undefined,undefined,true);if(!Array.isArray(rows))throw Error('Resposta de conexão inválida.');return {connected:true,checkedAt:Date.now()}}
 if(message.scope==='confirmation'){if(typeof message.issueId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(message.issueId))throw Error('Issue inválida.');const phases=await processRead(workspace,'process.lifecycle.phaseSummaries',[message.issueId],undefined,undefined,true);if(!Array.isArray(phases))throw Error('Resposta de fase inválida.');return {workspace,checkedAt:Date.now(),process:phases.find(row=>row.issueId===message.issueId)||null}}
 if(message.scope==='return-to-analysis'){
 const returnKey=workspace+'/'+message.issueId;if(returnJobs.has(returnKey))throw Error('Uma devolução desta issue já está em andamento.');returnJobs.add(returnKey);
 try{const result=await returnToAnalysis(workspace,message.issueId,message.justification);processRevision++;processLoads.clear();processCache=null;await chrome.storage.local.remove(['reposprintProcessCache','reposprintIssueCache','reposprintApprovalCache','reposprintProcessProgress']);return result}finally{returnJobs.delete(returnKey)}
 }
 if(message.scope==='reference'){if(typeof message.issueId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(message.issueId))throw Error('Issue inválida.');const issue=await processRead(workspace,'issue.detail',message.issueId,undefined,undefined,true),url=new URL(issue.githubUrl||''),match=url.pathname.match(/^\/([-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+)\/issues\/(\d+)$/);if(issue.id!==message.issueId||url.origin!=='https://github.com'||!match||Number(match[2])!==issue.number)throw Error('Não foi possível confirmar o repositório da task.');return {repository:match[1],number:issue.number,title:issue.title,url:url.href}}
 if(message.cacheOnly)return {cached:true,workspace,snapshot:saved.reposprintProcessCache?.workspace===workspace?saved.reposprintProcessCache:null,approvals:saved.reposprintApprovalCache?.workspace===workspace?saved.reposprintApprovalCache:null,progress:saved.reposprintProcessProgress?.workspace===workspace?saved.reposprintProcessProgress:null,issues:Object.values(saved.reposprintIssueCache||{}).filter(x=>x.workspace===workspace)};
 if(message.reference){const ref=message.reference;if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(ref.repository)||!Number.isSafeInteger(ref.number)||ref.number<1)throw Error('Issue inválida.');
 const key=workspace+'/'+ref.repository.toLowerCase()+'#'+ref.number,cache=saved.reposprintIssueCache||{},cached=cache[key],full=processCache?.workspace===workspace?processCache:saved.reposprintProcessCache?.workspace===workspace?saved.reposprintProcessCache:null;
 const known=full?.items.find(x=>Number(x.number)===ref.number&&String(x.githubUrl||'').toLowerCase()==='https://github.com/'+ref.repository.toLowerCase()+'/issues/'+ref.number);
 if(cached&&Date.now()-cached.checkedAt<60000)return cached;
 if(known&&Date.now()-full.checkedAt<60000)return {workspace,checkedAt:full.checkedAt,items:[known],individual:true};
 const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
 return loadIssueProcess(workspace,ref,undefined,undefined,cached?.items[0]||known||null).then(async data=>{const latest=(await chrome.storage.local.get('reposprintIssueCache')).reposprintIssueCache||{};latest[key]=data;const entries=Object.entries(latest).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,100);await chrome.storage.local.set({reposprintIssueCache:Object.fromEntries(entries)});return data}).finally(()=>clearInterval(keepAlive));
 }

 const approvals=message.scope==='approvals',cache=approvals?saved.reposprintApprovalCache:(processCache??saved.reposprintProcessCache),key=workspace+'/'+(approvals?'approvals':'workspace');
 if(cache?.workspace===workspace&&!cache.partial&&Date.now()-cache.checkedAt<180000&&(!approvals||cache.version==='0.4.7'))return cache;
 if(!processLoads.has(key)){const revision=processRevision;const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);const promise=loadProcesses(workspace,undefined,undefined,{approvals,onProgress:async data=>{if(revision!==processRevision)return;await chrome.storage.local.set({reposprintProcessProgress:data});await publishProgress(data)}}).then(async data=>{if(revision!==processRevision)return data;if(!approvals)processCache=data;await chrome.storage.local.set(approvals?{reposprintApprovalCache:{...data,version:'0.4.7'}}:{reposprintProcessCache:data});return data}).finally(()=>{clearInterval(keepAlive);if(revision===processRevision)processLoads.delete(key)});processLoads.set(key,promise)}
 return processLoads.get(key);

 })().then(data=>reply({data}),error=>reply({error:error.message,retryAt:error.retryAt,code:error.code}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['open-reposprint','open-reposprint-backlog'].includes(message?.type)||sender.url?.split('/')[2]!=='automacao-issues-ai.automacao-issue-chico.workers.dev')return;
  if(message.type==='open-reposprint-backlog'){chrome.windows.create({url:chrome.runtime.getURL('backlog.html'),type:'popup',width:1200,height:850}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}
  if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(message.repository)||!Number.isSafeInteger(message.number)||message.number<1)return;
  const params=new URLSearchParams({repository:message.repository,number:String(message.number)});
  chrome.windows.create({url:chrome.runtime.getURL('popup.html')+'?'+params,type:'popup',width:580,height:780}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
});
