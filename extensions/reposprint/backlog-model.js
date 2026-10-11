export const buckets={out:'Fora de sprint',active:'Sprint ativa',future:'Sprint futura'};
export function backlogRows(data){
 if(!Array.isArray(data)||data.length>5000)throw Error('Formato do backlog inesperado. Nenhuma ordem será enviada.');
 const ids=new Set();for(const row of data){if(!row||!/^[-a-zA-Z0-9_]{1,200}$/.test(row.issueId)||ids.has(row.issueId)||!Number.isFinite(row.position))throw Error('Backlog sem identificação ou posição válida. Atualize antes de continuar.');ids.add(row.issueId)}
 return data.map(x=>({...x})).sort((a,b)=>a.position-b.position);
}
export function snapshot(rows){return JSON.stringify(rows.map(x=>[x.issueId,x.position,x.sprintTarget]))}
export function move(rows,id,target){
 const item=rows.find(x=>x.issueId===id),other=rows.find(x=>x.issueId===target);
 if(!item||!other||item===other||item.sprintTarget!==other.sprintTarget||!buckets[item.sprintTarget])return rows;
 const group=rows.filter(x=>x.sprintTarget===item.sprintTarget),from=group.indexOf(item),to=group.indexOf(other);group.splice(from,1);group.splice(to,0,item);let index=0;
 return rows.map(x=>x.sprintTarget===item.sprintTarget?group[index++]:x);
}
