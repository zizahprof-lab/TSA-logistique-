// TSA scanner guidé v3 — rectangle central façon scan de carte.
(function(){
  let stream=null,lastScanFile=null;

  const css=document.createElement("style");
  css.textContent=`
  #tsaScanner{position:fixed;inset:0;z-index:9999;background:#000;display:none;overflow:hidden}
  #tsaScanner.on{display:block}
  #tsaScanner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
  #tsaScanGuide{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:min(94vw,700px);aspect-ratio:3.1/1;border:3px solid #fff;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.58);pointer-events:none}
  #tsaScanGuide:before,#tsaScanGuide:after{content:"";position:absolute;width:34px;height:34px;border-color:#38d27a;border-style:solid}
  #tsaScanGuide:before{left:-4px;top:-4px;border-width:5px 0 0 5px;border-radius:12px 0 0 0}
  #tsaScanGuide:after{right:-4px;bottom:-4px;border-width:0 5px 5px 0;border-radius:0 0 12px 0}
  #tsaScanHelp{position:absolute;left:12px;right:12px;top:max(18px,env(safe-area-inset-top));color:#fff;text-align:center;font-weight:800;text-shadow:0 2px 5px #000;font-size:16px}
  #tsaScanSub{font-weight:500;font-size:13px;opacity:.9;margin-top:5px}
  #tsaScanControls{position:absolute;left:0;right:0;bottom:max(20px,env(safe-area-inset-bottom));display:flex;justify-content:center;align-items:center;gap:28px}
  #tsaCapture{width:76px;height:76px;border-radius:50%;border:6px solid rgba(255,255,255,.85);background:#fff;box-shadow:0 3px 14px rgba(0,0,0,.4);padding:0}
  #tsaCancel{background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.5);min-width:92px}
  @media(orientation:landscape){#tsaScanGuide{width:min(78vw,780px);aspect-ratio:3.7/1;top:47%}}
  `;
  document.head.appendChild(css);

  const modal=document.createElement("div");
  modal.id="tsaScanner";
  modal.innerHTML=`<video id="tsaVideo" autoplay muted playsinline></video>
  <div id="tsaScanGuide"></div>
  <div id="tsaScanHelp">Place le nom du client ou la ville dans le rectangle
    <div id="tsaScanSub">Seul ce qui est dans le cadre sera lu</div>
  </div>
  <div id="tsaScanControls"><button id="tsaCancel" type="button">Annuler</button><button id="tsaCapture" type="button" aria-label="Prendre la photo"></button></div>`;
  document.body.appendChild(modal);

  const video=document.getElementById("tsaVideo");
  const guide=document.getElementById("tsaScanGuide");
  const photo=$("photo");

  function stopCamera(){
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
    modal.classList.remove("on");
  }

  async function openCamera(){
    if(!$("loadingPlace").value.trim()){
      alert("Indique d’abord le lieu de chargement.");
      $("loadingPlace").focus();
      return;
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      alert("La caméra guidée n’est pas disponible sur ce téléphone. Utilise « Importer une photo ».");
      return;
    }
    try{
      stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},
        audio:false
      });
      video.srcObject=stream;
      modal.classList.add("on");
      await video.play();
    }catch(e){
      stopCamera();
      alert("Impossible d’ouvrir la caméra. Autorise l’accès à la caméra ou utilise « Importer une photo ».");
    }
  }

  function canvasToFile(canvas){
    return new Promise((resolve,reject)=>{
      canvas.toBlob(blob=>{
        if(!blob)return reject(new Error("capture"));
        resolve(new File([blob],"tsa-zone-client-"+Date.now()+".jpg",{type:"image/jpeg",lastModified:Date.now()}));
      },"image/jpeg",.94);
    });
  }

  async function captureZone(){
    if(!video.videoWidth || !video.videoHeight)return;
    const vr=video.getBoundingClientRect(), gr=guide.getBoundingClientRect();
    const scale=Math.max(vr.width/video.videoWidth,vr.height/video.videoHeight);
    const renderedW=video.videoWidth*scale, renderedH=video.videoHeight*scale;
    const offX=(vr.width-renderedW)/2, offY=(vr.height-renderedH)/2;
    let sx=(gr.left-vr.left-offX)/scale;
    let sy=(gr.top-vr.top-offY)/scale;
    let sw=gr.width/scale, sh=gr.height/scale;
    sx=Math.max(0,sx);sy=Math.max(0,sy);
    sw=Math.min(video.videoWidth-sx,sw);sh=Math.min(video.videoHeight-sy,sh);
    const out=document.createElement("canvas");
    const targetW=Math.min(1800,Math.max(1000,Math.round(sw)));
    const ratio=targetW/sw;
    out.width=targetW;out.height=Math.max(220,Math.round(sh*ratio));
    const ctx=out.getContext("2d");
    ctx.drawImage(video,sx,sy,sw,sh,0,0,out.width,out.height);
    const file=await canvasToFile(out);
    lastScanFile=file;
    stopCamera();
    await processFile(file);
  }

  async function processFile(f){
    if(!f)return;
    if(!$("loadingPlace").value.trim()){
      alert("Indique d’abord le lieu de chargement.");
      return;
    }
    $("destination").value="";
    $("destination").disabled=false;
    $("validDest").disabled=false;
    $("destStep").style.opacity="1";
    $("destMsg").textContent="";
    $("whole").disabled=true;$("half").disabled=true;$("addPoint").disabled=true;
    $("palStep").style.opacity=".55";
    const r=new FileReader();
    r.onload=x=>{$("preview").src=x.target.result;$("preview").style.display="block"};
    r.readAsDataURL(f);
    await runOCR(f);
  }

  $("openScanner").onclick=openCamera;
  $("importPhoto").onclick=()=>photo.click();
  document.getElementById("tsaCancel").onclick=stopCamera;
  document.getElementById("tsaCapture").onclick=captureZone;

  photo.onchange=async e=>{
    const f=e.target.files&&e.target.files[0];
    lastScanFile=f||null;
    $("retryOCR").disabled=!f;
    if(f)await processFile(f);
  };
  photo.onclick=null;
  $("retryOCR").onclick=()=>{
    const f=lastScanFile||(photo.files&&photo.files[0]);
    if(f)runOCR(f);
  };

  window.addEventListener("pagehide",stopCamera);
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&modal.classList.contains("on"))stopCamera()});
})();