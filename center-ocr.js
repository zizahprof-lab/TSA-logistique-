// TSA OCR v2 — cible l'étiquette (jaune si présente), puis le texte destinataire grand/gras.
(function(){
  const BAD=/\b(DESTINATAIRE|EXPEDITEUR|EXPÉDITEUR|CARRIER|TRANSPORTEUR|PRIMEVER|PROVENCE|DELIVERY|SHIP TO|LIVRE A|LIVRÉ À|ADRESSE|RUE|AVENUE|ROUTE|CHEMIN|ZONE|ZI|SIRET|TVA|PALETTE|PALLET|CARTON|POIDS|WEIGHT|KG|LOT|QTEE|QTÉE|REFERENCE|REF|SSCC|GTIN|DATE|CODE FOURNISSEUR|DISTRIBUTED BY)\b/i;

  function isBarcodeLike(text, box){
    const raw=(text||"").toUpperCase().trim();
    if(!raw)return false;
    const compact=raw.replace(/\s+/g,"");
    const digits=(raw.match(/\d/g)||[]).length;
    const letters=(raw.match(/[A-Z]/g)||[]).length;
    // Codes-barres/SSCC/GTIN : suites numériques longues ou chaînes alphanumériques compactes.
    if(/\d{5,}/.test(raw))return true;
    if(digits>=6)return true;
    if(compact.length>=10 && !/\s/.test(raw) && digits>=2)return true;
    if(compact.length>=12 && digits>=3)return true;
    if((digits/Math.max(1,digits+letters))>.38 && digits>=4)return true;
    if(/[|¦]{2,}/.test(raw))return true;
    if(box){
      const h=Math.max(1,(box.y1||0)-(box.y0||0));
      const w=Math.max(1,(box.x1||0)-(box.x0||0));
      // OCR d'un code-barres = bande très large et basse, souvent peu fiable.
      if(w/h>14 && (box.confidence||0)<65 && digits>=2)return true;
    }
    return false;
  }

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
    let b;
    if((file.name||"").startsWith("tsa-zone-client-")){
      // Le rectangle caméra reste large pour le chauffeur, mais l'OCR ne lit que sa bande centrale.
      // Cela élimine les codes-barres et petits textes périphériques en haut/bas.
      b={
        left:img.naturalWidth*.04,
        top:img.naturalHeight*.20,
        width:img.naturalWidth*.92,
        height:img.naturalHeight*.60
      };
    }else{
      b=yellowBox(img);
      if(b){
        // Photo importée : cible la zone destinataire de l'étiquette.
        b={left:b.left,top:b.top,width:b.width,height:b.height*.58};
      }else{
        // Secours pour une photo importée sans étiquette jaune détectable.
        b={left:img.naturalWidth*.08,top:img.naturalHeight*.15,width:img.naturalWidth*.84,height:img.naturalHeight*.52};
      }
    }
    const scale=Math.min(3,Math.max(1.8,1800/Math.max(1,b.width)));
    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(b.width*scale));
    c.height=Math.max(1,Math.round(b.height*scale));
    const x=c.getContext("2d",{willReadFrequently:true});
    x.drawImage(img,b.left,b.top,b.width,b.height,0,0,c.width,c.height);
    const guided=(file.name||"").startsWith("tsa-zone-client-");
    const im=x.getImageData(0,0,c.width,c.height),p=im.data;
    for(let i=0;i<p.length;i+=4){
      const g=.299*p[i]+.587*p[i+1]+.114*p[i+2];
      // Scanner guidé : gris naturel pour ne pas déformer les lettres hautes/étroites.
      // Photo importée : contraste un peu renforcé.
      let v=guided?g:((g-128)*1.45+128);
      v=Math.max(0,Math.min(255,v));
      p[i]=p[i+1]=p[i+2]=v;
    }
    x.putImageData(im,0,0);
    return c;
  }

  function linesFromBlocks(blocks){
    const out=[];
    (blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>{
      const bb=l.bbox||{}, raw=l.text||"", text=clean(raw);
      const barcodeBox={x0:bb.x0||0,y0:bb.y0||0,x1:bb.x1||0,y1:bb.y1||0,confidence:l.confidence||0};
      if(!text || text.length<2 || BAD.test(text) || /^\d+$/.test(text) || isBarcodeLike(raw,barcodeBox))return;
      out.push({text,left:bb.x0||0,top:bb.y0||0,width:(bb.x1||0)-(bb.x0||0),height:(bb.y1||0)-(bb.y0||0),conf:l.confidence||0});
    })));
    return out;
  }

  function plausibleLabel(text){
    const t=clean(text);
    if(!t || /\d/.test(t))return false; // aucun chiffre accepté
    const words=t.split(/\s+/).filter(Boolean);
    if(!words.length || words.length>4)return false;
    if(words.some(w=>w.length===1))return false;
    if(t.length<3 || t.length>38)return false;

    const letters=(t.match(/[A-Z]/g)||[]).length;
    const vowels=(t.match(/[AEIOUY]/g)||[]).length;
    const vr=vowels/Math.max(1,letters);
    if(vr<.14 || vr>.72)return false;

    // Rejette les suites typiques générées par les traits de codes-barres.
    if(/[BCDFGHJKLMNPQRSTVWXZ]{7,}/.test(t.replace(/\s/g,"")))return false;
    if(/([ILMNRT])\1{2,}/.test(t))return false;
    return true;
  }

  function choose(lines,w,h){
    if(!lines.length)return"";

    // On ne garde que des lignes alphabétiques plausibles : pas de chiffres, pas de code-barres,
    // pas de concaténation. Une seule ligne gagnante sera renvoyée.
    lines=lines.filter(x=>{
      if(!plausibleLabel(x.text))return false;
      if((x.conf||0)<38)return false;
      const cx=(x.left+x.width/2)/Math.max(1,w);
      const cy=(x.top+x.height/2)/Math.max(1,h);
      return cx>.12 && cx<.88 && cy>.12 && cy<.88;
    });
    if(!lines.length)return"";

    const maxH=Math.max(...lines.map(x=>x.height||1));
    lines.forEach(x=>{
      const cx=(x.left+x.width/2)/Math.max(1,w);
      const cy=(x.top+x.height/2)/Math.max(1,h);
      const dx=Math.abs(cx-.5), dy=Math.abs(cy-.5);
      const center=Math.max(0,1-Math.sqrt(dx*dx+dy*dy)/.62);
      const size=(x.height||1)/maxH;
      const conf=Math.max(0,Math.min(1,(x.conf||0)/100));
      const len=x.text.length;
      const lengthScore = len>=4 && len<=24 ? 1 : (len<=34 ? .65 : .3);

      // Priorité : grosse police + bonne confiance OCR + proximité du centre.
      x.score=size*.50 + conf*.28 + center*.17 + lengthScore*.05;
    });

    lines.sort((a,b)=>b.score-a.score);
    return clean(lines[0].text); // UNE SEULE LIGNE, rien d'autre
  }

  function makeOCRVariants(base){
    const vars=[base];

    // Variante étirée horizontalement : les polices très hautes et étroites
    // (ex. LOGIDIS MACON, LIDL LES ARCS) sont beaucoup mieux reconnues ainsi.
    for(const factor of [1.35,1.65]){
      const st=document.createElement("canvas");
      st.width=Math.round(base.width*factor);st.height=base.height;
      const sx=st.getContext("2d");
      sx.imageSmoothingEnabled=true;
      sx.drawImage(base,0,0,st.width,st.height);
      vars.push(st);
    }
    // Variante noir/blanc : très utile sur les grandes lettres imprimées et condensées.
    const b=document.createElement("canvas");
    b.width=base.width;b.height=base.height;
    const bx=b.getContext("2d",{willReadFrequently:true});
    bx.drawImage(base,0,0);
    const im=bx.getImageData(0,0,b.width,b.height),p=im.data;
    let sum=0,n=0;
    for(let i=0;i<p.length;i+=16){sum+=p[i];n++}
    const mean=sum/Math.max(1,n);
    const th=Math.max(105,Math.min(190,mean*.90));
    for(let i=0;i<p.length;i+=4){
      const v=p[i]<th?0:255;
      p[i]=p[i+1]=p[i+2]=v;
    }
    bx.putImageData(im,0,0);vars.push(b);

    // Variante contraste modéré.
    const c=document.createElement("canvas");
    c.width=base.width;c.height=base.height;
    const cx=c.getContext("2d",{willReadFrequently:true});
    cx.drawImage(base,0,0);
    const im2=cx.getImageData(0,0,c.width,c.height),q=im2.data;
    for(let i=0;i<q.length;i+=4){
      let v=(q[i]-128)*1.35+128;v=Math.max(0,Math.min(255,v));
      q[i]=q[i+1]=q[i+2]=v;
    }
    cx.putImageData(im2,0,0);vars.push(c);
    return vars;
  }

  function scoreOCRCandidate(text,conf){
    const t=clean(text);
    if(!plausibleLabel(t)||isBarcodeLike(t))return -1;
    const letters=(t.match(/[A-Z]/g)||[]).length;
    const words=t.split(/\s+/).filter(Boolean).length;
    const lengthScore=(t.length>=5&&t.length<=28)?1:.65;
    const wordScore=(words>=1&&words<=4)?1:.5;
    return Math.max(0,Math.min(1,(conf||0)/100))*.72 + lengthScore*.18 + wordScore*.10 + Math.min(.03,letters/500);
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
      const guided=(file.name||"").startsWith("tsa-zone-client-");
      await worker.setParameters({
        tessedit_pageseg_mode:guided?Tesseract.PSM.SINGLE_LINE:Tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces:"1",
        user_defined_dpi:"300",
        tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ '-&"
      });
      let d="";
      if(guided){
        const variants=makeOCRVariants(canvas);
        let best={text:"",score:-1};
        const modes=[Tesseract.PSM.SINGLE_LINE,Tesseract.PSM.RAW_LINE||Tesseract.PSM.SINGLE_LINE];
        for(const mode of modes){
          await worker.setParameters({
            tessedit_pageseg_mode:mode,
            preserve_interword_spaces:"1",
            user_defined_dpi:"300",
            tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ '-&"
          });
          for(let i=0;i<variants.length;i++){
            const res=await worker.recognize(variants[i],{}, {text:true,blocks:true,tsv:true});
            const raw=((res.data&&res.data.text)||"").trim();
            const one=clean(raw);
            let conf=0;
            const blocks=(res.data&&res.data.blocks)||[];
            const confs=[];
            blocks.forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>{if(l.confidence!=null)confs.push(l.confidence)})));
            if(confs.length)conf=confs.reduce((a,b)=>a+b,0)/confs.length;
            let sc=scoreOCRCandidate(one,conf);

            // Bonus aux lectures qui ressemblent à un vrai nom composé (1 à 3 mots lisibles).
            const words=one.split(/\s+/).filter(Boolean);
            if(words.length>=1&&words.length<=3&&words.every(w=>w.length>=3))sc+=.05;

            if(sc>best.score)best={text:one,score:sc};
          }
        }
        if(best.score>=.30)d=best.text;
      }else{
        const res=await worker.recognize(canvas,{}, {text:true,blocks:true,tsv:true});
        let lines=linesFromBlocks(res.data&&res.data.blocks);
        d=choose(lines,canvas.width,canvas.height);
        if(!d){
          const raw=(res.data&&res.data.text)||"";
          const candidates=raw.split(/\r?\n/)
            .map(x=>({raw:x,clean:clean(x)}))
            .filter(x=>x.clean.length>=3 && !BAD.test(x.clean) && !isBarcodeLike(x.raw) && plausibleLabel(x.clean));
          d=(candidates[0]&&candidates[0].clean)||"";
        }
      }
      const learned=(window.matchKnownClient&&d)?window.matchKnownClient(d):d;
      $("destination").value=learned;
      $("bar").style.width="100%";
      $("ocrStatus").textContent=learned?(learned!==d?"Client/ville reconnu grâce aux validations précédentes. Vérifie puis valide.":"Ville/client détecté. Vérifie puis valide."):"Aucun nom net détecté. Saisis la ville ou le client.";
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