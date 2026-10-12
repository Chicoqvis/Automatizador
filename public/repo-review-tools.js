(function(root){
 const pending=row=>row.process?.currentPhase==='business_approved'&&!['completed','done','skipped','cancelled','canceled'].includes(row.process.phaseStatus)&&row.state==='open'&&!row.deletedAt;
 function pendingSummary(rows,now=Date.now()){const total=rows.length,age=row=>now-Date.parse(row.process?.enteredCurrentPhaseAt||row.enteredAt||row.createdAt||'');return {total,over3:rows.filter(row=>age(row)>3*86400000).length,over7:rows.filter(row=>age(row)>7*86400000).length}}
 function observeChanges(previous,data){
  const state=previous&&typeof previous.baseline==='object'&&Array.isArray(previous.events)?structuredClone(previous):{initialized:false,baseline:{},events:[],checkedAt:0};if(data.checkedAt<state.checkedAt)return state;
  for(const row of data.items){if(!row.id||!row.process?.currentPhase)continue;const old=state.baseline[row.id],current={id:row.id,number:row.number,title:row.title,author:row.author,githubUrl:row.githubUrl,state:row.state,deletedAt:row.deletedAt,process:row.process};let type=null;
   if(state.initialized&&(!old||old.process?.currentPhase)&&pending(current)&&(!old||!pending(old)))type='new-approval';
   else if(state.initialized&&old?.process?.currentPhase&&old.process.currentPhase!==current.process.currentPhase)type='phase-changed';
   else if(state.initialized&&old&&pending(old)&&!pending(current))type='approval-finished';
   if(type){const signature=[row.id,type,old?.process?.currentPhase||'',row.process.currentPhase,row.process.phaseStatus||'',row.process.enteredCurrentPhaseAt||''].join('/');if(!state.events.some(event=>event.signature===signature))state.events.push({...current,workspace:data.workspace,type,signature,from:old?.process?.phaseLabel||old?.process?.currentPhase||null,to:row.process.phaseLabel||row.process.currentPhase,detectedAt:data.checkedAt,read:false})}
   state.baseline[row.id]=current;
  }
  if(!data.partial)state.initialized=true;state.checkedAt=data.checkedAt;state.events=state.events.slice(-100);return state;
 }
 function safeURL(value){try{const url=new URL(value);return url.protocol==='https:'&&url.username===''&&url.password===''?url:null}catch{return null}}
 function mediaURL(url){return (url.hostname==='github.com'&&url.pathname.startsWith('/user-attachments/'))||['user-images.githubusercontent.com','private-user-images.githubusercontent.com'].includes(url.hostname)}
 function renderIssue(container,body){
  container.replaceChildren();const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el},attachments=new Map(),content=node('div');content.className='repo-issue-description';
  function attachment(value,kind,label){const url=safeURL(value);if(url&&!attachments.has(url.href)&&attachments.size<30)attachments.set(url.href,{url,kind,label:label||'Anexo'})}
  for(const original of String(body||'').slice(0,200000).split('\n')){let line=original;
   line=line.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g,(_,alt,url)=>{attachment(url,'image',alt);return ''});
   line=line.replace(/<(img|video)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:<\/video>)?/gi,(_,tag,url)=>{attachment(url,tag.toLowerCase()==='img'?'image':'video','Anexo');return ''});
   line=line.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,(original,label,value)=>{const url=safeURL(value);if(url&&mediaURL(url)){attachment(value,'file',label);return ''}return original});
   const raw=line.trim();if(/^https:\/\/github\.com\/user-attachments\//.test(raw)){attachment(raw,/\.(mp4|webm|mov)(?:\?|$)/i.test(raw)?'video':'file','Anexo');continue}
   const head=line.match(/^#{1,6}\s+(.+)$/);if(head){content.append(node('h4',head[1]));continue}if(!line.trim())continue;
   const p=node('p');p.style.whiteSpace='pre-wrap';let offset=0;for(const match of line.matchAll(/\*\*([^*]+)\*\*/g)){p.append(document.createTextNode(line.slice(offset,match.index)),node('strong',match[1]));offset=match.index+match[0].length}p.append(document.createTextNode(line.slice(offset)));content.append(p);
  }
  if(!content.childNodes.length)content.append(node('p','Esta issue não possui descrição.'));container.append(content);
  if(attachments.size){container.append(node('h4','Anexos ('+attachments.size+')'));const grid=node('div');grid.className='repo-issue-attachments';for(const {url,kind,label} of attachments.values()){const card=node('div');card.className='attachment-card';if(mediaURL(url)&&kind==='image'){const image=node('img');image.src=url.href;image.alt=label;image.loading='lazy';image.referrerPolicy='no-referrer';card.append(image)}else if(mediaURL(url)&&kind==='video'){const video=node('video');video.src=url.href;video.controls=true;video.preload='metadata';card.append(video)}const link=node('a',label==='Anexo'?'Abrir anexo':label);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';card.append(link);grid.append(card)}container.append(grid)}
 }
 root.RepoReviewTools={pendingSummary,observeChanges,renderIssue};
})(globalThis);
