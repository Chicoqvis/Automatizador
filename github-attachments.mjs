export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const mediaTypes = new Map([['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['mp4','video/mp4'],['webm','video/webm'],['mov','video/quicktime']]);
function error(message,status=400){return Object.assign(new Error(message),{status})}
export async function readAttachment(stream) {
  if(!stream)throw error("O arquivo está vazio.");
  const chunks=[];let size=0;
  for await(const chunk of stream){size+=chunk.byteLength;if(size>MAX_ATTACHMENT_BYTES)throw error('O anexo deve ter no máximo 10 MB.',413);chunks.push(chunk)}
  if(!size)throw error('O arquivo está vazio.');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}return bytes;
}
export async function uploadGithubAttachment(connection,name,bytes,fetcher=fetch) {
  if(!connection)throw error('Conecte um repositório GitHub antes de anexar arquivos.',409);
  name=String(name||'').split(/[\\/]/).pop().replace(/[\r\n<>"\u0000-\u001f]/g,'').slice(0,180);
  const type=mediaTypes.get(name.split('.').pop().toLowerCase());
  if(!type)throw error('Use PNG, JPG, GIF, WEBP, MP4, WEBM ou MOV.');
  if(!bytes.byteLength||bytes.byteLength>MAX_ATTACHMENT_BYTES)throw error('Use um arquivo de até 10 MB.',413);
  const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+connection.token,'User-Agent':'Automatizador-de-issues'};
  const repoResponse=await fetcher('https://api.github.com/repos/'+encodeURIComponent(connection.owner)+'/'+encodeURIComponent(connection.repo),{headers});
  if(!repoResponse.ok)throw error('Não foi possível acessar o repositório para anexar o arquivo.',repoResponse.status);
  const repo=await repoResponse.json();
  if(!Number.isSafeInteger(repo.id))throw error('Repositório inválido.',502);
  const url=new URL('https://uploads.github.com/user-attachments/assets');
  url.search=new URLSearchParams({name,content_type:type,repository_id:String(repo.id)}).toString();
  const response=await fetcher(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok){const detail=await response.json().catch(()=>({}));throw error(response.status===404||response.status===403?'O GitHub recusou o anexo. Confira o acesso de escrita ao repositório e as permissões do token.':detail.message||'Não foi possível enviar o anexo ao GitHub.',response.status)}
  const result=await response.json();let asset;
  try{asset=new URL(result.url)}catch{throw error('O GitHub não retornou um link de anexo válido.',502)}
  if(asset.protocol!=='https:'||asset.hostname!=='github.com'||!asset.pathname.startsWith('/user-attachments/assets/'))throw error('Link de anexo inesperado.',502);
  const alt=name.replace(/[\[\]]/g,'');
  return {name,url:asset.href,type,markdown:type.startsWith('image/')?'!['+alt+']('+asset.href+')':asset.href};
}
