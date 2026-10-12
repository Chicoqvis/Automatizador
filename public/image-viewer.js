(function(){
 let opened=false;const selector='.attachment-card img,.issue-preview-dialog img,.issue-preview-content img';
 function eligible(image){return image instanceof HTMLImageElement&&image.matches(selector)&&!image.closest('[data-image-viewer]')}
 function prepare(){document.querySelectorAll(selector).forEach(image=>{if(!eligible(image))return;image.style.cursor='zoom-in';image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','Ampliar imagem'+(image.alt?': '+image.alt:''))})}
 function open(image){
  if(opened||!eligible(image))return;opened=true;
  const scope=image.closest('[data-repo-issue-content],.issue-preview-content,dialog,.field')||image.parentElement;
  const images=[...scope.querySelectorAll('img')].filter(eligible);let index=Math.max(0,images.indexOf(image));
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='issue-preview-dialog';dialog.dataset.imageViewer='';dialog.setAttribute('aria-label','Imagem ampliada');dialog.style.width='min(1200px,calc(100vw - 32px))';
  const title=document.createElement('h2'),controls=document.createElement('div');controls.className='workflow-actions';
  const viewport=document.createElement('div');viewport.style.cssText='height:min(65vh,650px);overflow:auto;max-width:100%;border:1px solid var(--line);margin-top:12px';
  const picture=document.createElement('img');picture.referrerPolicy='no-referrer';picture.style.cssText='display:block;max-width:none;max-height:none;margin:0';viewport.append(picture);
  const label=document.createElement('span'),position=document.createElement('span');label.setAttribute('aria-live','polite');position.setAttribute('aria-live','polite');let scale=1;
  function zoom(value){scale=Math.max(.1,Math.min(4,value));picture.style.width=Math.round((picture.naturalWidth||images[index].naturalWidth||800)*scale)+'px';picture.style.height='auto';label.textContent=Math.round(scale*100)+'%'}
  function fit(){const width=picture.naturalWidth||images[index].naturalWidth||800,height=picture.naturalHeight||images[index].naturalHeight||600;zoom(Math.min(1,(viewport.clientWidth-16)/width,(viewport.clientHeight-16)/height))}
  function control(text,action){const button=document.createElement('button');button.type='button';button.className='btn soft';button.textContent=text;button.addEventListener('click',action);controls.append(button);return button}
  const back=control('Imagem anterior',()=>show(index-1)),next=control('Próxima imagem',()=>show(index+1));controls.append(position);
  function show(value){if(value<0||value>=images.length)return;index=value;const current=images[index];title.textContent=current.alt||'Imagem ampliada';picture.alt=current.alt;position.textContent=(index+1)+' de '+images.length;back.disabled=index===0;next.disabled=index===images.length-1;back.hidden=next.hidden=images.length<2;label.textContent='Carregando imagem…';viewport.scrollTop=viewport.scrollLeft=0;picture.src=current.currentSrc||current.src;if(picture.complete&&picture.naturalWidth)fit()}
  for(const [text,action] of [['Diminuir zoom',()=>zoom(scale/1.25)],['Aumentar zoom',()=>zoom(scale*1.25)],['Ajustar à tela',fit],['Tamanho original',()=>zoom(1)],['Fechar',()=>dialog.close()]])control(text,action);
  controls.append(label);dialog.append(title,controls,viewport);
  const navigate=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(index+(event.key==='ArrowLeft'?-1:1))}};document.addEventListener('keydown',navigate);
  dialog.addEventListener('close',()=>{document.removeEventListener('keydown',navigate);opened=false;dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true})});picture.addEventListener('load',fit);picture.addEventListener('error',()=>{label.textContent='Não foi possível carregar a imagem.'});document.body.append(dialog);dialog.showModal();show(index);
 }
 document.addEventListener('click',event=>{if(eligible(event.target)){event.preventDefault();open(event.target)}});document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&eligible(event.target)){event.preventDefault();open(event.target)}});new MutationObserver(prepare).observe(document.documentElement,{childList:true,subtree:true});prepare();
})();