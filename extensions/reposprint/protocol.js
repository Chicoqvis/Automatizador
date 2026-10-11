export function candidates(data,number){
 const found=new Map();let visited=0;
 function walk(value,depth){if(!value||typeof value!=='object'||depth>10||++visited>15000)return;if(typeof value.id==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(value.id)&&Number(value.number)===number&&typeof value.repositoryId==='string'){
 const repo=value.repository||{},name=repo.fullName||repo.full_name||(repo.owner?.login&&repo.name?repo.owner.login+'/'+repo.name:'');found.set(value.id,{id:value.id,number,title:String(value.title||'Issue #'+number),repositoryId:value.repositoryId,repository:typeof name==='string'?name:'',githubIssueId:value.githubIssueId})}
 for(const child of Object.values(value))walk(child,depth+1)
 }walk(data,0);return [...found.values()];
}
export function trpcData(payload){const result=Array.isArray(payload)?payload[0]:payload;if(result?.error)throw Error('RepoSprint recusou a ação. Confira seu acesso e a sessão.');if(!result?.result||!('data'in result.result))throw Error('Resposta inesperada do RepoSprint. Nenhuma confirmação recebida.');const data=result.result.data;return data?.json??data}
// Requisição da extensão; não lê nem retorna cookies ou tokens.
export async function pageRequest(action,workspace,value){
 if(location.origin!=='https://reposprint.com'&&!location.origin.startsWith('chrome-extension://'))return {error:'Abra esta ação pela extensão.'};
 if(!['process.lifecycle.get','processWorkflow.advance','issue.list','issue.detail','process.issueList','process.approvalList','process.lifecycle.phaseSummaries','backlog.add','backlog.list','backlog.reorder','backlog.setSprintTarget','backlog.remove','backlog.issueHistory'].includes(action)||!/^[-a-zA-Z0-9_]{1,200}$/.test(workspace))return {error:'Parâmetros inválidos.'};
 if(action==='process.approvalList'&&(!Number.isSafeInteger(value)||value<1||value>200))return {error:'Página inválida.'};
 if(action==='process.issueList'&&(!Number.isSafeInteger(value)||value<1||value>200))return {error:'Página inválida.'};
 if(action==='process.lifecycle.phaseSummaries'&&(!Array.isArray(value)||!value.length||value.length>50||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(id))))return {error:'Issues inválidas.'};
 if(action==='issue.list'&&(!Number.isSafeInteger(value)||value<1)||action==='backlog.add'&&(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(value)))return {error:'Issue inválida.'};
 if(action==='backlog.reorder'&&(!Array.isArray(value)||value.length>5000||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(id))))return {error:'Ordem de cards inválida.'};
 if(['issue.detail','backlog.remove','backlog.issueHistory'].includes(action)&&(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(value)))return {error:'Issue inválida.'};
 if(action==='backlog.setSprintTarget'&&(!value||!/^[-a-zA-Z0-9_]{1,200}$/.test(value.issueId)||!['out','active','future'].includes(value.sprintTarget)))return {error:'Destino inválido.'};
 if(action==='process.lifecycle.get'&&(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(value)))return {error:'Issue inválida.'};
 if(action==='processWorkflow.advance'&&(!value||!/^[-a-zA-Z0-9_]{1,200}$/.test(value.issueId)||value.toNodeKey!=='analyzed'||typeof value.justification!=='string'||value.justification.trim().length<3||value.justification.length>20000||Object.keys(value).some(key=>!['issueId','toNodeKey','justification'].includes(key))))return {error:'Devolução inválida.'};
 const input=action==='issue.list'?{organizationId:workspace,search:String(value),sortBy:'createdAt',sortOrder:'desc',page:1,limit:50}:action==='backlog.list'?{organizationId:workspace}:action==='backlog.reorder'?{organizationId:workspace,orderedIssueIds:value}:{organizationId:workspace,issueIds:[value]};
 if(['issue.detail','backlog.remove','backlog.issueHistory'].includes(action)){delete input.issueIds;input.issueId=value}
 if(action==='backlog.setSprintTarget'){delete input.issueIds;input.issueId=value.issueId;input.sprintTarget=value.sprintTarget}
 if(action==='process.issueList'){delete input.issueIds;Object.assign(input,{sortBy:'createdAt',sortOrder:'desc',page:value,limit:50})}
 if(action==='process.approvalList'){delete input.issueIds;Object.assign(input,{marcos:['aprovacao_negocio:ainda_falta'],sortBy:'createdAt',sortOrder:'desc',page:value,limit:50})}
 if(action==='process.lifecycle.phaseSummaries'){delete input.organizationId;input.workspaceId=workspace;input.issueIds=value}
 if(action==='process.lifecycle.get'){delete input.organizationId;delete input.issueIds;input.workspaceId=workspace;input.issueId=value}
 if(action==='processWorkflow.advance'){delete input.organizationId;delete input.issueIds;Object.assign(input,{workspaceId:workspace,issueId:value.issueId,toNodeKey:'analyzed',justification:value.justification.trim()})}
 const url=new URL('https://api.reposprint.com/trpc/'+(['process.issueList','process.approvalList'].includes(action)?'issue.list':action));url.searchParams.set('batch','1');const options={credentials:'include',signal:AbortSignal.timeout(20000)};
 if(['process.lifecycle.get','issue.list','issue.detail','process.issueList','process.approvalList','process.lifecycle.phaseSummaries','backlog.list','backlog.issueHistory'].includes(action))url.searchParams.set('input',JSON.stringify({'0':input}));else{options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({'0':input})}
 try{const response=await fetch(url,options);if(response.status===429){const header=response.headers.get('Retry-After'),seconds=Number(header),retryAfterMs=header?(Number.isFinite(seconds)?seconds*1000:Date.parse(header)-Date.now()):30000;return {error:'A consulta será retomada automaticamente após a pausa solicitada pelo RepoSprint.',rateLimited:true,retryAfterMs:Math.max(1000,Number.isFinite(retryAfterMs)?retryAfterMs:30000)}}if(response.status===401||response.status===403)return {error:'Entre novamente no RepoSprint e confira sua permissão no workspace.'};if(!response.ok)return {error:'RepoSprint não confirmou esta ação. Confira sua sessão e acesso.'};return {payload:await response.json()}}catch{return {error:'Não foi possível confirmar a resposta. Confira o RepoSprint antes de repetir a inclusão.'}}
}
