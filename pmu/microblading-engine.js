/** ASAL RAJABI PMU — Microblading Reference Engine v2 */
const LEFT_BROW=[70,63,105,66,107,55,65,52,53,46];
const RIGHT_BROW=[300,293,334,296,336,285,295,282,283,276];

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const pl=(a,b,t)=>({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t)});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function cat(p,t){
  if(p.length<2)return p[0]||{x:0,y:0};
  const n=p.length-1,f=clamp(t)*n,i=Math.min(n-1,Math.floor(f)),u=f-i;
  const p0=p[Math.max(0,i-1)],p1=p[i],p2=p[i+1],p3=p[Math.min(p.length-1,i+2)];
  const u2=u*u,u3=u2*u;
  return {
    x:.5*((2*p1.x)+(-p0.x+p2.x)*u+(2*p0.x-5*p1.x+4*p2.x-p3.x)*u2+(-p0.x+3*p1.x-3*p2.x+p3.x)*u3),
    y:.5*((2*p1.y)+(-p0.y+p2.y)*u+(2*p0.y-5*p1.y+4*p2.y-p3.y)*u2+(-p0.y+3*p1.y-3*p2.y+p3.y)*u3)
  };
}
function dense(p,n=32){const o=[];for(let i=0;i<=n;i++)o.push(cat(p,i/n));return o;}
function mapLm(lm,i,w,h,c){const p=lm[i];return{x:((p.x-c.x)/c.w)*w,y:((p.y-c.y)/c.h)*h};}

function geometry(lm,ids,w,h,c){
  const p=ids.map(i=>mapLm(lm,i,w,h,c));
  const inner=pl(p[4],p[5],.5),outer=pl(p[0],p[9],.5);
  const dx=outer.x-inner.x,dy=outer.y-inner.y,len=Math.hypot(dx,dy)||1;
  const nx=-dy/len,ny=dx/len;
  return {inner,outer,upper:dense(p.slice(4,-1).reverse()),lower:dense(p.slice(5)),length:len,nx,ny};
}
function normalizedCrop(lm,ids,padX=.18,padY=.65){
  let minX=1,minY=1,maxX=0,maxY=0;
  for(const i of ids){const p=lm[i];minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  const bw=maxX-minX,bh=maxY-minY,x=Math.max(0,minX-bw*padX),y=Math.max(0,minY-bh*padY);
  const x2=Math.min(1,maxX+bw*padX),y2=Math.min(1,maxY+bh*padY);
  return {x,y,w:Math.max(.02,x2-x),h:Math.max(.02,y2-y)};
}
function sourcePoint(u,v,sw,sh){return{x:u*sw,y:v*sh};}
function refPoint(lm,i,crop,w,h){const p=lm[i];return{x:((p.x-crop.x)/crop.w)*w,y:((p.y-crop.y)/crop.h)*h};}
function referenceBrowMask(refLm,ids,crop,w,h){
  const p=ids.map(i=>refPoint(refLm,i,crop,w,h));
  const ring=[...p.slice(4,-1).reverse(),...p.slice(5)];
  return ring;
}
function extractReferenceBrow(refImage,refLm,ids,crop){
  const sw=refImage.naturalWidth||refImage.width,sh=refImage.naturalHeight||refImage.height;
  const sx0=Math.max(0,Math.floor(crop.x*sw)),sy0=Math.max(0,Math.floor(crop.y*sh));
  const swc=Math.max(2,Math.min(sw-sx0,Math.ceil(crop.w*sw))),shc=Math.max(2,Math.min(sh-sy0,Math.ceil(crop.h*sh)));
  const source=document.createElement("canvas");source.width=swc;source.height=shc;
  const ctx=source.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(refImage,sx0,sy0,swc,shc,0,0,swc,shc);
  const image=ctx.getImageData(0,0,swc,shc),data=image.data,lums=[];
  for(let i=0;i<data.length;i+=4){
    const a=data[i+3];
    if(a>20)lums.push(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);
  }
  lums.sort((a,b)=>a-b);
  const baseline=lums[Math.floor(lums.length*.68)]||150;
  const ring=referenceBrowMask(refLm,ids,{x:sx0/sw,y:sy0/sh,w:swc/sw,h:shc/sh},swc,shc);
  const poly=(x,y)=>{
    let inside=false;
    for(let i=0,j=poly.points.length-1;i<poly.points.length;j=i++){
      const xi=poly.points[i].x,yi=poly.points[i].y,xj=poly.points[j].x,yj=poly.points[j].y;
      const hit=((yi>y)!==(yj>y))&&(x<((xj-xi)*(y-yi))/(yj-yi||1e-9)+xi);
      if(hit)inside=!inside;
    }
    return inside;
  };
  poly.points=ring;
  for(let y=0;y<shc;y++)for(let x=0;x<swc;x++){
    const i=(y*swc+x)*4;
    if(!poly(x+.5,y+.5)){data[i+3]=0;continue;}
    const lum=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
    const contrast=baseline-lum;
    const alpha=clamp((contrast-7)/52)*.98;
    data[i+3]=Math.round(data[i+3]*alpha);
  }
  ctx.putImageData(image,0,0);
  return source;
}
function destinationPoint(g,u,v){
  const n=32,x=clamp(u)*n,ix=Math.min(n-1,Math.floor(x)),tx=x-ix;
  const y=clamp(v)*4,iy=Math.min(3,Math.floor(y)),ty=y-iy;
  return pl(pl(g.rows[iy][ix],g.rows[iy][ix+1],tx),pl(g.rows[iy+1][ix],g.rows[iy+1][ix+1],tx),ty);
}
function buildRows(g){
  const rows=[[],[],[],[],[]];
  for(let i=0;i<=32;i++){
    const u=i/32,up=g.upper[i],lo=g.lower[i],c=pl(lo,up,.5),half=Math.max(3,g.length*.10,dist(up,lo)*.48),lift=Math.sin(Math.PI*u)*g.length*.055;
    rows[0].push({x:c.x-g.nx*half,y:c.y-g.ny*half-lift});
    rows[1].push({x:c.x-g.nx*half*.52,y:c.y-g.ny*half*.52-lift*.7});
    rows[2].push(c);
    rows[3].push({x:c.x+g.nx*half*.52,y:c.y+g.ny*half*.52-lift*.15});
    rows[4].push({x:c.x+g.nx*half,y:c.y+g.ny*half-lift*.05});
  }
  g.rows=rows;return g;
}
function affine(s0,s1,s2,d0,d1,d2){
  const det=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
  if(Math.abs(det)<1e-6)return null;
  const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/det;
  const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/det;
  const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/det;
  const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/det;
  const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/det;
  const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/det;
  return {a,b,c,d,e,f};
}
function tri(ctx,img,s0,s1,s2,d0,d1,d2){
  const m=affine(s0,s1,s2,d0,d1,d2);if(!m)return;
  ctx.save();ctx.beginPath();ctx.moveTo(d0.x,d0.y);ctx.lineTo(d1.x,d1.y);ctx.lineTo(d2.x,d2.y);ctx.closePath();ctx.clip();
  ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);ctx.drawImage(img,0,0);ctx.restore();
}
function warpReference(ctx,img,sourceCrop,g,alpha,refLm,ids){
  const cols=32,rows=8;
  const source=extractReferenceBrow(img,refLm,ids,sourceCrop);
  ctx.save();ctx.globalAlpha=alpha;ctx.globalCompositeOperation="source-over";
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const u0=c/cols,u1=(c+1)/cols,v0=r/rows,v1=(r+1)/rows;
    const s00=sourcePoint(u0,v0,source.width,source.height),s10=sourcePoint(u1,v0,source.width,source.height),s01=sourcePoint(u0,v1,source.width,source.height),s11=sourcePoint(u1,v1,source.width,source.height);
    const d00=destinationPoint(g,u0,v0),d10=destinationPoint(g,u1,v0),d01=destinationPoint(g,u0,v1),d11=destinationPoint(g,u1,v1);
    tri(ctx,source,s00,s10,s11,d00,d10,d11);tri(ctx,source,s00,s11,s01,d00,d11,d01);
  }
  ctx.restore();
}
function maskFor(g,w,h){
  const mask=document.createElement("canvas");mask.width=Math.ceil(w);mask.height=Math.ceil(h);
  const mc=mask.getContext("2d"),ring=[...g.upper,...g.lower.slice().reverse()];
  mc.save();mc.filter="blur("+Math.max(1.1,Math.min(2.6,g.length*.015))+"px)";
  mc.beginPath();mc.moveTo(ring[0].x,ring[0].y);for(let i=1;i<ring.length;i++)mc.lineTo(ring[i].x,ring[i].y);
  mc.closePath();mc.fillStyle="rgba(255,255,255,.96)";mc.fill();mc.restore();return mask;
}
function reduceOldBrow(main,g,w,h){
  const layer=document.createElement("canvas");layer.width=Math.ceil(w);layer.height=Math.ceil(h);
  const l=layer.getContext("2d"),ring=[...g.upper,...g.lower.slice().reverse()];l.drawImage(main.canvas,0,0,w,h);
  l.save();l.beginPath();l.moveTo(ring[0].x,ring[0].y);for(let i=1;i<ring.length;i++)l.lineTo(ring[i].x,ring[i].y);l.closePath();l.clip();
  l.filter="blur("+Math.max(1.2,g.length*.016)+"px)";l.globalAlpha=.30;
  const donorW=Math.max(2,g.length*.70),donorH=Math.max(2,g.length*.12);
  l.drawImage(main.canvas,Math.max(0,g.inner.x-donorW*.35),Math.max(0,g.inner.y-g.length*.16),donorW,donorH,Math.max(0,g.inner.x-donorW*.35),Math.max(0,g.inner.y-g.length*.03),donorW,donorH*2.4);
  l.restore();main.save();main.globalAlpha=.34;main.drawImage(layer,0,0,w,h);main.restore();
}
export function drawMicroblading(main,lm,w,h,style,crop,shade=.55,seed=1,referenceImage=null,referenceLandmarks=null){
  if(!lm||lm.length<400)return;
  if(style?.kind!=="hairstroke"&&style?.kind!=="phibrows")return;
  if(!referenceImage||!referenceLandmarks||referenceLandmarks.length<400)return;
  const strength=clamp(Number(shade)),refCropL=normalizedCrop(referenceLandmarks,LEFT_BROW,.24,.45),refCropR=normalizedCrop(referenceLandmarks,RIGHT_BROW,.24,.45);
  for(const [ids,refCrop] of [[LEFT_BROW,refCropL],[RIGHT_BROW,refCropR]]){
    const userG=buildRows(geometry(lm,ids,w,h,crop));reduceOldBrow(main,userG,w,h);
    const layer=document.createElement("canvas");layer.width=Math.ceil(w);layer.height=Math.ceil(h);
    const l=layer.getContext("2d");warpReference(l,referenceImage,refCrop,userG,.78+strength*.12,referenceLandmarks,ids);
    const mask=maskFor(userG,w,h);l.save();l.globalCompositeOperation="destination-in";l.drawImage(mask,0,0,w,h);l.restore();
    main.save();main.globalCompositeOperation="multiply";main.globalAlpha=.72;main.drawImage(layer,0,0,w,h);main.restore();
    main.save();main.globalCompositeOperation="soft-light";main.globalAlpha=.08+strength*.05;main.drawImage(layer,0,0,w,h);main.restore();
  }
}
