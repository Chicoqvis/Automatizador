import {workflowError} from './issue-workflow.mjs';
export function approvalReport(body,login){
 if(!body||typeof body.workspace!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(body.workspace)||typeof body.githubLogin!=='string'||body.githubLogin.toLowerCase()!==login.toLowerCase()||!Array.isArray(body.items)||body.items.length>1000)throw workflowError('A conta GitHub ou o relatório Repo mudou. Consulte novamente.',409);
 if(!Number.isSafeInteger(body.checkedAt)||body.checkedAt<1||body.checkedAt>Date.now()+300000)throw workflowError('Data de consulta inválida.');
 if(!Array.isArray(body.unknownIssueIds)||body.unknownIssueIds.length>1000||body.unknownIssueIds.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(id)))throw workflowError('Fases desconhecidas inválidas.');
 const seen=new Set();return {workspace:body.workspace,observedAt:body.checkedAt,login:login.toLowerCase(),unknownIssueIds:body.unknownIssueIds,items:body.items.map(x=>{
 if(!x||typeof x.id!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(x.id)||seen.has(x.id)||!Number.isSafeInteger(x.number)||x.number<1||typeof x.author!=='string'||x.author.toLowerCase()!==login.toLowerCase()||typeof x.repository!=='string'||!/^[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(x.repository)||typeof x.title!=='string'||x.title.length>1000||!Number.isFinite(Date.parse(x.enteredAt)))throw workflowError('Relatório de aprovação inválido.');
 seen.add(x.id);return {id:x.id,number:x.number,author:x.author,repository:x.repository.toLowerCase(),title:x.title,enteredAt:x.enteredAt};
 })};
}
export function nextRepoState(previous,report,now=Date.now()){
 const state=previous&&previous.login===report.login?structuredClone(previous):{login:report.login,active:{},events:[],initialized:false};
 if(state.observedAt>report.observedAt)return state;state.observedAt=report.observedAt;
 const current=new Map(report.items.map(x=>[x.id,x])),unknown=new Set(report.unknownIssueIds||[]);
 for(const event of state.events)if(unknown.has(event.issueId)&&state.active[event.issueId]===event.issueId+'@'+event.enteredAt)current.set(event.issueId,{enteredAt:event.enteredAt});
 for(const event of state.events)event.resolved=!current.has(event.issueId)||current.get(event.issueId).enteredAt!==event.enteredAt;
 for(const item of report.items){const entryKey=item.id+'@'+item.enteredAt,old=state.active[item.id];if(old!==entryKey){
 const id=report.workspace+'/'+entryKey;if(!state.events.some(x=>x.id===id))state.events.push({...item,id,issueId:item.id,workspace:report.workspace,category:'REPO',createdAt:new Date(now).toISOString(),read:false,resolved:false});
 }}
 state.active={...Object.fromEntries(Object.entries(state.active).filter(([id])=>unknown.has(id))),...Object.fromEntries(report.items.map(x=>[x.id,x.id+'@'+x.enteredAt]))};state.initialized=true;state.checkedAt=now;state.events=state.events.slice(-500);return state;
}
export function repoView(states){const items=states.flatMap(x=>x.events||[]).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));return {items,pendingCount:items.filter(x=>!x.resolved).length}}
export function d1RepoState(db,userId){return {
 async list(){const {results}=await db.prepare('SELECT state FROM account_repo_process WHERE user_id=?').bind(userId).all();return repoView(results.map(x=>JSON.parse(x.state)))},
 async sync(report){for(let attempt=0;attempt<3;attempt++){const row=await db.prepare('SELECT state FROM account_repo_process WHERE user_id=? AND workspace=?').bind(userId,report.workspace).first(),old=row?.state||null,state=JSON.stringify(nextRepoState(old?JSON.parse(old):null,report));const result=old===null?await db.prepare('INSERT OR IGNORE INTO account_repo_process(user_id,workspace,state) VALUES(?,?,?)').bind(userId,report.workspace,state).run():await db.prepare('UPDATE account_repo_process SET state=? WHERE user_id=? AND workspace=? AND state=?').bind(state,userId,report.workspace,old).run();if(result.meta.changes)return this.list()}throw workflowError('Outra atualização está em andamento. Tente novamente.',409)},
 async read(){await db.prepare("UPDATE account_repo_process SET state=json_set(state,'$.events',json((SELECT json_group_array(json_set(value,'$.read',json('true'))) FROM json_each(account_repo_process.state,'$.events')))) WHERE user_id=?").bind(userId).run();return this.list()}
}}
