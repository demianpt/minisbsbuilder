import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1500,height:950}});
await p.addInitScript(()=>{try{localStorage.clear()}catch(e){}});
await p.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>Boolean(window.__SBS_TEST_API),null,{timeout:25000});
const PALETTES={
  dark:{bg:'#0D0D0D',ink:'#EAEAEA',accent:'#C22B26',soft:'#1A1A1A',dark:'#212121'},
  light:{bg:'#F9F7F2',ink:'#2D2926',accent:'#C22B26',soft:'#EFEBE3',dark:'#1A1816'},
};
const ids=await p.evaluate(()=>window.__SBS_TEST_API.catalog.all().map(x=>({id:x.id,family:x.family})));
const failures=[];
for (const [pname,pal] of Object.entries(PALETTES)) {
  for (const {id,family} of ids) {
    const sid=await p.evaluate(({pid,fam,palette})=>{
      const api=window.__SBS_TEST_API;
      api.state.project.design.palette={...palette};
      api.state.project.design.paletteLocked=true;
      api.state.project.sections.length=0;
      const s=api.createSection(fam,0,pid);
      api.state.project.sections.push(s); api.paint.queue(s); return s.id;
    },{pid:id,fam:family,palette:pal});
    await p.waitForFunction((s)=>{const f=document.getElementById('sitePreview');return f&&f.contentDocument&&f.contentDocument.getElementById(s)},sid,{timeout:20000}).catch(()=>{});
    const bad=await p.locator('#sitePreview').evaluate((f,s)=>{
      const doc=f.contentDocument, band=doc.getElementById(s);
      if(!band) return [];
      // `color(srgb r g b)` gives 0..1; rgb()/rgba() give 0..255. Reading the
      // first as the second turns near-white into near-black.
      const parse=(c)=>{
        const t=String(c||''); const m=(t.match(/[\d.]+/g)||[]).map(Number);
        if(!m.length) return null;
        const scale=/^color\(/i.test(t)?255:1;
        const a=/^color\(/i.test(t)?(m[3]??1):(m[3]??1);
        return {rgb:m.slice(0,3).map(v=>v*scale), a};
      };
      const L=([r,g,bl])=>[r,g,bl].map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      const ratio=(a,c)=>{const l1=L(a),l2=L(c);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
      const ground=(node)=>{
        let el=node;
        while(el&&el!==doc.documentElement){
          const v=parse(getComputedStyle(el).backgroundColor);
          if(v&&v.a>0.55) return v.rgb;
          el=el.parentElement;
        }
        const bodyBg=parse(getComputedStyle(doc.body).backgroundColor);
        return bodyBg?bodyBg.rgb:[255,255,255];
      };
      const out=[];
      const check=(node,kind)=>{
        const text=(node.textContent||'').trim();
        if(!text) return;
        const cs=getComputedStyle(node);
        if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)<0.15) return;
        const col=parse(cs.color); if(!col) return;
        const r=ratio(col.rgb, ground(node));
        if(r<3.0) out.push({kind,sel:(node.className||'').toString().split(' ')[0]||node.tagName.toLowerCase(),ratio:+r.toFixed(2),sample:text.slice(0,32)});
      };
      // A button paints its own fill, so it is measurable even over a photograph.
      for(const node of band.querySelectorAll('.c-btn')) check(node,'button');
      // Copy: skipped only where a scrim we cannot sample sits between it and a photo.
      for(const node of band.querySelectorAll('.c-heading__title,.c-heading__pre,.c-heading__sub,.dst-list__title,.dst-list__description,.sbs-rich-text p,.dst-card__title,.sbs-quote-card p,.dst-card__desc')){
        if(node.closest('.dst-banner,.has-bg-media,.dst-card--media-background')) continue;
        check(node,'copy');
      }
      return out;
    },sid);
    for (const x of bad) failures.push({palette:pname,id,family,...x});
  }
}
const byFam={}, byKind={}, seen=new Set();
for(const f of failures){ byFam[f.family]=(byFam[f.family]||0)+1; byKind[f.kind]=(byKind[f.kind]||0)+1; seen.add(f.id); }
console.log('renders checked:', ids.length*2, '| failing patterns:', seen.size);
console.log('by kind  :', JSON.stringify(byKind));
console.log('by family:', JSON.stringify(byFam));
console.log('\nall failures:');
for(const f of failures) console.log(`  ${f.palette.padEnd(5)} ${f.id.padEnd(24)} ${f.kind.padEnd(6)} ${f.sel.padEnd(18)} ${String(f.ratio).padStart(5)}:1  "${f.sample}"`);
await b.close();
