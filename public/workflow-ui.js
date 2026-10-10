window.setupIssueWorkflow=function(config){
  const main=document.querySelector('main'),initial=config.capture();let active=null,dirty=!!(initial.raw||initial.title||initial.description),busy=false;
  function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node}
  async function api(url,init){const response=await fetch(url,{signal:AbortSignal.timeout(60000),...init});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível concluir a operação.');return data}
  const panel=el('section',undefined,'account-drafts'),heading=el('strong','Rascunhos da minha conta'),row=el('div',undefined,'workflow-actions'),select=el('select'),save=el('button','Salvar na conta','btn soft'),copy=el('button','Salvar como novo','btn soft'),load=el('button','Abrir','btn soft'),remove=el('button','Excluir','btn soft'),refresh=el('button','Atualizar lista','btn soft'),status=el('div',undefined,'workflow-note');
  select.setAttribute('aria-label','Rascunhos da minha conta');status.setAttribute('aria-live','polite');[save,copy,load,remove,refresh].forEach(button=>button.type='button');row.append(select,save,copy,load,remove,refresh);panel.append(heading,row,status);document.getElementById('raw').closest('.assist').after(panel);
  function message(text){status.textContent=text}
  main.addEventListener('input',event=>{if(event.target.closest('.account-drafts'))return;dirty=true});
  main.addEventListener('change',event=>{if(event.target.closest('.account-drafts'))return;dirty=true});
  async function list(){const data=await api('/api/drafts');const previous=active?.id||select.value;select.replaceChildren(new Option('Selecionar um rascunho salvo',''));data.drafts.forEach(item=>select.add(new Option(item.name+' · '+new Date(item.updated_at).toLocaleString('pt-BR'),item.id)));if([...select.options].some(x=>x.value===previous))select.value=previous;load.disabled=remove.disabled=!select.value}
  select.addEventListener('change',()=>{load.disabled=remove.disabled=!select.value});
  function controls(disabled){[save,copy,load,remove,refresh,select].forEach(node=>node.disabled=disabled);if(!disabled)load.disabled=remove.disabled=!select.value}
  async function operation(fn){if(busy)return;busy=true;controls(true);try{await fn()}catch(error){message(error.message)}finally{busy=false;controls(false)}}
  async function persist(asNew){if(config.uploading())throw new Error('Aguarde a geração da IA ou o envio dos anexos.');const name=prompt('Nome do rascunho:',asNew?document.getElementById('title').value:active?.name||document.getElementById('title').value);if(name===null)return;const snapshot=JSON.parse(JSON.stringify(config.capture()));const data=await api('/api/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,snapshot,...(!asNew&&active?{id:active.id,revision:active.revision}:{})})});active=data.draft;dirty=JSON.stringify(config.capture())!==JSON.stringify(snapshot);await list();message(dirty?'Versão salva. Existem novas alterações no formulário; salve novamente para incluí-las.':'Salvo na sua conta. Disponível ao entrar em outro dispositivo.')}
  save.addEventListener('click',()=>operation(()=>persist(false)));copy.addEventListener('click',()=>operation(()=>persist(true)));refresh.addEventListener('click',()=>operation(async()=>{await list();message('Lista atualizada.')}));
  load.addEventListener('click',()=>operation(async()=>{if(config.uploading())throw new Error('Aguarde a geração da IA ou o envio dos anexos.');if(dirty&&!confirm('Abrir este rascunho e substituir o conteúdo atual? Salve antes se quiser mantê-lo.'))return;const data=await api('/api/drafts/'+encodeURIComponent(select.value));await config.restore(data.draft.snapshot);active=data.draft;dirty=false;message('Rascunho aberto. As alterações só vão para sua conta ao clicar em Salvar na conta.')}));
  remove.addEventListener('click',()=>operation(async()=>{if(!confirm('Excluir o rascunho selecionado da sua conta?'))return;const data=await api('/api/drafts/'+encodeURIComponent(select.value));await api('/api/drafts/'+encodeURIComponent(data.draft.id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:data.draft.revision})});if(active?.id===data.draft.id)active=null;await list();message('Rascunho excluído da conta. O conteúdo aberto continua no formulário.')}));
  list().then(()=>message('Use Salvar na conta para continuar em outro dispositivo.')).catch(error=>message(error.message));
  function safeUrl(value){try{const url=new URL(value);return url.protocol==='https:'?url.href:null}catch{return null}}
  function media(url,type,name){const safe=safeUrl(url);if(!safe)return el('p','Anexo com link inválido.');const node=el(type==='image'?'img':'video');node.src=safe;if(type==='image'){node.alt=name||'Imagem anexada';node.loading='lazy'}else{node.controls=true;node.preload='metadata'}return node}
  function inlineText(node,text){
    const regex=/\*\*([^*]+)\*\*/g;let offset=0,match;
    while((match=regex.exec(text))){node.append(document.createTextNode(text.slice(offset,match.index)),el('strong',match[1]));offset=regex.lastIndex}node.append(document.createTextNode(text.slice(offset)));return node;
  }
  function renderBody(container,body){
    let listNode=null;
    for(const line of body.split('\n')){
      const image=line.match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/),htmlImage=line.match(/^<img\b[^>]*src=["'](https:\/\/[^"']+)["'][^>]*>/i),asset=line.match(/^https:\/\/github\.com\/user-attachments\/assets\/[a-zA-Z0-9-]+$/);
      if(image||htmlImage){container.append(media(image?image[2]:htmlImage[1],'image',image?image[1]:''));listNode=null;continue}
      if(asset){container.append(media(asset[0],'video'));listNode=null;continue}
      if(line.startsWith('## ')){container.append(el('h3',line.slice(3)));listNode=null;continue}
      if(/^[-*] /.test(line)){if(!listNode){listNode=el('ul');container.append(listNode)}listNode.append(inlineText(el('li'),line.slice(2)));continue}
      listNode=null;if(line.trim())container.append(inlineText(el('p'),line));
    }
  }
  async function review(title,body,metadata){
    const dialog=el('dialog',undefined,'issue-preview-dialog'),header=el('header'),label=el('div','Revisar antes de criar a issue','workflow-note'),titleNode=el('h2',title),meta=el('div',metadata,'workflow-note'),content=el('div',undefined,'issue-preview-content'),similar=el('section',undefined,'similar-issues'),similarTitle=el('h3','Issues semelhantes'),similarStatus=el('p','Consultando o repositório…'),matches=el('div'),ack=el('label',undefined,'workflow-ack'),checkbox=el('input'),footer=el('footer',undefined,'workflow-actions'),back=el('button','Voltar e editar','btn soft'),send=el('button','Confirmar e criar issue','btn primary');
    checkbox.type='checkbox';ack.append(checkbox,document.createTextNode('Revisei o aviso e quero criar uma nova issue.'));ack.hidden=true;send.disabled=true;back.type=send.type='button';header.append(label,titleNode,meta);renderBody(content,body);similar.append(similarTitle,similarStatus,matches,ack);footer.append(back,send);dialog.append(header,content,similar,footer);document.body.append(dialog);dialog.showModal();
    checkbox.addEventListener('change',()=>send.disabled=!checkbox.checked);
    const answer=new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(value)};back.addEventListener('click',()=>finish(false));send.addEventListener('click',()=>finish(true));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)})});
    api('/api/github/similar?title='+encodeURIComponent(title)).then(data=>{
      if(!dialog.isConnected)return;
      if(data.issues.length){similarStatus.textContent='Confira se esta solicitação já está registrada'+(data.limited?' (a pesquisa retornou resultados limitados).':'.');data.issues.forEach(issue=>{const link=el('a','#'+issue.number+' · '+issue.title+' · '+(issue.state==='open'?'aberta':'fechada'));link.href=safeUrl(issue.url)||'#';link.target='_blank';link.rel='noopener noreferrer';const row=el('p');row.append(link);matches.append(row)});ack.hidden=false}
      else{similarStatus.textContent=data.limited?'Nenhuma correspondência encontrada nos resultados consultados. A pesquisa foi limitada.':'Nenhuma issue semelhante encontrada pelo título. A busca pode não identificar todos os casos.';if(data.limited)ack.hidden=false;else send.disabled=false}
    }).catch(error=>{if(!dialog.isConnected)return;similarStatus.textContent=error.message+' Você pode revisar o repositório e continuar.';ack.hidden=false});
    return answer;
  }
  return {review,markDirty(){dirty=true},reset(){active=null;dirty=true;select.value='';message('Novo rascunho. Use Salvar na conta quando quiser mantê-lo.')}};
};
