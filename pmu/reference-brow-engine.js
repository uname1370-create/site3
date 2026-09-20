/**
 * ASAL RAJABI PMU — Reference Brow Engine v1
 * Real-reference brow compositing prototype.
 *
 * Instead of generating a generic eyebrow shape, this engine:
 * 1) loads a real reference face (m2.png / m3.png)
 * 2) extracts the reference eyebrow from its face landmarks
 * 3) builds an alpha matte from the real brow pixels
 * 4) piecewise-affine warps that texture to the user's brow geometry
 * 5) applies a conservative local neutralization pass to the old brow
 * 6) blends with multiply/soft-light so the user's skin remains visible
 *
 * This is deterministic image editing; it does not regenerate the face.
 */

const LEFT_BROW = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_BROW = [300,293,334,296,336,285,295,282,283,276];

const cache = new Map();

const clamp = (v,a=0,b=1) => Math.max(a, Math.min(b,v));
const lerp = (a,b,t) => a + (b-a)*t;
const pt = (a,b,t) => ({x:lerp(a.x,b.x,t), y:lerp(a.y,b.y,t)});
const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);

function cat(p,t){
  if(p.length < 2) return p[0] || {x:0,y:0};
  const n=p.length-1;
  const f=clamp(t)*n;
  const i=Math.min(n-1,Math.floor(f));
  const u=f-i;
  const p0=p[Math.max(0,i-1)], p1=p[i], p2=p[i+1], p3=p[Math.min(n,i+2)];
  const u2=u*u,u3=u2*u;
  return {
    x:.5*((2*p1.x)+(-p0.x+p2.x)*u+(2*p0.x-5*p1.x+4*p2.x-p3.x)*u2+(-p0.x+3*p1.x-3*p2.x+p3.x)*u3),
    y:.5*((2*p1.y)+(-p0.y+p2.y)*u+(2*p0.y-5*p1.y+4*p2.y-p3.y)*u2+(-p0.y+3*p1.y-3*p2.y+p3.y)*u3)
  };
}

function boxOf(lm,ids){
  let minX=1,minY=1,maxX=0,maxY=0;
  for(const i of ids){
    const p=lm[i];
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
  }
  return {minX,minY,maxX,maxY,bw:maxX-minX,bh:maxY-minY};
}

function browPolygon(lm,ids,w,h){
  const b=boxOf(lm,ids);
  const padX=b.bw*.08,padY=b.bh*.28;
  const x=Math.max(0,(b.minX-padX)*w);
  const y=Math.max(0,(b.minY-padY)*h);
  const x2=Math.min(w,(b.maxX+padX)*w);
  const y2=Math.min(h,(b.maxY+padY)*h);
  return {x,y,w:Math.max(1,x2-x),h:Math.max(1,y2-y)};
}

function targetGeometry(lm,ids,w,h,crop){
  const p=ids.map(i=>({
    x:((lm[i].x-crop.x)/crop.w)*w,
    y:((lm[i].y-crop.y)/crop.h)*h
  }));
  const inner=pt(p[4],p[5],.5);
  const outer=pt(p[0],p[9],.5);
  const axisX=outer.x-inner.x,axisY=outer.y-inner.y;
  const len=Math.hypot(axisX,axisY)||1;
  const nx=-axisY/len,ny=axisX/len;

  const upBase=p.slice(4,-1).reverse();
  const loBase=p.slice(5);
  const upper=[],lower=[];
  for(let i=0;i<=32;i++){
    const u=i/32;
    upper.push(cat(upBase,u));
    lower.push(cat(loBase,u));
  }

  const rows=[[],[],[],[],[]];
  for(let i=0;i<=32;i++){
    const u=i/32;
    const up=upper[i],lo=lower[i];
    const center=pt(lo,up,.5);
    const height=Math.max(5,dist(up,lo));
    const half=Math.max(4,height*.52);
    const arch=Math.sin(Math.PI*u)*len*.035;
    rows[0].push({x:center.x-nx*half,y:center.y-ny*half-arch});
    rows[1].push({x:center.x-nx*half*.52,y:center.y-ny*half*.52-arch*.7});
    rows[2].push(center);
    rows[3].push({x:center.x+nx*half*.52,y:center.y+ny*half*.52-arch*.15});
    rows[4].push({x:center.x+nx*half,y:center.y+ny*half-arch*.05});
  }
  return {rows,upper,lower,inner,outer,len};
}

function sourceGeometry(referenceLm,ids){
  const p=ids.map(i=>({x:referenceLm[i].x,y:referenceLm[i].y}));
  const inner=pt(p[4],p[5],.5);
  const outer=pt(p[0],p[9],.5);
  return {inner,outer};
}

function affine(s0,s1,s2,d0,d1,d2){
  const det=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
  if(Math.abs(det)<1e-7) return null;
  const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/det;
  const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/det;
  const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/det;
  const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/det;
  const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/det;
  const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/det;
  return {a,b,c,d,e,f};
}

function drawTriangle(ctx,img,s0,s1,s2,d0,d1,d2){
  const m=affine(s0,s1,s2,d0,d1,d2);
  if(!m) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x,d0.y);
  ctx.lineTo(d1.x,d1.y);
  ctx.lineTo(d2.x,d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
  ctx.drawImage(img,0,0);
  ctx.restore();
}

function buildReferenceTexture(img,lm,ids){
  const b=boxOf(lm,ids);
  const padX=b.bw*.22,padY=b.bh*.55;
  const sx=Math.max(0,(b.minX-padX)*img.naturalWidth);
  const sy=Math.max(0,(b.minY-padY)*img.naturalHeight);
  const sw=Math.min(img.naturalWidth-sx,Math.max(4,(b.bw+padX*2)*img.naturalWidth));
  const sh=Math.min(img.naturalHeight-sy,Math.max(4,(b.bh+padY*2)*img.naturalHeight));

  const c=document.createElement("canvas");
  c.width=Math.max(64,Math.round(sw));
  c.height=Math.max(48,Math.round(sh));
  const ctx=c.getContext("2d");
  ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);

  const data=ctx.getImageData(0,0,c.width,c.height);
  const px=data.data;

  // Build a soft alpha matte from the real dark eyebrow pixels.
  // The landmark polygon is used as a spatial prior; local contrast keeps
  // surrounding skin mostly transparent.
  const mask=document.createElement("canvas");
  mask.width=c.width; mask.height=c.height;
  const mc=mask.getContext("2d");
  const poly=ids.map(i=>({
    x:((lm[i].x-(b.minX-padX))/Math.max(.0001,b.bw+padX*2))*c.width,
    y:((lm[i].y-(b.minY-padY))/Math.max(.0001,b.bh+padY*2))*c.height
  }));
  mc.beginPath();
  mc.moveTo(poly[0].x,poly[0].y);
  for(let i=1;i<poly.length;i++) mc.lineTo(poly[i].x,poly[i].y);
  mc.closePath();
  mc.fillStyle="#fff";
  mc.filter="blur("+Math.max(1,c.height*.035)+"px)";
  mc.fill();
  mc.filter="none";
  const md=mc.getImageData(0,0,c.width,c.height).data;

  let mean=0,count=0;
  for(let i=0;i<px.length;i+=4){
    const g=.299*px[i]+.587*px[i+1]+.114*px[i+2];
    mean+=g; count++;
  }
  mean/=Math.max(1,count);
  for(let i=0;i<px.length;i+=4){
    const g=.299*px[i]+.587*px[i+1]+.114*px[i+2];
    const contrast=clamp((mean-g-4)/46);
    const alpha=Math.round(255*contrast*(md[i+3]/255));
    px[i+3]=alpha;
  }
  ctx.putImageData(data,0,0);
  return {canvas:c,inner:innerNorm(poly),sourceSize:{w:c.width,h:c.height}};
}

function innerNorm(poly){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of poly){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  return {minX,minY,maxX,maxY};
}

function warpReference(ctx,texture,target,alpha,flip){
  const img=texture.canvas;
  const cols=20, rows=8;
  const sw=img.width, sh=img.height;

  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.globalCompositeOperation="multiply";

  const source=(u,v)=>({
    x:(flip?(1-u):u)*sw,
    y:v*sh
  });
  const targetPoint=(u,v)=>{
    const f=v*4;
    const r=Math.min(3,Math.floor(f));
    const t=f-r;
    const col=Math.min(cols,Math.round(u*32));
    return pt(target.rows[r][col],target.rows[r+1][col],t);
  };

  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const u0=c/cols,u1=(c+1)/cols,v0=r/rows,v1=(r+1)/rows;
      const s00=source(u0,v0),s10=source(u1,v0),s01=source(u0,v1),s11=source(u1,v1);
      const d00=targetPoint(u0,v0),d10=targetPoint(u1,v0),d01=targetPoint(u0,v1),d11=targetPoint(u1,v1);
      drawTriangle(ctx,img,s00,s10,s11,d00,d10,d11);
      drawTriangle(ctx,img,s00,s11,s01,d00,d11,d01);
    }
  }
  ctx.restore();
}

function applyBrowMask(layer,target,w,h){
  const mask=document.createElement("canvas");
  mask.width=Math.ceil(w);mask.height=Math.ceil(h);
  const mc=mask.getContext("2d");
  const ring=[...target.upper,...target.lower.slice().reverse()];
  mc.save();
  mc.filter="blur("+Math.max(1,target.len*.012)+"px)";
  mc.beginPath();
  mc.moveTo(ring[0].x,ring[0].y);
  for(let i=1;i<ring.length;i++) mc.lineTo(ring[i].x,ring[i].y);
  mc.closePath();
  mc.fillStyle="rgba(255,255,255,.96)";
  mc.fill();
  mc.restore();

  layer.save();
  layer.globalCompositeOperation="destination-in";
  layer.drawImage(mask,0,0,w,h);
  layer.restore();
}

function softenOldBrow(main,target,w,h){
  // Conservative fallback until a real inpainting model is added.
  // It reduces the old brow but does not claim pixel-perfect skin repair.
  const wash=document.createElement("canvas");
  wash.width=Math.ceil(w);wash.height=Math.ceil(h);
  const wc=wash.getContext("2d");
  wc.drawImage(main.canvas,0,0,w,h);

  const donorY=Math.max(0,target.rows[0][16].y-target.len*.16);
  const sx=Math.max(0,target.inner.x-target.len*.12);
  const sy=Math.max(0,donorY-target.len*.16);
  const sw=Math.max(1,target.len*1.24);
  const sh=Math.max(1,target.len*.20);

  const ring=[...target.upper,...target.lower.slice().reverse()];
  wc.save();
  wc.beginPath();
  wc.moveTo(ring[0].x,ring[0].y);
  for(let i=1;i<ring.length;i++) wc.lineTo(ring[i].x,ring[i].y);
  wc.closePath();
  wc.clip();
  wc.filter="blur("+Math.max(1.2,target.len*.015)+"px)";
  wc.globalAlpha=.82;
  wc.drawImage(main.canvas,sx,sy,sw,sh,sx,target.rows[0][0].y,sw,Math.max(1,target.len*.55));
  wc.restore();

  main.save();
  main.globalAlpha=.42;
  main.globalCompositeOperation="source-over";
  main.drawImage(wash,0,0,w,h);
  main.restore();
}

async function loadReference(src,detect){
  if(cache.has(src)) return cache.get(src);
  const promise=(async()=>{
    const img=await new Promise((resolve,reject)=>{
      const i=new Image();
      i.onload=()=>resolve(i);
      i.onerror=reject;
      i.src=src;
    });
    const result=detect(img);
    const lm=result && result.faceLandmarks ? result.faceLandmarks[0] : null;
    if(!lm) throw new Error("Reference face not detected: "+src);
    return {
      image:img,
      left:buildReferenceTexture(img,lm,LEFT_BROW),
      right:buildReferenceTexture(img,lm,RIGHT_BROW)
    };
  })();
  cache.set(src,promise);
  return promise;
}

export async function drawMicroblading(main,lm,w,h,style,crop,shade=.55,detectReference){
  if(!lm || lm.length<400) return;
  if(typeof detectReference!=="function") return;

  const src=style?.referenceSrc || "m2.png";
  const ref=await loadReference(src,detectReference);
  const strength=clamp(Number(shade),0,1);

  const pairs=[
    [LEFT_BROW,ref.left,false],
    [RIGHT_BROW,ref.right,true]
  ];

  for(const [ids,texture,flip] of pairs){
    const target=targetGeometry(lm,ids,w,h,crop);

    softenOldBrow(main,target,w,h);

    const layer=document.createElement("canvas");
    layer.width=Math.ceil(w);
    layer.height=Math.ceil(h);
    const lctx=layer.getContext("2d");

    warpReference(lctx,texture,target,.72+strength*.18,flip);
    applyBrowMask(layer,target,w,h);

    main.save();
    main.globalCompositeOperation="multiply";
    main.globalAlpha=.88;
    main.drawImage(layer,0,0,w,h);
    main.restore();

    main.save();
    main.globalCompositeOperation="soft-light";
    main.globalAlpha=.07+strength*.07;
    main.drawImage(layer,0,0,w,h);
    main.restore();
  }
}

export function clearReferenceCache(){
  cache.clear();
}
