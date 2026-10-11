chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=='open-reposprint'||sender.url?.split('/')[2]!=='automacao-issues-ai.automacao-issue-chico.workers.dev')return;
  if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(message.repository)||!Number.isSafeInteger(message.number)||message.number<1)return;
  const params=new URLSearchParams({repository:message.repository,number:String(message.number)});
  chrome.windows.create({url:chrome.runtime.getURL('popup.html')+'?'+params,type:'popup',width:580,height:780}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
});
