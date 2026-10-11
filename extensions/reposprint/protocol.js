export function candidates(data,number){
 const found=new Map();let visited=0;
 function walk(value,depth){if(!value||typeof value!=='object'||depth>10||++visited>15000)return;if(typeof value.id==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(value.id)&&Number(value.number)===number&&typeof value.repositoryId==='string'){
 const repo=value.repository||{},name=repo.fullName||repo.full_name||(repo.owner?.login&&repo.name?repo.owner.login+'/'+repo.name:'');found.set(value.id,{id:value.id,number,title:String(value.title||'Issue #'+number),repositoryId:value.repositoryId,repository:typeof name==='string'?name:'',githubIssueId:value.githubIssueId})}
 for(const child of Object.values(value))walk(child,depth+1)
 }walk(data,0);return [...found.values()];
}
export function trpcData(payload){const result=Array.isArray(payload)?payload[0]:payload;if(result?.error)throw Error('RepoSprint recusou a ação. Confira seu acesso e a sessão.');if(!result?.result||!('data'in result.result))throw Error('Resposta inesperada do RepoSprint. Nenhuma confirmação recebida.');const data=result.result.data;return data?.json??data}
// Executada na aba RepoSprint; não lê nem retorna cookies ou tokens.
export async function pageRequest(action,workspace,value){
 if(location.origin!=='https://reposprint.com')return {error:'Abra uma aba do RepoSprint.'};
 if(!['issue.list','backlog.add'].includes(action)||!/^[-a-zA-Z0-9_]{1,200}$/.test(workspace))return {error:'Parâmetros inválidos.'};
 if(action==='issue.list'&&(!Number.isSafeInteger(value)||value<1)||action==='backlog.add'&&(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(value)))return {error:'Issue inválida.'};
 const input=action==='issue.list'?{organizationId:workspace,search:String(value),sortBy:'createdAt',sortOrder:'desc',page:1,limit:50}:{organizationId:workspace,issueIds:[value]};
 const url=new URL('https://api.reposprint.com/trpc/'+action);url.searchParams.set('batch','1');const options={credentials:'include',signal:AbortSignal.timeout(20000)};
 if(action==='issue.list')url.searchParams.set('input',JSON.stringify({'0':input}));else{options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({'0':input})}
 try{const response=await fetch(url,options);if(response.status===401||response.status===403)return {error:'Entre novamente no RepoSprint e confira sua permissão no workspace.'};if(!response.ok)return {error:'RepoSprint retornou HTTP '+response.status+'. Confira o backlog antes de tentar novamente.'};return {payload:await response.json()}}catch{return {error:'Não foi possível confirmar a resposta. Confira o RepoSprint antes de repetir a inclusão.'}}
}
