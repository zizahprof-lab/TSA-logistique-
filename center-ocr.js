// TSA OCR override: priorité au texte central, grand et gras.
// Chargé après index.html sur le déploiement Render chauffeur.

addInkScores = async function(file,candidates){
  if(!candidates.length)return candidates;
  try{
    const img=await imageForInk(file);
    const cv=document.createElement("canvas");
    cv.width=img.naturalWidth;cv.height=img.naturalHeight;
    const ctx=cv.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0);
    for(const x of candidates){
      x.imageW=cv.width;x.imageH=cv.height;
      const l=Math.max(0,Math.floor(x.left||0));
      const t=Math.max(0,Math.floor(x.top||0));
      const w=Math.max(1,Math.min(cv.width-l,Math.ceil(x.width||1)));
      const h=Math.max(1,Math.min(cv.height-t,Math.ceil(x.height||1)));
      if(w<=1||h<=1){x.ink=.2;continue}
      const d=ctx.getImageData(l,t,w,h).data;
      let dark=0,total=0;
      for(let i=0;i<d.length;i+=16){
        const lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];
        if(lum<145)dark++;
        total++;
      }
      x.ink=total?dark/total:.2;
    }
  }catch(e){candidates.forEach(x=>x.ink=.2)}
  return candidates;
};

chooseProminent = function(candidates){
  if(!candidates.length)return"";
  const bad=/\b(ADRESSE|RUE|AVENUE|ROUTE|CHEMIN|ZI|ZONE|SIRET|TVA|PALETTE|CARTON|POIDS|KG|LOT|QTEE|QTÉE|REFERENCE|REF|TELEPHONE|TEL|FAX|FRANCE|CEDEX)\b/i;
  candidates=candidates.filter(x=>x.text && !bad.test(x.text) && !/\d{5}/.test(x.text));
  if(!candidates.length)return"";

  // 1) On privilégie réellement le MILIEU de la photo.
  const central=candidates.filter(x=>{
    const iw=x.imageW||Math.max(...candidates.map(y=>(y.left||0)+(y.width||0)),1);
    const ih=x.imageH||Math.max(...candidates.map(y=>(y.top||0)+(y.height||0)),1);
    const cx=((x.left||0)+(x.width||0)/2)/iw;
    const cy=((x.top||0)+(x.height||0)/2)/ih;
    return cx>=.15 && cx<=.85 && cy>=.20 && cy<=.80;
  });
  if(central.length)candidates=central;

  // 2) Dans cette zone centrale : plus grand + plus gras, puis proximité du centre.
  const maxH=Math.max(...candidates.map(x=>x.height||1));
  candidates.forEach(x=>{
    const iw=x.imageW||Math.max(...candidates.map(y=>(y.left||0)+(y.width||0)),1);
    const ih=x.imageH||Math.max(...candidates.map(y=>(y.top||0)+(y.height||0)),1);
    const cx=((x.left||0)+(x.width||0)/2)/iw;
    const cy=((x.top||0)+(x.height||0)/2)/ih;
    const dist=Math.sqrt(Math.pow(cx-.5,2)+Math.pow(cy-.5,2));
    const center=Math.max(0,1-dist/.55);
    const size=(x.height||1)/maxH;
    const ink=Math.min(.5,Math.max(0,x.ink||.2))/.5;
    const conf=Math.max(0,Math.min(1,(x.conf||50)/100));
    const letters=(x.text.match(/[A-ZÀ-ÖØ-öø-ÿ]/g)||[]).length;
    const cleanRatio=letters/Math.max(1,x.text.length);
    x.score=center*.42+size*.34+ink*.17+conf*.04+cleanRatio*.03;
  });
  candidates.sort((a,b)=>b.score-a.score);
  const top=candidates[0];
  if(!top)return"";

  // 3) Une seule ligne, rien d'autre.
  let s=cleanProminentText(top.text)
    .replace(/\b(FRANCE|CEDEX|TEL|TELEPHONE|FAX|PORT|MOBILE)\b.*$/i,"")
    .replace(/[|;:].*$/,"")
    .replace(/\s+/g," ")
    .trim();
  return s;
};
