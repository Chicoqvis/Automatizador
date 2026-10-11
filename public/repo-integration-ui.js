(()=>{
 const button=document.getElementById('integrateRepoSprint');if(!button)return;
 const version='0.4.6',downloadURL='/public/downloads/reposprint-extension.zip',folderName='reposprint-'+version;
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el};
 function download(){const link=node('a');link.href=downloadURL;link.download='reposprint-extension.zip';document.body.append(link);link.click();link.remove()}
 function detect(){return new Promise(resolve=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{window.removeEventListener('message',receive);resolve(null)},2500);function receive(event){if(event.source!==window||event.origin!==location.origin||event.data?.type!=='automacao-repo-process-ready'||event.data.id!==id)return;clearTimeout(timer);window.removeEventListener('message',receive);resolve(event.data.version||null)}window.addEventListener('message',receive);window.postMessage({type:'automacao-repo-process-ping',id},location.origin)})}
 button.addEventListener('click',()=>{
  const current=document.getElementById('repoIntegrationDialog');if(current){current.showModal();return}
  const direct=window.isSecureContext&&typeof window.showDirectoryPicker==='function';let preparing=false;
  const dialog=node('dialog');dialog.id='repoIntegrationDialog';dialog.className='issue-preview-dialog';dialog.setAttribute('aria-label','Integrar com o RepoSprint');dialog.style.maxWidth='650px';
  const status=node('p',direct?'Vamos conectar em três etapas. Você só precisa instalar uma vez.':'Use Chrome ou Edge no computador para integrar. O download em ZIP está disponível abaixo.');status.setAttribute('aria-live','polite');dialog.append(node('h2','Integrar com o RepoSprint'),status);
  function action(container,text,handler,repo=true){const el=node('button',text);el.type='button';el.className='btn soft';if(repo)el.dataset.repoProcess='';el.addEventListener('click',handler);container.append(el);return el}
  function section(title,text){const box=node('section');box.style.cssText='margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:10px';box.append(node('strong',title),node('p',text));dialog.append(box);return box}
  const first=section('1. Preparar extensão',direct?'Escolha onde salvar. A ferramenta cria a pasta pronta, sem ZIP e sem extração.':'Baixe o ZIP, extraia em uma pasta permanente e use a pasta reposprint.');
  const prepare=action(first,direct?'Escolher pasta e preparar':'Baixar extensão',async()=>{
   if(!direct){download();status.textContent='Download solicitado. Extraia o ZIP e siga a etapa 2.';return}
   preparing=true;prepare.disabled=true;
   try{
    const parent=await window.showDirectoryPicker({id:'repo-extension',mode:'readwrite',startIn:'documents'});
    status.textContent='Preparando os arquivos da extensão…';
    const response=await fetch('/public/downloads/reposprint-extension.json',{cache:'no-store'});if(!response.ok)throw Error('Não foi possível baixar os arquivos.');const bundle=await response.json();
    if(bundle.version!==version||!bundle.files||typeof bundle.files!=='object'||Array.isArray(bundle.files)||!bundle.files['manifest.json']||Object.keys(bundle.files).length>40)throw Error('Pacote de extensão inválido.');
    for(const [name,content] of Object.entries(bundle.files))if(!/^[a-zA-Z0-9_-]+\.(js|json|html|css|md)$/.test(name)||typeof content!=='string'||content.length>500000)throw Error('Pacote de extensão inválido.');
    const manifest=JSON.parse(bundle.files['manifest.json']);if(manifest.version!==version||manifest.manifest_version!==3)throw Error('Versão da extensão inválida.');
    const folder=await parent.getDirectoryHandle(folderName,{create:true});
    // Grava o manifest por último: uma instalação incompleta não fica pronta para carregar.
    const files=Object.entries(bundle.files).sort(([a],[b])=>a==='manifest.json'?1:b==='manifest.json'?-1:a.localeCompare(b));
    for(const [name,content] of files){const handle=await folder.getFileHandle(name,{create:true}),writer=await handle.createWritable();try{await writer.write(content);await writer.close()}catch(error){try{await writer.abort()}catch{}throw error}}
    status.textContent='Pasta pronta: '+parent.name+' / '+folderName+'. Agora carregue essa pasta na etapa 2.';prepare.textContent='Preparar em outra pasta';first.dataset.complete='true';
   }catch(error){status.textContent=error.name==='AbortError'?'Escolha de pasta cancelada. Clique novamente quando quiser continuar.':'Não foi possível preparar a pasta. Tente novamente ou use Baixar ZIP.'}
   finally{preparing=false;prepare.disabled=false}
  });
  const second=section('2. Ativar no navegador','Abra a página de extensões, ative Modo do desenvolvedor e clique em Carregar sem compactação (ou Carregar descompactado). Selecione a pasta preparada na etapa 1.');
  const address=/Edg\//.test(navigator.userAgent)?'edge://extensions':'chrome://extensions',url=node('input');url.value=address;url.readOnly=true;url.setAttribute('aria-label','Endereço da página de extensões');url.style.cssText='margin-bottom:8px';second.append(url);
  action(second,'Copiar endereço',async()=>{try{await navigator.clipboard.writeText(address);status.textContent='Endereço copiado. Cole na barra do navegador para abrir a página de extensões.'}catch{url.focus();url.select();status.textContent='Copie o endereço selecionado e cole na barra do navegador.'}});
  const third=section('3. Conectar sua conta','Entre no RepoSprint com sua conta neste navegador. Depois volte e recarregue a ferramenta.');const repo=node('a','Entrar no RepoSprint');repo.className='btn repo-review-link';repo.href='https://reposprint.com/app';repo.target='_blank';repo.rel='noopener noreferrer';third.append(repo);
  const footer=node('div');footer.className='workflow-actions';
  const check=action(footer,'Verificar instalação',async()=>{check.disabled=true;status.textContent='Verificando…';const found=await detect();status.textContent=found===version?'Extensão pronta! Entre no RepoSprint e recarregue a ferramenta.':found?'Extensão '+found+' encontrada. Prepare a versão '+version+' e carregue a nova pasta na página de extensões.':'Extensão não encontrada nesta página. Conclua a etapa 2 e recarregue a ferramenta.';check.disabled=false});
  action(footer,'Baixar ZIP',download,false);action(footer,'Fechar',()=>{if(!preparing)dialog.close()},false);dialog.append(footer,node('p','A escolha da pasta e a ativação precisam da sua confirmação no navegador.'));dialog.addEventListener('cancel',event=>{if(preparing)event.preventDefault()});dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
 });
})();
