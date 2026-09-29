const SW_VERSION='3.9.5';
const APP_BUILD='1.73.5';

const CACHE_SHELL='portal-cij-unified-v3-shell';
const CACHE_RUNTIME='portal-cij-unified-v3-runtime';

const PORTAL_SHELL=[
  './',
  './index.html',
  './core.js',
  './core.js?v=20260928-1720',
  './manifest.json',
  './central_cadastros.html',
  './estoque_pecas.html',
  './suporte-mobile.html',
  './requisicao_material.html',
  './cadastros_clientes.html',
  './cadastros_modelos.html',
  './cadastros_pecas.html',
  './cadastros_consumiveis.html',
  './parque_maquinas.html',
  './erp-cadastros-v4-3.css',
  './erp-cadastros-v4-3-2.js'
];

const ASSISTENCIA_SHELL=[
  './assistencia.html',
  './assistencia-manifest-v4.json',
  './assistencia-icon-192.png',
  './assistencia-icon-512.png'
];

async function cacheOne(cache,url){
  try{
    const response=await fetch(url,{cache:'reload'});
    if(response&&(response.ok||response.type==='opaque')){
      await cache.put(url,response.clone());
      return true;
    }
  }catch(_){}
  return false;
}

async function cacheShell(){
  const cache=await caches.open(CACHE_SHELL);
  for(const url of [...PORTAL_SHELL,...ASSISTENCIA_SHELL]){
    await cacheOne(cache,url);
  }
}

self.addEventListener('install',event=>{
  event.waitUntil(cacheShell());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    const obsolete=keys.filter(k=>{
      if([CACHE_SHELL,CACHE_RUNTIME].includes(k))return false;
      return k.startsWith('portal-cij-')||
             k.startsWith('cij-assistencia-tecnico-');
    });
    await Promise.all(obsolete.map(k=>caches.delete(k)));
    await self.clients.claim();

    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    clients.forEach(client=>{
      try{client.postMessage({type:'SW_ACTIVATED',version:SW_VERSION,build:APP_BUILD})}catch(_){}
    });
  })());
});

self.addEventListener('message',event=>{
  const data=event.data||{};

  if(data.type==='SKIP_WAITING'){
    self.skipWaiting();
    return;
  }

  if(data.type==='GET_VERSION'){
    const payload={type:'SW_VERSION',version:SW_VERSION,build:APP_BUILD};
    try{
      if(event.ports&&event.ports[0])event.ports[0].postMessage(payload);
      else event.source?.postMessage(payload);
    }catch(_){}
    return;
  }

  if(data.type==='CACHE_CURRENT_PAGE'&&data.url){
    event.waitUntil((async()=>{
      try{
        const response=await fetch(data.url,{cache:'reload'});
        if(response&&response.ok){
          const cache=await caches.open(CACHE_SHELL);
          await cache.put(data.url,response.clone());
        }
      }catch(_){}
    })());
  }
});

function isFirebaseApi(url){
  return url.hostname==='firestore.googleapis.com'||
         url.hostname==='identitytoolkit.googleapis.com'||
         url.hostname==='securetoken.googleapis.com'||
         url.hostname==='firebaseinstallations.googleapis.com';
}

function isStaticCrossOrigin(url){
  return [
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'www.gstatic.com',
    'cdn.jsdelivr.net',
    'esm.sh',
    'unpkg.com'
  ].includes(url.hostname);
}

async function staleWhileRevalidate(request,cacheName){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request);

  const network=fetch(request).then(response=>{
    if(response&&(response.ok||response.type==='opaque')){
      cache.put(request,response.clone()).catch(()=>{});
    }
    return response;
  }).catch(()=>null);

  return cached||await network||Response.error();
}

async function networkFirst(request,cacheName){
  const cache=await caches.open(cacheName);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok){
      cache.put(request,response.clone()).catch(()=>{});
    }
    return response;
  }catch(_){
    // core.js é publicado com query string de versão. Em offline, uma versão
    // armazenada sem a query precisa continuar atendendo o módulo ES.
    return (await cache.match(request))||
           (await cache.match(request,{ignoreSearch:true}))||
           (await caches.match(request,{ignoreSearch:true}))||
           null;
  }
}

async function navigationFallback(request){
  const url=new URL(request.url);
  const isAssistencia=url.pathname.endsWith('/assistencia.html')||
                      url.searchParams.get('modo')==='tecnico'||
                      url.searchParams.get('app')==='tecnico';

  const cache=await caches.open(CACHE_SHELL);

  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok){
      await cache.put(request,response.clone()).catch(()=>{});
      return response;
    }
  }catch(_){}

  const exact=(await caches.match(request))||(await caches.match(request,{ignoreSearch:true}));
  if(exact)return exact;

  if(isAssistencia){
    const app=await caches.match('./assistencia.html');
    if(app)return app;
  }

  const index=await caches.match('./index.html')||await caches.match('./');
  if(index)return index;

  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portal CIJ</title><body style="font-family:system-ui;padding:24px"><h2>Portal CIJ</h2><p>Este dispositivo ainda não possui a página necessária armazenada para uso offline. Conecte-se à internet e abra o módulo uma vez.</p></body>',
    {headers:{'Content-Type':'text/html; charset=utf-8'}}
  );
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  const url=new URL(request.url);

  // APIs do Firebase continuam sob responsabilidade do SDK.
  if(isFirebaseApi(url))return;

  if(request.mode==='navigate'){
    event.respondWith(navigationFallback(request));
    return;
  }

  if(url.origin===self.location.origin){
    const critical=
      url.pathname.endsWith('/core.js')||
      url.pathname.endsWith('/assistencia.html')||
      url.pathname.endsWith('/assistencia-manifest-v4.json')||
      url.pathname.endsWith('/manifest.json');

    if(critical){
      event.respondWith((async()=>{
        const response=await networkFirst(request,CACHE_RUNTIME);
        if(response)return response;

        // core.js e manifests também podem estar no shell.
        const shell=await caches.match(request);
        return shell||Response.error();
      })());
      return;
    }

    event.respondWith(staleWhileRevalidate(request,CACHE_RUNTIME));
    return;
  }

  if(isStaticCrossOrigin(url)){
    event.respondWith(staleWhileRevalidate(request,CACHE_RUNTIME));
  }
});
