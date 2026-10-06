// TSA OCR v2 — cible l'étiquette (jaune si présente), puis le texte destinataire grand/gras.
(function(){
  const BAD=/\b(DESTINATAIRE|EXPEDITEUR|EXPÉDITEUR|CARRIER|TRANSPORTEUR|PRIMEVER|PROVENCE|DELIVERY|SHIP TO|LIVRE A|LIVRÉ À|ADRESSE|RUE|AVENUE|ROUTE|CHEMIN|ZONE|ZI|SIRET|TVA|PALETTE|PALLET|CARTON|POIDS|WEIGHT|KG|LOT|QTEE|QTÉE|REFERENCE|REF|SSCC|GTIN|DATE|CODE FOURNISSEUR|DISTRIBUTED BY)\b/i;

  function clean(s){
    return (s||"").toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^A-Z0-9&' -]/g," ")
      .replace(/\s+/g," ").trim()
      .replace(/^\d{2,6}\s*[-:]\s*/,"")
      .replace(/\b(FRANCE|CEDEX|TEL|TELEPHONE|FAX|PORT|MOBILE)\b.*$/i,"")
      .trim();
  }

  function loadImage(file){
    return new Promise((resolve,reject)=>{
      const img=new Image(), u=URL.createObjectURL(file);
      img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};
      img.onerror=e=>{URL.revokeObjectURL(u);reject(e)};
      img.src=u;
    });
  }

  function yellowBox(img){
    const c=document.createElement("canvas");
    c.width=img.naturalWidth;c.height=img.naturalHeight;
    const x=c.getContext("2d",{willReadFrequently:true});
    x.drawImage(img,0,0);
    const d=x.getImageData(0,0,c.width,c.height).data;
    const step=Math.max(2,Math.floor(Math.max(c.width,c.height)/700));
    let minX=c.width,minY=c.height,maxX=-1,maxY=-1,n=0,total=0;
    for(let yy=0;yy<c.height;yy+=step){
      for(let xx=0;xx<c.width;xx+=step){
        const i=(yy*c.width+xx)*4, r=d[i], g=d[i+1], b=d[i+2];
        total++;
        // jaune/jaune-vert vif : assez large pour les étiquettes Primever
        if(r>135 && g>120 && b<135 && (r+g)>310 && b<Math.min(r,g)*0.78){
          n++; if(xx<minX)minX=xx;if(xx>maxX)maxX=xx;if(yy<minY)minY=yy;if(yy>maxY)maxY=yy;
        }
      }
    }
    if(n<total*.012 || maxX<=minX || maxY<=minY)return null;
    let w=maxX-minX,h=maxY-minY;
    if(w<c.width*.18 || h<c.height*.18)return null;
    const px=w*.05,py=h*.05;
    return {left:Math.max(0,minX-px),top:Math.max(0,minY-py),width:Math.min(c.width-minX+px,w+2*px),height:Math.min(c.height-minY+py,h+2*py)};
  }

  async function makeTargetCanvas(file){
    const img=await loadImage(file);
    let b=yellowBox(img);
    if(b){
      // Le destinataire est généralement dans la moitié supérieure de l'étiquette.
      b={left:b.left,top:b.top,width:b.width,height:b.height*.58};
    }else{
      // Secours : bande centrale/haute de la photo.
      b={left:img.naturalWidth*.08,top:img.naturalHeight*.15,width:img.naturalWidth*.84,height:img.naturalHeight*.52};
    }
    const scale=Math.min(3,Math.max(1.8,1800/Math.max(1,b.width)));
    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(b.width*scale));
    c.height=Math.max(1,Math.round(b.height*scale));
    const x=c.getContext("2d",{willReadFrequently:true});
    x.drawImage(img,b.left,b.top,b.width,b.height,0,0,c.width,c.height);
    const im=x.getImageData(0,0,c.width,c.height),p=im.data;
    for(let i=0;i<p.length;i+=4){
      const g=.299*p[i]+.587*p[i+1]+.114*p[i+2];
      // contraste doux, plus robuste aux étiquettes jaunes et ombres
      let v=(g-128)*1.65+128; v=Math.max(0,Math.min(255,v));
      p[i]=p[i+1]=p[i+2]=v;
    }
    x.putImageData(im,0,0);
    return c;
  }

  function linesFromBlocks(blocks){
    const out=[];
    (blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>{
      const bb=l.bbox||{}, text=clean(l.text);
      if(!text || text.length<2 || BAD.test(text) || /^\d+$/.test(text) || /\d{5}/.test(text))return;
      out.push({text,left:bb.x0||0,top:bb.y0||0,width:(bb.x1||0)-(bb.x0||0),height:(bb.y1||0)-(bb.y0||0),conf:l.confidence||0});
    })));
    return out;
  }

  function choose(lines,w,h){
    if(!lines.length)return"";
    const maxH=Math.max(...lines.map(x=>x.height||1));
    lines.forEach(x=>{
      const cx=(x.left+x.width/2)/Math.max(1,w);
      const cy=(x.top+x.height/2)/Math.max(1,h);
      const centerX=Math.max(0,1-Math.abs(cx-.5)/.5);
      const upperTarget=Math.max(0,1-Math.abs(cy-.33)/.5);
      const size=(x.height||1)/maxH;
      const conf=Math.max(0,Math.min(1,(x.conf||0)/100));
      const letters=(x.text.match(/[A-Z]/g)||[]).length/Math.max(1,x.text.length);
      x.score=size*.48+centerX*.16+upperTarget*.22+conf*.09+letters*.05;
    });
    lines.sort((a,b)=>b.score-a.score);
    const best=lines[0];
    if(!best)return"";
    // Récupère les 1 à 3 lignes de même taille juste autour (noms qui passent sur 2/3 lignes).
    const near=lines.filter(x=>{
      const similar=(x.height||1)>=Math.max(10,(best.height||1)*.62);
      const dy=Math.abs((x.top+x.height/2)-(best.top+best.height/2));
      const sameArea=dy<=Math.max(best.height*2.8,90);
      const cx=(x.left+x.width/2)/Math.max(1,w);
      return similar && sameArea && cx>.12 && cx<.88 && !BAD.test(x.text);
    }).sort((a,b)=>a.top-b.top).slice(0,3);
    const picked=(near.length?near:[best]).map(x=>clean(x.text)).filter(Boolean);
    // dédoublonnage et limitation pour éviter le bruit
    const uniq=[]; picked.forEach(s=>{if(!uniq.includes(s))uniq.push(s)});
    let out=uniq.join(" ").replace(/\s+/g," ").trim();
    if(out.length>55)out=clean(best.text);
    return out;
  }

  runOCR = async function(file){
    enableDest("");
    if(typeof Tesseract==="undefined"){
      $("ocrStatus").textContent="Lecture indisponible : saisis la ville ou le client.";
      return;
    }
    $("retryOCR").disabled=true;
    $("bar").style.width="5%";
    $("ocrStatus").textContent="Lecture ciblée du destinataire…";
    let worker=null;
    try{
      const canvas=await makeTargetCanvas(file);
      worker=await Tesseract.createWorker("fra", undefined, {logger:m=>{
        if(m.status==="recognizing text"){
          const p=Math.round((m.progress||0)*100);
          $("bar").style.width=p+"%";
          $("ocrStatus").textContent="Lecture ciblée : "+p+" %";
        }
      }});
      await worker.setParameters({
        tessedit_pageseg_mode:Tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces:"1",
        user_defined_dpi:"300"
      });
      const res=await worker.recognize(canvas,{}, {text:true,blocks:true,tsv:true});
      let lines=linesFromBlocks(res.data&&res.data.blocks);
      let d=choose(lines,canvas.width,canvas.height);
      if(!d){
        const raw=(res.data&&res.data.text)||"";
        const candidates=raw.split(/\r?\n/).map(clean).filter(s=>s.length>=3 && !BAD.test(s) && !/\d{5}/.test(s));
        d=candidates.sort((a,b)=>b.length-a.length)[0]||"";
      }
      $("destination").value=d;
      $("bar").style.width="100%";
      $("ocrStatus").textContent=d?"Ville/client détecté. Vérifie puis valide.":"Aucun nom net détecté. Saisis la ville ou le client.";
    }catch(e){
      $("destination").value="";
      $("ocrStatus").textContent="Lecture automatique impossible. Saisis la ville ou le client.";
    }finally{
      if(worker)try{await worker.terminate()}catch(e){}
      $("retryOCR").disabled=false;
      saveDraft();
    }
  };
})();