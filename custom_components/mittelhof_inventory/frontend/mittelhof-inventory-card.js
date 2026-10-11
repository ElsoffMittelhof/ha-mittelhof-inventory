import "./vendor/qrgen.js";
import "./vendor/jsQR.js";

/* Mittelhof Inventar 1.0.0 – local-only HA cards. No remote QR endpoints. */
const DOMAIN = "mittelhof_inventory";
const DEFAULT_CAPTURE_PATH = "/inventar-dashboard/erfassung";
const css = `
  .body { padding: 0 16px 16px; }
  section { padding: 12px 0; border-top: 1px solid var(--divider-color); }
  label { display: block; margin: 8px 0 4px; }
  input, select { box-sizing: border-box; width: 100%; padding: 9px; border-radius: 6px;
    background: var(--card-background-color); border: 1px solid var(--divider-color);
    color: var(--primary-text-color); font: inherit; }
  button { margin: 9px 6px 4px 0; background: var(--primary-color); color: var(--text-primary-color, white);
    border: none; border-radius: 6px; padding: 10px 15px; cursor: pointer; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  button.danger { background: var(--error-color, #ba3030); color: white; }
  .status { min-height: 20px; white-space: pre-line; margin: 8px 0; }
  .hint { color: var(--secondary-text-color); font-size: 0.88rem; margin: 7px 0; }
  table { border-collapse: collapse; width: 100%; }
  td,th { border-bottom: 1px solid var(--divider-color); padding: 8px 7px; text-align: left; }
  td.num,th.num { text-align: right; }
  .scroll { overflow-x: auto; }
  .row { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap: 12px; }
`;

function newTransactionId() {
  // crypto.randomUUID() and camera APIs may be unavailable on HA iOS over local HTTP.
  // getRandomValues() is also available in insecure browser contexts.
  const cryptoApi=globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes=new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  }
  // Only an idempotency key, never an authentication credential.
  return "fallback-"+Date.now().toString(36)+"-"+
    Math.random().toString(36).slice(2)+"-"+Math.random().toString(36).slice(2);
}

function el(tag, text, parent, cls = "") {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}
function refill(select, rows, label) {
  const sig = rows.map(r => [r.id,r[label],r.sku].join(":")).join("|");
  if (select.dataset.signature === sig) return;
  const current = select.value;
  select.replaceChildren(new Option("Bitte wählen", ""));
  for (const row of rows) select.add(new Option(
    label === "name" && row.sku ? row.sku + " – " + row.name : row[label], row.id
  ));
  select.value = rows.some(row => row.id === current) ? current : "";
  select.dataset.signature = sig;
}
function qrSvg(content) {
  const qr = window.qrgen.QrCode.encodeText(content, window.qrgen.QrCode.Ecc.HIGH);
  const margin = 4, size = qr.size + margin * 2;
  const parts = [];
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.getModule(x, y)) parts.push("M" + (x+margin) + "," + (y+margin) + "h1v1h-1z");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" role="img" aria-label="QR-Code"><rect width="'+size+'" height="'+size+'" fill="#fff"/><path d="'+parts.join(" ")+'" fill="#000"/></svg>';
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function makeCaptureUrl(baseUrl, capturePath, query) {
  const root = new URL(baseUrl);
  if (!["http:", "https:"].includes(root.protocol)) throw new Error("Nur HTTP(S)-Adressen erlaubt");
  const url = new URL(capturePath || DEFAULT_CAPTURE_PATH, root);
  for (const [k,v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}
function printLabels(labels) {
  if (!labels.length) throw Error("Keine QR-Etiketten verfügbar");
  const popup = window.open("", "_blank");
  if (!popup) throw Error("Pop-up wurde blockiert – Pop-ups erlauben");
  const chunks = [];
  for (let offset=0; offset<labels.length; offset+=24) {
    const items=labels.slice(offset,offset+24);
    chunks.push('<div class="sheet"><div class="grid">'+items.map(x =>
      '<div class="label">'+qrSvg(x.url)+'<div class="text"><div class="name">'
      +escapeText(x.name)+'</div><div class="detail">'
      +escapeText(x.sub||"")+'</div></div></div>').join("")+'</div></div>');
  }
  const cards=chunks.join("");
  popup.document.open();
  popup.document.write('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Mittelhof QR-Etiketten</title>'
    + '<style>@page{size:A4;margin:0}body{font-family:Arial,sans-serif;margin:0}'
    + '.sheet{height:297mm;width:210mm;box-sizing:border-box;break-after:page;overflow:hidden}'
    + '.sheet:last-child{break-after:auto}'
    + '.grid{display:grid;margin:12.9mm 9.75mm;grid-template-columns:repeat(3,63.5mm);grid-auto-rows:33.9mm;gap:0}'
    + '.label{break-inside:avoid;box-sizing:border-box;padding:2mm;display:flex;align-items:center;'
    + 'width:63.5mm;height:33.9mm;overflow:hidden}'
    + '.label svg{height:26mm;width:26mm;flex-shrink:0;margin-right:1mm}'
    + '.text{min-width:0;max-width:32mm}.name{font-weight:bold;font-size:9pt;overflow-wrap:anywhere}'
    + '.detail{font-size:7pt;color:#555;overflow-wrap:anywhere}</style></head>'
    + '<body>'+cards+'</body></html>');
  popup.document.close();
  popup.focus();
  // User prints the opened local sheet with Cmd/Ctrl+P; no external service.
}

class InventoryBase extends HTMLElement {
  setConfig(config) { this.config = config || {}; }
  set hass(value) {
    this._hass = value;
    if (!this._ready) {
      this.render();
      this._ready = true;
    }
    this.update();
  }
  $(id) { return this.querySelector("#" + id); }
  getCardSize() { return 9; }
  records(suffix, prop) {
    const wanted = this.config?.[prop];
    const states = this._hass?.states || {};
    const st = (wanted && states[wanted]) ||
      Object.entries(states).find(([key]) => key.startsWith("sensor.") && key.endsWith("_inventar_" + suffix))?.[1];
    if (st?.attributes?.truncated) {
      if (this.$("notice")) this.$("notice").textContent =
        "Der Sensor enthält zu viele Datensätze für die Anzeige. Für größere Inventare ist die Daten-API erforderlich.";
    }
    return Array.isArray(st?.attributes?.records) ? st.attributes.records : [];
  }
  get data() {
    return this._verifiedData || this._sourceData || {
      items: this.records("artikel", "items_entity"),
      locations: this.records("standorte", "locations_entity"),
      stock: this.records("bestandspositionen", "stock_entity"),
      suggestions: this.records("fehlbestande", "suggestions_entity"),
      categories: this.records("kategorien", "categories_entity"),
      areas: this.records("bereiche", "areas_entity"),
    };
  }
  async refreshFromServer(statusId) {
    try {
      const fresh=await this._hass.connection.sendMessagePromise({type:"mittelhof_inventory/read"});
      this._sourceData=fresh;
      this.update();
      if(statusId&&this.$(statusId))this.$(statusId).textContent="Bestand aktualisiert.";
      return fresh;
    }catch(err){
      if(statusId&&this.$(statusId))
        this.$(statusId).textContent="Aktualisierung fehlgeschlagen: "+(err?.message||err);
      return null;
    }
  }
  async action(service, payload, success, statusId="status") {
    const status = this.$(statusId) || this.$("status");
    const button = this.$("submit");
    if (this._busy) return false;
    this._busy = true;
    if (button) button.disabled = true;
    if (status) {
      status.textContent = "Speichern läuft …";
      status.style.color = "var(--primary-text-color)";
    }
    try {
      const reply = await this._hass.connection.sendMessagePromise({
        type: "mittelhof_inventory/execute",
        action: service,
        data: payload,
      });
      if (!reply?.saved) throw Error("Keine bestätigte Speicherung vom Inventarserver");
      // Fetch the authoritative in-memory inventory after the storage write.
      const fresh = await this._hass.connection.sendMessagePromise({
        type: "mittelhof_inventory/read",
      });
      if (!fresh || !Array.isArray(fresh.items)) throw Error("Gespeichert, aber der neue Bestand konnte nicht gelesen werden");
      this._verifiedData = fresh;
      this._sourceData = fresh;
      if (success) success(reply, fresh);
      try { this.update(); } finally { this._verifiedData = null; }
      const msg = service === "set_count"
        ? "Gespeichert und geprüft: " + reply.stored_quantity + " Stück. Buchungs-ID: " +
          (reply.result?.id || "nicht verfügbar")
        : service === "set_stock_policy"
          ? "Regel gespeichert und geprüft: Minimum " + reply.policy?.min_quantity +
            ", Soll " + reply.policy?.target_quantity + "."
          : "Gespeichert und durch Rücklesen bestätigt.";
      if (status) { status.textContent = msg; status.style.color = "var(--success-color, #27834a)"; }
      return true;
    } catch (err) {
      if (status) {
        status.textContent = "Speichern nicht bestätigt: " + (err?.message || String(err)) +
          ". Bitte vor erneutem Versuch die Bestandsübersicht prüfen.";
        status.style.color = "var(--error-color, #b32d2e)";
      }
      return false;
    } finally {
      this._busy = false;
      if (button) button.disabled = false;
    }
  }
}

class InventoryOverview extends InventoryBase {
  render() {
    this.innerHTML = '<ha-card header="Bestandsübersicht"><div class="body">'
      + '<div id="notice" class="hint"></div><label>Standorte filtern <select id="filter"></select></label>'
      + '<div id="summary" class="hint"></div><div id="table" class="scroll"></div>'
      + '<div id="sug" class="hint"></div></div></ha-card><style>'+css+'</style>';
    const filter=this.$("filter");
    filter.onchange=()=>this.update();
  }
  update() {
    if (!this._ready) return;
    const {items,locations,stock,suggestions} = this.data;
    const filter=this.$("filter");
    refill(filter, [{id:"",name:"Alle Standorte"},...locations],"name");
    const locs=locations.filter(x=>!filter.value||filter.value===x.id);
    const lookup = new Map(stock.map(s=>[s.item_id+"|"+s.location_id,s]));
    const div=this.$("table"); div.replaceChildren();
    if (!items.length || !locations.length) {
      div.textContent="Noch keine Artikel oder Standorte vorhanden.";return;
    }
    const table=el("table",null,div), head=el("thead",null,table), hr=el("tr",null,head);
    for(const name of ["Artikelnummer","Artikel","Einheit",...locs.map(x=>x.name),"Gesamt"]) {
      el("th",name,hr);
    }
    const body=el("tbody",null,table);
    let counted=0, total=0, unknown=0;
    for(const item of [...items].sort((a,b)=>a.sku.localeCompare(b.sku,"de"))) {
      const tr=el("tr",null,body);
      el("td",item.sku,tr);el("td",item.name,tr);el("td",item.unit,tr);
      let rowtotal=0,complete=true;
      let assignedCount=0;
      for(const loc of locs) {
        const rec=lookup.get(item.id+"|"+loc.id);
        const td=el("td","",tr,"num");
        if(!(item.location_ids||[]).includes(loc.id)){
          td.textContent="n. a.";
          td.title="Artikel ist diesem Standort nicht zugeordnet";
          continue;
        }
        assignedCount++;
        if (!rec?.counted) {
          td.textContent=rec ? String(rec.quantity)+" (ungeprüft)" : "—";
          td.title="Noch nicht inventarisiert";complete=false;unknown++;
        } else {
          td.textContent=String(rec.quantity);counted++;rowtotal+=Number(rec.quantity)||0;
        }
      }
      el("td",assignedCount?(complete?String(rowtotal):(rowtotal?rowtotal+" + ?":"—")):"n. a.",tr,"num");
      total+=rowtotal;
    }
    this.$("summary").textContent=
      "Erfasste Positionen: "+counted+" · Noch nicht gezählt: "+unknown+
      " · Gezählt: "+total+" Einheiten"+(unknown?" (Gesamtbestand noch unvollständig)":"");
    const sug=this.$("sug");
    sug.textContent = suggestions.length ? "Nachbestellhinweise: "+suggestions.length : "";
  }
}

class InventoryCapture extends InventoryBase {
  render() {
    this.innerHTML='<ha-card header="Inventur und Bestandsbewegungen"><div class="body">'
      + '<div class="hint">Erstinventur: pro Haus die tatsächlich gezählte Menge eingeben – kein Zentrallager-Zugang nötig.</div>'
      + '<div class="row"><div><label>Buchungsart<select id="kind">'
      + '<option value="set_count">Erstinventur / Istbestand setzen</option>'
      + '<option value="receipt">Wareneingang (neue Ware)</option><option value="consume">Verbrauch</option>'
      + '<option value="transfer">Umlagerung zwischen Standorten</option></select></label></div>'
      + '<div><label>Artikel<select id="item"></select></label></div></div>'
      + '<div class="row"><div id="single-wrap"><label>Standort<select id="loc"></select></label></div>'
      + '<div id="src-wrap" hidden><label>Von Standort<select id="src"></select></label></div>'
      + '<div id="dest-wrap" hidden><label>Nach Standort<select id="dest"></select></label></div></div>'
      + '<label id="quantity-label">Gezählter Istbestand (absolut)<input id="quantity" type="number" min="0" step="1" placeholder="Noch ungezählt"></label>'
      + '<div id="existing" class="hint"></div><div id="delta" class="hint"></div>'
      + '<label>Bemerkung (optional)<input id="note" maxlength="180"></label>'
      + '<button id="submit">Bestand speichern</button>'
      + '<div id="status" class="status" role="status" aria-live="polite"></div>'
      + '<button id="scan" type="button">QR-Code scannen</button>'
      + '<label>Alternativ Kamera-Foto oder QR-Bild auswählen<input id="qr-file" type="file" accept="image/*" capture="environment"></label>'
      + '<div id="camera-box" hidden><video id="camera" autoplay muted playsinline style="width:100%;max-height:240px"></video>'
      + '<button id="stop" type="button">Kamera schließen</button></div>'
      + '<div id="scan-status" class="status" role="status"></div></div></ha-card><style>'+css+'</style>';
    this.$("kind").onchange=()=>this.updateMode();
    this.$("item").onchange=()=>this.updateCurrent();
    this.$("quantity").oninput=()=>this.updateDelta();
    this.$("loc").onchange=()=>this.updateCurrent();
    this.$("submit").onclick=()=>this.submit();
    this.$("scan").onclick=()=>this.scan();
    this.$("qr-file").onchange=event=>this.scanImageFile(event.target.files?.[0]);
    this.$("stop").onclick=()=>this.stopCamera();
    this.$("loc").addEventListener("change",()=>{
      try { window.sessionStorage.setItem("mittelhof_inventory_location",this.$("loc").value); } catch(e) {}
    });
  }
  update() {
    if (!this._ready) return;
    const {items,locations} = this.data;
    for(const [id,rows] of [["item",items],["loc",locations],["src",locations],["dest",locations]])
      refill(this.$(id),rows,"name");
    if (!this._deepLinked && locations.length && items.length) {
      this._deepLinked=true;
      const qs=new URLSearchParams(window.location.search);
      let remembered="";
      try { remembered=window.sessionStorage.getItem("mittelhof_inventory_location") || ""; } catch(e) {}
      const locationId=qs.get("inventory_location") || remembered;
      const itemId=qs.get("inventory_item") || "";
      if (locations.some(l=>l.id===locationId)) this.$("loc").value=locationId;
      if (items.some(i=>i.id===itemId)) this.$("item").value=itemId;
      if (qs.has("inventory_location") && locationId) {
        try { window.sessionStorage.setItem("mittelhof_inventory_location",locationId); } catch(e) {}
      }
    }
    this.updateMode();this.updateCurrent();
  }
  updateMode() {
    const type=this.$("kind").value;
    this.$("single-wrap").hidden=type==="transfer";
    this.$("src-wrap").hidden=type!=="transfer";
    this.$("dest-wrap").hidden=type!=="transfer";
    this.$("quantity-label").firstChild.textContent=type==="set_count"?
      "Gezählter Istbestand (absolut)":"Menge";
    this.$("quantity").min=type==="set_count"?"0":"1";
    if(type!=="set_count" && Number(this.$("quantity").value)<1) this.$("quantity").value="1";
    this.updateCurrent();
  }
  updateCurrent() {
    const {stock,items}=this.data;
    const id=this.$("item").value,loc=this.$("loc").value;
    const rec=stock.find(x=>x.item_id===id&&x.location_id===loc);
    const kind=this.$("kind").value;
    const item=items.find(x=>x.id===id);
    const assigned=!!item&&(item.location_ids||[]).includes(loc);
    const selectionKey=[id,loc,kind,rec?.quantity??"missing",rec?.counted??false].join("|");
    if(selectionKey!==this._quantitySource){
      this._quantitySource=selectionKey;
      // A never-counted item is an unknown quantity, not an assumed zero.
      if(kind==="set_count")
        this.$("quantity").value=assigned&&rec?String(rec.quantity):"";
      else this.$("quantity").value="1";
    }
    this.$("existing").textContent=!assigned&&id&&loc?
      "Dieser Artikel ist dem Standort nicht zugeordnet. In Verwaltung zuerst zuordnen.":
      kind==="set_count"?
        "Aktueller Buchbestand: "+(rec?.quantity??0)+" · "+
        (rec?.counted?"Bereits gezählt":"Noch nicht inventarisiert (Istwert bitte eingeben)") :
        "Achtung: Zugang erhöht den Gesamtbestand, Umlagerung nicht.";
    this.$("submit").disabled=!!id&&!!loc&&!assigned&&kind!=="transfer";
    this.updateDelta();
  }
  updateDelta(){
    const kind=this.$("kind").value;
    if(kind!=="set_count"){this.$("delta").textContent="";return;}
    const {stock}=this.data;
    const rec=stock.find(x=>x.item_id===this.$("item").value&&x.location_id===this.$("loc").value);
    const actual=this.$("quantity").value.trim();
    if(!actual){this.$("delta").textContent="Gezählte Menge eingeben.";return;}
    const value=Number(actual),old=rec?.quantity??0;
    if(!Number.isSafeInteger(value)||value<0){this.$("delta").textContent="Ungültige Menge";return;}
    const diff=value-old;
    this.$("delta").textContent="Bestandsdifferenz: "+(diff>0?"+":"")+diff+
      " · Neu: "+value+" · Bisher: "+old;
  }
  async submit() {
    const type=this.$("kind").value,id=this.$("item").value,loc=this.$("loc").value;
    const src=this.$("src").value,dst=this.$("dest").value,q=Number(this.$("quantity").value);
    if(!id || !Number.isSafeInteger(q) || q< (type==="set_count"?0:1)){
      this.$("status").textContent="Artikel und gültige ganzzahlige Menge angeben.";return;
    }
    const note=this.$("note").value;
    if(type==="set_count"){
      if(!loc){this.$("status").textContent="Standort auswählen.";return;}
      const prev=this.data.stock.find(x=>x.item_id===id&&x.location_id===loc)?.quantity??0;
      if(!window.confirm("Istbestand auf "+q+" setzen? Bisher: "+prev+". Die Differenz wird protokolliert."))return;
      await this.action("set_count",{item_id:id,location_id:loc,quantity:q,
        expected_quantity:prev,idempotency_key:newTransactionId(),note},()=>this.afterSuccess());
    } else {
      const from=type==="transfer"?src:(type==="consume"?loc:undefined);
      const to=type==="transfer"?dst:(type==="receipt"?loc:undefined);
      if((type==="transfer"&&(!from||!to||from===to)) || (type!=="transfer"&&!loc)){
        this.$("status").textContent="Gültige Standorte wählen.";return;
      }
      await this.action("book_transaction",{kind:type,item_id:id,
        from_location_id:from,to_location_id:to,quantity:q,
        idempotency_key:newTransactionId(),note},()=>this.afterSuccess());
    }
  }
  afterSuccess() {
    this.$("note").value="";
    this._quantitySource="";
    // Keep scanned item + site visible; refreshed HA stock supplies the new count.
  }
  applyQr(urlText) {
    const url=new URL(urlText);
    const route=(this.config?.capture_path||DEFAULT_CAPTURE_PATH).replace(/\/$/,"");
    if(!["http:","https:"].includes(url.protocol)||url.pathname.replace(/\/$/,"")!==route)
      throw Error("Kein gültiger Mittelhof-Erfassungslink");
    const itemId=url.searchParams.get("inventory_item"),locId=url.searchParams.get("inventory_location");
    const {items,locations}=this.data;
    const item=items.find(x=>x.id===itemId);
    if(!item || !locations.some(x=>x.id===locId) ||
       !(item.location_ids||[]).includes(locId))
      throw Error("Artikel-Standort-Kombination unbekannt oder nicht aktiv");
    this.$("item").value=itemId;
    if(locId && locations.some(x=>x.id===locId)){
      this.$("loc").value=locId;
      try{window.sessionStorage.setItem("mittelhof_inventory_location",locId);}catch(e){}
    }

    this._quantitySource="";this.updateCurrent();this.$("scan-status").textContent="QR-Code erkannt. Menge eingeben und bestätigen.";
  }
  readQRFromCanvas(canvas) {
    if(!window.jsQR) throw Error("Lokaler QR-Decoder nicht verfügbar");
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    return window.jsQR(data.data,data.width,data.height,{inversionAttempts:"attemptBoth"})?.data;
  }
  async scanImageFile(file){
    if(!file)return;
    const url=URL.createObjectURL(file);
    const img=new Image();
    try {
      img.src=url;
      await img.decode();
      const scale=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      const text=this.readQRFromCanvas(canvas);
      if(!text)throw Error("Kein QR-Code gefunden. Foto näher und schärfer aufnehmen.");
      this.applyQr(text);
    } catch(e){this.$("scan-status").textContent="QR-Fehler: "+(e?.message||e);}
    finally {URL.revokeObjectURL(url);this.$("qr-file").value="";}
  }
  async scan(){
    if(!navigator.mediaDevices?.getUserMedia){
      this.$("scan-status").textContent="Live-Kamera in dieser App nicht verfügbar. Fotoauswahl wird geöffnet.";this.$("qr-file").click();
      return;
    }
    try{
      this._stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}});
      const video=this.$("camera");video.srcObject=this._stream;
      this.$("camera-box").hidden=false;await video.play();
      const canvas=document.createElement("canvas");
      canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      const loop=()=>{
        if(!this._stream)return;
        try{
          if(video.readyState>=2){
            const scale=Math.min(1,640/video.videoWidth,480/video.videoHeight);
            canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
            canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
            ctx.drawImage(video,0,0,canvas.width,canvas.height);
            const result=this.readQRFromCanvas(canvas);
            if(result){
              this.applyQr(result);
              this.stopCamera();return;
            }
          }
        }catch(e){this.$("scan-status").textContent="QR-Fehler: "+(e?.message||e);this.stopCamera();return;}
        if(this._stream) this._frame=requestAnimationFrame(loop);
      };
      this._frame=requestAnimationFrame(loop);
    }catch(e){
      this.$("scan-status").textContent="Live-Kamera nicht verfügbar: "+(e?.message||e)+". Fotoauswahl öffnen.";this.$("qr-file").click();
      this.stopCamera();
    }
  }
  stopCamera(){
    if(this._frame)cancelAnimationFrame(this._frame);
    this._frame=null;
    if(this._stream) this._stream.getTracks().forEach(t=>t.stop());
    this._stream=null;
    const video=this.$("camera");if(video)video.srcObject=null;
    if(this.$("camera-box"))this.$("camera-box").hidden=true;
  }
  disconnectedCallback(){this.stopCamera();}
}

class InventoryAdmin extends InventoryBase {
  render() {
    this.innerHTML='<ha-card header="Inventar-Verwaltung"><div class="body">'
      + '<section><h3>Artikel anlegen</h3><div class="row">'
      + '<label>Artikelnummer: wird automatisch vergeben</label>'
      + '<label>Bezeichnung<input id="name"></label>'
      + '<label>Einheit<input id="unit" value="Stück"></label>'
      + '<label>Hersteller (optional)<input id="manufacturer"></label>'
      + '<label>Genaue Produktbezeichnung / Modell (optional)<input id="product-name"></label>'
      + '<label>Kategorie<select id="category"></select></label></div>'
      + '<div class="hint">Artikel an diesen Standorten führen:</div>'
      + '<div id="new-locations"></div>'
      + '<button id="additem">Artikel anlegen</button></section>'
      + '<section><h3>Artikeldetails bearbeiten</h3>'
      + '<label>Artikel auswählen<select id="edit-item"></select></label>'
      + '<label>Artikelname<input id="edit-name"></label>'
      + '<label>Einheit<input id="edit-unit"></label>'
      + '<label>Kategorie<select id="edit-category"></select></label>'
      + '<label>Hersteller (optional)<input id="edit-manufacturer"></label>'
      + '<label>Genaue Produktbezeichnung / Modell (optional)<input id="edit-product-name"></label>'
      + '<button id="save-item">Artikeldetails speichern</button>'
      + '<div id="item-status" class="status" role="status" aria-live="polite"></div></section>'
      + '<section><h3>Artikel-Standorte bearbeiten</h3>'
      + '<label>Artikel<select id="assigned-item"></select></label>'
      + '<div id="assignment-list"></div>'
      + '<button id="save-assignment">Zuordnung speichern</button>'
      + '<div class="hint">Standorte mit Bestand können nicht entfernt werden.</div></section>'
      + '<section><h3>Standort anlegen</h3><div class="row"><label>Kürzel<input id="code"></label>'
      + '<label>Name<input id="locname"></label></div>'
      + '<label>Schnellvorlage<select id="location-preset">'
      + '<option value="">Standort auswählen …</option>'
      + '<option value="GARAGE1">Garage 1</option><option value="GARAGE2">Garage 2</option>'
      + '<option value="CARPORT">Carport</option><option value="WERKSTATT">Werkstatt</option>'
      + '<option value="STALL">Stall</option><option value="GARTENHAUS">Gartenhaus</option>'
      + '<option value="WASCHKUECHE">Waschküche</option><option value="DACHBODEN">Dachboden</option>'
      + '</select></label><button id="addloc">Standort anlegen</button>'
      + '<div id="location-status" class="status" role="status" aria-live="polite"></div></section>'
      + '<section><h3>Mindest- und Sollbestand</h3><div class="row">'
      + '<label>Artikel<select id="item"></select></label><label>Standort<select id="loc"></select></label>'
      + '<label>Minimum<input id="min" type="number" min="0" value="2"></label>'
      + '<label>Soll<input id="target" type="number" min="0" value="10"></label></div>'
      + '<button id="policy">Regel speichern</button>'
      + '<div id="policy-status" class="status" role="status" aria-live="polite"></div></section>'
      + '<section><h3>Testdaten löschen</h3>'
      + '<div class="hint">Nur Administratoren. Vorher HA-Backup erstellen. Löschen ist unwiderruflich.</div>'
      + '<label>Einzelnen Artikel vollständig löschen<select id="delete-item"></select></label>'
      + '<button id="delete" class="danger">Artikel inklusive Beständen löschen</button>'
      + '<p class="hint">Gesamtbestand zurücksetzen löscht alle Mengen, Inventurmarkierungen und'
      + ' Bewegungen. Artikel und Standorte bleiben erhalten.</p>'
      + '<button id="reset" class="danger">Gesamtbestand zurücksetzen</button></section>'
      + '<div id="status" class="status" role="status"></div></div></ha-card><style>'+css+'</style>';
    this.$("additem").onclick=()=>this.createItem();
    this.$("edit-item").onchange=()=>this.loadEditItem();
    this.$("save-item").onclick=()=>this.saveItem();
    this.$("location-preset").onchange=()=>{
      const sel=this.$("location-preset");
      if(!sel.value)return;
      this.$("code").value=sel.value;
      this.$("locname").value=sel.selectedOptions[0]?.textContent||"";
    };
    this.$("addloc").onclick=()=>this.createLocation();
    this.$("policy").onclick=()=>this.policy();
    this.$("assigned-item").onchange=()=>{this._editorSignature="";this.renderAssignments();};
    this.$("save-assignment").onclick=()=>this.saveAssignments();

    this.$("delete").onclick=()=>this.removeItem();
    this.$("reset").onclick=()=>this.resetStock();
    this.$("base").value=window.location.origin;
  }
  update(){
    if(!this._ready)return;
    const {items,locations,categories}=this.data;
    refill(this.$("category"),categories.filter(x=>x.active),"name");
    refill(this.$("edit-category"),categories.filter(x=>x.active),"name");
    refill(this.$("item"),items,"name");
    refill(this.$("delete-item"),items,"name");
    refill(this.$("assigned-item"),items,"name");
    refill(this.$("edit-item"),items,"name");
    this.loadEditItem();
    refill(this.$("loc"),locations,"name");

    const newLoc=this.$("new-locations");
    const sig=locations.map(x=>x.id+":"+x.name).join("|");
    if(this._newLocationSig!==sig){
      this._newLocationSig=sig;newLoc.replaceChildren();
      for(const loc of locations){
        const label=el("label",null,newLoc);
        const input=el("input",null,label);input.type="checkbox";
        input.value=loc.id;input.style.width="auto";input.style.display="inline";
        label.append(" "+loc.name);
      }
    }
    this.renderAssignments();
  }
  loadEditItem(){
    const item=this.data.items.find(x=>x.id===this.$("edit-item").value);
    if(this._editingId===(item?.id||""))return;
    this._editingId=item?.id||"";
    this.$("edit-name").value=item?.name||"";
    this.$("edit-category").value=item?.category_id||"";
    this.$("edit-unit").value=item?.unit||"Stück";
    this.$("edit-manufacturer").value=item?.manufacturer||"";
    this.$("edit-product-name").value=item?.product_name||"";
  }
  saveItem(){
    const item_id=this.$("edit-item").value;
    const name=this.$("edit-name").value.trim();
    if(!item_id||!name){this.$("item-status").textContent="Artikel und Name angeben.";return;}
    this.action("update_item",{
      item_id,name,unit:this.$("edit-unit").value.trim()||"Stück",
      category_id:this.$("edit-category").value,
      manufacturer:this.$("edit-manufacturer").value.trim(),
      product_name:this.$("edit-product-name").value.trim()
    },null,"item-status");
  }
  renderAssignments(){
    const {items,locations}=this.data;
    const item=items.find(x=>x.id===this.$("assigned-item").value);
    const sig=(item?.id||"")+":"+(item?.location_ids||[]).join("|")+":"+locations.map(x=>x.id).join("|");
    if(sig===this._editorSignature)return;
    this._editorSignature=sig;
    const box=this.$("assignment-list");box.replaceChildren();
    if(!item)return;
    for(const loc of locations){
      const label=el("label",null,box);
      const input=el("input",null,label);input.type="checkbox";
      input.value=loc.id;input.checked=(item.location_ids||[]).includes(loc.id);
      input.style.width="auto";input.style.display="inline";
      label.append(" "+loc.name);
    }
  }
  saveAssignments(){
    const item=this.$("assigned-item").value;
    if(!item){this.$("status").textContent="Artikel auswählen.";return;}
    const location_ids=[...this.$("assignment-list").querySelectorAll("input:checked")].map(x=>x.value);
    this.action("set_item_locations",{item_id:item,location_ids});
  }
  createItem(){
    const name=this.$("name").value.trim();
    if(!name){this.$("status").textContent="Artikelname angeben.";return;}
    const location_ids=[...this.$("new-locations").querySelectorAll("input:checked")].map(x=>x.value);
    if(!location_ids.length){this.$("status").textContent="Mindestens einen Standort wählen.";return;}
    this.action("create_item",{name,unit:this.$("unit").value.trim()||"Stück",
      category_id:this.$("category").value,manufacturer:this.$("manufacturer").value.trim(),
      product_name:this.$("product-name").value.trim(),location_ids},()=>{
        this.$("name").value="";this.$("manufacturer").value="";this.$("product-name").value="";
        for(const cb of this.$("new-locations").querySelectorAll("input"))cb.checked=false;
      });
  }
  createLocation(){
    const code=this.$("code").value.trim(),name=this.$("locname").value.trim();
    if(!code||!name){this.$("status").textContent="Kürzel und Namen angeben.";return;}
    this.action("create_location",{code,name},
      ()=>{this.$("code").value="";this.$("locname").value="";this.$("location-preset").value="";},"location-status");
  }
  policy(){
    const item_id=this.$("item").value,location_id=this.$("loc").value;
    const min_quantity=Number(this.$("min").value),target_quantity=Number(this.$("target").value);
    if(!item_id||!location_id||!Number.isSafeInteger(min_quantity)||min_quantity<0||
      !Number.isSafeInteger(target_quantity)||target_quantity<min_quantity){
      this.$("status").textContent="Artikel, Standort und gültige Mindest-/Sollwerte erforderlich.";return;
    }
    this.action("set_stock_policy",{item_id,location_id,min_quantity,target_quantity,reorder_multiple:1},null,"policy-status");
  }
  async removeItem(){
    const item=this.data.items.find(x=>x.id===this.$("delete-item").value);
    if(!item){this.$("status").textContent="Artikel auswählen.";return;}
    const confirmation="DELETE:"+item.sku;
    if(window.prompt("Artikel "+item.name+" inklusive aller Bestände und Buchungen löschen?\nZum Bestätigen genau "+confirmation+" eingeben:")!==confirmation)
      return;
    if(!window.confirm("Letzte Warnung: "+item.name+" wirklich unwiderruflich löschen?")) return;
    await this.action("delete_item",{item_id:item.id,confirmation});
  }
  async resetStock(){
    if(window.prompt("ALLE BESTÄNDE UND BUCHUNGEN LÖSCHEN! Artikel und Standorte bleiben.\nGenau BESTAND LOESCHEN eingeben:")!=="BESTAND LOESCHEN")return;
    if(!window.confirm("Letzte Warnung: Gesamten Bestand tatsächlich zurücksetzen?"))return;
    await this.action("reset_stock",{confirmation:"BESTAND LOESCHEN"});
  }
}


class InventoryAreaCapture extends InventoryBase {
  render() {
    this.innerHTML='<ha-card header="Inventurbereiche · Sammelerfassung"><div class="body">'
      + '<p class="hint">Ein QR-Code öffnet eine komplette Schublade oder ein Regal. Nur die zugeordneten Artikel erscheinen.</p>'
      + '<label>Inventurbereich<select id="area-select"></select></label>'
      + '<button id="reload" type="button">Bestände neu laden</button>'
      + '<button id="photo" type="button">Bereichs-QR über Foto scannen</button>'
      + '<input id="qr-file" type="file" accept="image/*" capture="environment" hidden />'
      + '<div id="area-desc" class="hint"></div><div id="group-items"></div>'
      + '<label>Bemerkung (optional)<input id="group-note" maxlength="180" /></label>'
      + '<button id="submit">Inventur prüfen</button>'
      + '<div id="preview" class="hint"></div>'
      + '<div id="status" class="status" role="status" aria-live="polite"></div>'
      + '</div></ha-card><style>'+css+'</style>';
    this.$("area-select").onchange=()=>{this._lineSignature="";this._pending=null;this.update();};
    this.$("reload").onclick=()=>{this._lineSignature="";this._pending=null;this.refreshFromServer("status");};
    this.$("photo").onclick=()=>this.$("qr-file").click();
    this.$("qr-file").onchange=e=>this.scanFile(e.target.files?.[0]);
    this.$("submit").onclick=()=>this.saveGroup();
    this.refreshFromServer("status");
  }
  update(){
    if(!this._ready)return;
    const {areas,locations,categories,items,stock}=this.data;
    const active=areas.filter(a=>a.active!==false);
    const choice=this.$("area-select");
    refill(choice,active.map(a=>({
      id:a.id,name:(locations.find(x=>x.id===a.location_id)?.name||"?")
        +" · "+a.name,
    })),"name");
    const qs=new URLSearchParams(window.location.search);
    const direct=qs.get("inventory_area");
    if(!this._deepLinkSelected&&direct&&active.some(a=>a.id===direct)){
      choice.value=direct;this._deepLinkSelected=true;
    }
    const area=active.find(a=>a.id===choice.value);
    this.$("area-desc").textContent=area
      ? "Standort: "+(locations.find(x=>x.id===area.location_id)?.name||"?")+
        " · Kategorie: "+(categories.find(x=>x.id===area.category_id)?.name||"?")
      : "Bereich auswählen. Inventurbereiche werden unter Verwaltung angelegt.";
    const sig=(area?.id||"")+":"+JSON.stringify(
      (area?.item_ids||[]).map(id=>[id,stock.find(x=>x.item_id===id&&x.location_id===area.location_id)]));
    if(this._lineSignature===sig)return;
    this._lineSignature=sig;
    const wrapper=this.$("group-items");wrapper.replaceChildren();
    this._pending=null;
    if(!area)return;
    for(const id of area.item_ids){
      const item=items.find(x=>x.id===id);
      if(!item)continue;
      const previous=stock.find(x=>x.item_id===id&&x.location_id===area.location_id);
      const row=el("section",null,wrapper);
      el("b",item.name+" ("+item.sku+")",row);
      el("div","Buchbestand: "+(previous?.quantity??0)+" "+
        (item.unit||"Stück")+(previous?.counted?"":" · noch nicht gezählt"),row,"hint");
      const label=el("label","Istbestand",row);
      const input=el("input",null,label);
      input.type="number";input.step="1";input.min="0";input.max="1000000";
      input.dataset.itemId=id;
      input.value=previous ? String(previous.quantity):"";
      input.placeholder="Noch nicht gezählt";
      input.oninput=()=>{this._pending=null;this.$("submit").textContent="Inventur prüfen";this.$("preview").textContent="";};
    }
  }
  async scanFile(file){
    if(!file)return;
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      const factor=Math.min(1,1300/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(img.naturalWidth*factor);
      canvas.height=Math.round(img.naturalHeight*factor);
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      const frame=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height);
      const decoded=window.jsQR?.(frame.data,frame.width,frame.height,
        {inversionAttempts:"attemptBoth"})?.data;
      if(!decoded)throw Error("Kein QR-Code erkannt");
      const link=new URL(decoded);
      const route=(this.config?.capture_path||DEFAULT_CAPTURE_PATH).replace(/\/$/,"");
      if(!["http:","https:"].includes(link.protocol)||
         link.pathname.replace(/\/$/,"")!==route)throw Error("Kein Mittelhof-QR-Link");
      const areaId=link.searchParams.get("inventory_area");
      if(!this.data.areas.some(a=>a.id===areaId))throw Error("Bereich existiert nicht");
      this.$("area-select").value=areaId;
      this._lineSignature="";this.update();
      this.$("status").textContent="Bereich erkannt. Mengen prüfen und eintragen.";
    }catch(err){this.$("status").textContent="QR-Fehler: "+(err?.message||err);}
    finally {URL.revokeObjectURL(url);this.$("qr-file").value="";}
  }
  async saveGroup(){
    if(this._busy)return;
    const area=this.data.areas.find(a=>a.id===this.$("area-select").value);
    if(!area){this.$("status").textContent="Inventurbereich auswählen.";return;}
    const stock=this.data.stock;
    const counts=[];
    for(const input of this.$("group-items").querySelectorAll("input[data-item-id]")){
      const raw=input.value.trim();
      if(!raw)continue; // uncounted rows remain unknown, not silently zero
      const q=Number(raw);
      if(!Number.isSafeInteger(q)||q<0||q>1000000){
        this.$("status").textContent="Ungültige Menge bei "+input.dataset.itemId;return;
      }
      const item_id=input.dataset.itemId;
      const previous=stock.find(x=>x.item_id===item_id&&x.location_id===area.location_id);
      counts.push({item_id,quantity:q,
        expected_quantity:previous?.quantity??0,
        expected_counted:!!previous?.counted});
    }
    if(!counts.length){this.$("status").textContent="Mindestens eine Menge eintragen.";return;}
    const fingerprint=JSON.stringify({area_id:area.id,counts,note:this.$("group-note").value});
    if(this._pending?.fingerprint!==fingerprint){
      this._pending={fingerprint, payload:{area_id:area.id,counts,
        idempotency_key:newTransactionId(),note:this.$("group-note").value}};
      const changes=counts.filter(x=>x.quantity!==x.expected_quantity||!x.expected_counted).length;
      this.$("preview").textContent=counts.length+" Positionen zur Inventur; "+
        changes+" neu/abweichend. Bitte Werte kontrollieren und erneut bestätigen.";
      this.$("submit").textContent="Inventur jetzt verbindlich speichern";
      this.$("status").textContent="Noch nichts gespeichert.";
      return;
    }
    const payload=this._pending.payload;
    const ok=await this.action("count_area",payload,(reply,fresh)=>{
      this._lineSignature="";this._pending=null;
      this.$("preview").textContent="";
      this.$("submit").textContent="Inventur prüfen";
    });
    if(ok)this.$("status").textContent="Inventur gespeichert und rückgelesen: "+
      counts.length+" Positionen, Inventurbereich "+area.name+".";
  }
}

class InventoryStructureAdmin extends InventoryBase {
  render(){
    this.innerHTML='<ha-card header="Kategorien, Inventurbereiche und Standorte"><div class="body">'
      + '<section><h3>Kategorien</h3>'
      + '<label>Neue Kategorie<input id="new-category" placeholder="z. B. Besteck" /></label>'
      + '<button id="create-category">Kategorie hinzufügen</button>'
      + '<label>Bestehende Kategorie<select id="category"></select></label>'
      + '<label>Name bearbeiten<input id="category-name" /></label>'
      + '<button id="save-category">Kategorie umbenennen</button>'
      + '<label>Zum Löschen genau DELETE_CATEGORY:&lt;Name&gt; eingeben'
      + '<input id="category-confirm" placeholder="DELETE_CATEGORY:Name" /></label>'
      + '<button id="delete-category" class="danger">Unbenutzte Kategorie löschen</button>'
      + '<div id="category-status" class="status" role="status"></div></section>'
      + '<section><h3>Inventurbereich anlegen / bearbeiten</h3>'
      + '<label>Inventurbereich<select id="area"></select></label>'
      + '<label>Name des Bereichs<input id="area-name" placeholder="z. B. Besteckschublade" /></label>'
      + '<div class="row"><label>Standort<select id="area-location"></select></label>'
      + '<label>Kategorie<select id="area-category"></select></label></div>'
      + '<div class="hint">Nur am Standort geführte Artikel der Kategorie auswählen; '
      + 'pro Standort kann ein Artikel nur in einem Bereich geführt werden.</div>'
      + '<div id="area-items"></div>'
      + '<button id="save-area">Inventurbereich speichern</button>'
      + '<label>Zum Löschen genau DELETE_AREA:&lt;Name&gt; eingeben'
      + '<input id="area-confirm" placeholder="DELETE_AREA:Name" /></label>'
      + '<button id="delete-area" class="danger">Inventurbereich löschen</button>'
      + '<div id="area-status" class="status" role="status"></div></section>'
      + '<section><h3>QR-Etiketten für Inventurbereiche</h3>'
      + '<label>Vom Handy erreichbare Home-Assistant-Adresse'
      + '<input id="qr-base" /></label>'
      + '<label>Standortfilter<select id="qr-filter"></select></label>'
      + '<button id="print-area">Bereichs-QR-Etiketten drucken</button>'
      + '<div id="qr-status" class="status"></div></section>'
      + '<section><h3>Standort entfernen</h3>'
      + '<p class="hint">Nur Standorte ohne positiven Bestand können entfernt werden. '
      + 'Sie verschwinden aus der Auswahl; alte Buchungen bleiben als Historie erhalten.</p>'
      + '<label>Standort<select id="delete-location"></select></label>'
      + '<div id="delete-location-info" class="hint"></div>'
      + '<label>Bestätigung DELETE_LOCATION:&lt;Kürzel&gt;'
      + '<input id="location-confirm" placeholder="DELETE_LOCATION:KÜRZEL" /></label>'
      + '<button id="remove-location" class="danger">Standort entfernen</button>'
      + '<div id="location-status" class="status" role="status"></div></section>'
      + '</div></ha-card><style>'+css+'</style>';
    for(const [id,fn] of [
      ["create-category",()=>this.createCategory()],
      ["save-category",()=>this.editCategory()],
      ["delete-category",()=>this.deleteCategory()],
      ["save-area",()=>this.saveArea()],
      ["delete-area",()=>this.deleteArea()],
      ["print-area",()=>this.printAreas()],
      ["remove-location",()=>this.deleteLocation()]])
      this.$(id).onclick=fn;
    this.$("category").onchange=()=>{
      const c=this.data.categories.find(x=>x.id===this.$("category").value);
      this.$("category-name").value=c?.name||"";
    };
    this.$("area").onchange=()=>this.loadArea();
    this.$("area-location").onchange=()=>this.renderAreaItems();
    this.$("area-category").onchange=()=>this.renderAreaItems();
    this.$("delete-location").onchange=()=>this.showLocationQty();
    this.$("qr-base").value=window.location.origin;
    this.refreshFromServer();
  }
  update(){
    if(!this._ready)return;
    const {categories,areas,locations}=this.data;
    const categoriesActive=categories.filter(x=>x.active!==false);
    refill(this.$("category"),categoriesActive,"name");
    refill(this.$("area-category"),categoriesActive,"name");
    refill(this.$("area-location"),locations,"name");
    refill(this.$("delete-location"),locations,"name");
    refill(this.$("qr-filter"),[{id:"",name:"Alle Standorte"},...locations],"name");
    refill(this.$("area"),[{id:"",name:"— Neuen Bereich anlegen —"},...areas],"name");
    this.$("category-name").value=
      categories.find(x=>x.id===this.$("category").value)?.name||"";
    this.loadArea();
    this.showLocationQty();
  }
  loadArea(){
    const area=this.data.areas.find(a=>a.id===this.$("area").value);
    if(area?.id===this._loadedAreaId)return;
    this._loadedAreaId=area?.id||"";
    this.$("area-name").value=area?.name||"";
    this.$("area-location").value=area?.location_id||"";
    this.$("area-category").value=area?.category_id||"";
    this.renderAreaItems();
  }
  renderAreaItems(){
    const {items,areas}=this.data;
    const box=this.$("area-items");box.replaceChildren();
    const category=this.$("area-category").value;
    const location=this.$("area-location").value;
    const current=this.$("area").value;
    const active=items.filter(i=>i.category_id===category &&
      (i.location_ids||[]).includes(location) &&
      !areas.some(a=>a.id!==current&&a.location_id===location&&a.item_ids.includes(i.id)));
    for(const item of active){
      const label=el("label",null,box);
      const checkbox=el("input",null,label);
      checkbox.type="checkbox";checkbox.value=item.id;checkbox.style.width="auto";
      checkbox.checked=!!areas.find(a=>a.id===current)?.item_ids.includes(item.id);
      label.append(" "+item.sku+" – "+item.name);
    }
    if(!active.length)el("div","Keine frei zuordnungsfähigen Artikel dieser Kategorie am gewählten Standort.",box,"hint");
  }
  showLocationQty(){
    const id=this.$("delete-location").value;
    const loc=this.data.locations.find(x=>x.id===id);
    const rows=this.data.stock.filter(x=>x.location_id===id&&x.quantity>0);
    const sum=rows.reduce((a,b)=>a+b.quantity,0);
    this.$("delete-location-info").textContent=loc?
      (sum?"Noch "+sum+" Einheiten in "+rows.length+" Bestandspositionen. Zuerst umlagern.":"Kein positiver Bestand. Löschen möglich.")
      :"Standort auswählen.";
  }
  createCategory(){
    const name=this.$("new-category").value.trim();
    if(!name){this.$("category-status").textContent="Name fehlt.";return;}
    this.action("create_category",{name},()=>{
      this.$("new-category").value="";
    },"category-status");
  }
  editCategory(){
    const category_id=this.$("category").value,name=this.$("category-name").value.trim();
    if(!category_id||!name){this.$("category-status").textContent="Kategorie und Name fehlen.";return;}
    this.action("update_category",{category_id,name,active:true},null,"category-status");
  }
  deleteCategory(){
    const c=this.data.categories.find(x=>x.id===this.$("category").value);
    if(!c||this.$("category-confirm").value!=="DELETE_CATEGORY:"+c.name){
      this.$("category-status").textContent="Bestätigung stimmt nicht.";return;
    }
    this.action("delete_category",{category_id:c.id,confirmation:this.$("category-confirm").value},
      ()=>{this.$("category-confirm").value="";},"category-status");
  }
  saveArea(){
    const id=this.$("area").value;
    const name=this.$("area-name").value.trim(),location_id=this.$("area-location").value;
    const category_id=this.$("area-category").value;
    const item_ids=[...this.$("area-items").querySelectorAll("input:checked")].map(x=>x.value);
    if(!name||!location_id||!category_id||!item_ids.length){
      this.$("area-status").textContent="Name, Standort, Kategorie und mindestens ein Artikel erforderlich.";return;
    }
    const action=id?"update_area":"create_area";
    const payload={name,location_id,category_id,item_ids};
    if(id)payload.area_id=id;
    this.action(action,payload,()=>{
      this._loadedAreaId=null;
    },"area-status");
  }
  deleteArea(){
    const area=this.data.areas.find(x=>x.id===this.$("area").value);
    if(!area||this.$("area-confirm").value!=="DELETE_AREA:"+area.name){
      this.$("area-status").textContent="Bitte DELETE_AREA:<Name> exakt eingeben.";return;
    }
    this.action("delete_area",{area_id:area.id,confirmation:this.$("area-confirm").value},()=>{
      this.$("area-confirm").value="";this._loadedAreaId=null;
    },"area-status");
  }
  printAreas(){
    try{
      const {areas,locations}=this.data;
      const base=this.$("qr-base").value.trim(),filter=this.$("qr-filter").value;
      const rows=areas.filter(a=>!filter||a.location_id===filter).map(a=>({
        name:(locations.find(x=>x.id===a.location_id)?.name||"?")+" · "+a.name,
        sub:a.item_ids.length+" Artikel",
        url:makeCaptureUrl(base,this.config?.capture_path||DEFAULT_CAPTURE_PATH,
          {inventory_area:a.id})
      }));
      printLabels(rows);
      this.$("qr-status").textContent=rows.length+" Inventurbereich-Etiketten vorbereitet.";
    }catch(err){this.$("qr-status").textContent=err?.message||String(err);}
  }
  deleteLocation(){
    const loc=this.data.locations.find(x=>x.id===this.$("delete-location").value);
    if(!loc||this.$("location-confirm").value!=="DELETE_LOCATION:"+loc.code){
      this.$("location-status").textContent="Bitte DELETE_LOCATION:<Kürzel> exakt eingeben.";return;
    }
    this.action("delete_location",{
      location_id:loc.id,confirmation:this.$("location-confirm").value
    },()=>{this.$("location-confirm").value="";},"location-status");
  }
}

const all = [
  ["mittelhof-inventory-overview",InventoryOverview],
  ["mittelhof-inventory-capture",InventoryCapture],
  ["mittelhof-inventory-admin",InventoryAdmin],
  ["mittelhof-inventory-area-capture",InventoryAreaCapture],
  ["mittelhof-inventory-structure-admin",InventoryStructureAdmin],
  ["mittelhof-inventory-card",InventoryCapture],  // Backwards-compatible dashboard alias.
];
for(const [name,kind] of all){
  if(!customElements.get(name))customElements.define(name,kind);
}
window.customCards=window.customCards||[];
for(const [name] of all){
  if(!window.customCards.some(x=>x.type===name))window.customCards.push({type:name,name});
}
