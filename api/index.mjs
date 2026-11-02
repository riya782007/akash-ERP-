export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const origin=process.env.ERP_BACKEND_ORIGIN;
 if(!origin)return res.status(503).json({error:'ERP backend is not configured. Set ERP_BACKEND_ORIGIN to your durable Node server HTTPS origin.'});
 try{
  const base=new URL(origin);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/')throw Error('Invalid backend origin');
  const route=String(req.query.route||'');if(!/^[a-zA-Z0-9_/-]+$/.test(route)||route.includes('..'))return res.status(400).json({error:'Invalid route'});
  const headers={'Content-Type':'application/json'};for(const h of ['cookie','origin','idempotency-key'])if(req.headers[h])headers[h]=req.headers[h];
  const upstream=await fetch(new URL('/api/'+route,base),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body||{}),redirect:'error',signal:AbortSignal.timeout(55000)});
  const cookie=upstream.headers.get('set-cookie');if(cookie)res.setHeader('Set-Cookie',cookie);
  res.setHeader('Content-Type','application/json; charset=utf-8');res.status(upstream.status).send(await upstream.text());
 }catch{res.status(502).json({error:'The ERP backend is unavailable. Check backend configuration and health.'});}
}
