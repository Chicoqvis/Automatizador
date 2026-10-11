(()=>{
 const button=document.getElementById('integrateRepoSprint');if(!button)return;
 const version='0.4.6',downloadURL='/public/downloads/reposprint-extension.zip';
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el};
 function download(){const link=node('a');link.href=downloadURL;link.download='reposprint-extension.zip';document.body.append(link);link.click();link.remove()}
 function detect(){return new Promise(resolve=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{window.removeEventListener('message',receive);resolve(null)},2500);function receive(event){if(event.source!==window||event.origin!==location.origin||event.data?.type!=='automacao-repo-process-ready'||event.data.id!==id)return;clearTimeout(timer);window.removeEventListener('message',receive);resolve(event.data.version||null)}window.addEventListener('message',receive);window.postMessage({type:'automacao-repo-process-ping',id},location.origin)})}
 button.addEventListener('click',()=>{
  const current=document.getElementById('repoIntegrationDialog');if(current){current.showModal();return}
  const dialog=node('dialog');dialog.id='repoIntegrationDialog';dialog.className='issue-preview-dialog';dialog.setAttribute('aria-label','Integrar com o RepoSprint');dialog.style.maxWidth='650px';
  const status=node('p','O download da extensão foi solicitado. Confira os downloads do navegador.');status.setAttribute('aria-live','polite');
  dialog.append(node('h2','Integrar com o RepoSprint'),status,node('p','Instale uma vez neste navegador para consultar fases, priorizar o backlog e usar as ações do RepoSprint.'));
  const steps=node('ol');for(const text of ['Extraia o arquivo reposprint-extension.zip em uma pasta permanente no computador.','Abra chrome://extensions no Chrome ou edge://extensions no Edge e ative o Modo do desenvolvedor.','Clique em Carregar sem compactação (ou Carregar descompactado) e selecione a pasta reposprint extraída, que contém manifest.json.','Entre no RepoSprint com sua própria conta no mesmo navegador.','Volte à ferramenta e recarregue esta página.']){const item=node('li',text);item.style.marginBottom='10px';steps.append(item)}dialog.append(steps);
  dialog.append(node('p','O navegador exige confirmação da instalação. Baixar o arquivo não instala nem conecta a extensão automaticamente. No celular, use um computador com Chrome ou Edge.'));
  const controls=node('div');controls.className='workflow-actions';controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:14px';
  function action(text,handler,repo=false){const el=node('button',text);el.type='button';el.className='btn soft';if(repo)el.dataset.repoProcess='';el.addEventListener('click',handler);controls.append(el);return el}
  action('Baixar novamente',download,true);
  const check=action('Verificar instalação',async()=>{check.disabled=true;status.textContent='Verificando a extensão neste navegador…';const found=await detect();status.textContent=found===version?'Extensão '+version+' encontrada. Faça login no RepoSprint e recarregue a ferramenta.':found?'Extensão '+found+' encontrada. Substitua os arquivos pelo pacote '+version+', clique em Recarregar na página de extensões e recarregue a ferramenta.':'Extensão não encontrada nesta página. Conclua a instalação e recarregue a ferramenta.';check.disabled=false},true);
  const repo=node('a','Entrar no RepoSprint');repo.className='btn repo-review-link';repo.href='https://reposprint.com/app';repo.target='_blank';repo.rel='noopener noreferrer';controls.append(repo);
  action('Fechar',()=>dialog.close());dialog.append(controls);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();download();
 });
})();
