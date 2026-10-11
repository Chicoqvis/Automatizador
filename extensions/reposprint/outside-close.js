(()=>{
 document.addEventListener('pointerdown',event=>{
  if(!(event.target instanceof Element))return;
  document.querySelectorAll('details[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false});
  const dialog=event.target.closest('dialog[open]');if(!dialog||event.target!==dialog)return;
  const rect=dialog.getBoundingClientRect();if(event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom)return;
  // Usa o mesmo cancelamento do Esc: preserva rascunhos e respeita operações em andamento.
  if(dialog.dispatchEvent(new Event('cancel',{cancelable:true}))&&dialog.open)dialog.close();
 });
})();
