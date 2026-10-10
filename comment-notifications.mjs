import {workflowError} from './issue-workflow.mjs';
export async function commentNotifications(connection,entries,params,api){
 const since=Number(params.get('since')),page=Number(params.get('page')||1),started=Date.now();
 if(!Number.isSafeInteger(since)||since<0||since>started+60000||!Number.isSafeInteger(page)||page<1||page>1000)throw workflowError('Consulta de notificações inválida.');
 const repository=(connection.owner+'/'+connection.repo).toLowerCase(),own=new Map(entries.filter(e=>e.repository.toLowerCase()===repository).map(e=>[e.number,e]));
 if(!own.size)return {comments:[],hasMore:false,checkedAt:started};
 const response=await api('/repos/'+repository+'/issues/comments?per_page=100&page='+page+'&sort=created&direction=asc&since='+encodeURIComponent(new Date(since).toISOString()),connection.token,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw workflowError('Não foi possível verificar comentários em '+repository+'. Confira o acesso ao GitHub.',502);
 const rows=await response.json();if(!Array.isArray(rows))throw workflowError('Resposta de comentários inválida.',502);
 const comments=rows.filter(c=>own.has(Number(String(c.issue_url).split('/').at(-1)))&&Date.parse(c.created_at)>since).map(c=>{const number=Number(c.issue_url.split('/').at(-1));return {id:c.id,repository,number,title:own.get(number).title,author:c.user?.login||'GitHub',body:String(c.body||'').replace(/<!-- automatizador-comment:[a-f0-9-]+ -->/g,'').slice(0,500),url:'https://github.com/'+repository+'/issues/'+number+'#issuecomment-'+c.id,createdAt:c.created_at}});
 return {comments,hasMore:rows.length===100,checkedAt:started};
}
