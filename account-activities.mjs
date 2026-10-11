export function accountActivities(issues,operations,mentions){
 const items=issues.map(x=>({type:'issue',id:'issue:'+x.repository+':'+x.number,repository:x.repository,number:x.number,title:x.title,url:x.url,createdAt:x.createdAt,state:x.issueState||'unknown'}));
 const known=new Map(issues.map(x=>[(x.repository+'#'+x.number).toLowerCase(),x.title]));
 for(const row of operations){if(row.state!=='done'||!row.result)continue;let x;try{x=typeof row.result==='string'?JSON.parse(row.result):row.result}catch{continue}const match=String(x.url||'').match(/^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/issues\/(\d+)#issuecomment-(\d+)$/i);if(!match)continue;const repository=match[1].toLowerCase(),number=Number(match[2]);items.push({type:'comment',id:'comment:'+repository+':'+match[3],repository,number,title:known.get(repository+'#'+number)||'Issue #'+number,url:x.url,createdAt:Date.parse(x.createdAt)||row.started_at,body:String(x.body||'').slice(0,500),author:x.author})}
 for(const x of mentions)items.push({type:'mention',id:'mention:'+x.repository+':'+x.id,repository:x.repository,number:x.number,title:x.title,url:x.url,createdAt:Date.parse(x.createdAt),body:String(x.body||'').slice(0,500),author:x.author,resolved:!!x.resolved});
 return [...new Map(items.filter(x=>Number.isFinite(x.createdAt)).map(x=>[x.id,x])).values()].sort((a,b)=>b.createdAt-a.createdAt);
}
