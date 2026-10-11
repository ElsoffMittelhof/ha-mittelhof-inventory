import "./vendor/qrgen.js";
import "./vendor/jsQR.js";

/* Mittelhof Inventar 0.9.1 – local-only HA cards. No remote QR endpoints. */
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
    return this._verifiedData || {
      items: this.records("artikel", "items_entity"),
      locations: this.records("standorte", "locations_entity"),
      stock: this.records("bestandspositionen", "stock_entity"),
      suggestions: this.records("fehlbestande", "suggestions_entity"),
    };
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
      if (success) success(reply, fresh);
      this.update();
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
        expected_quantity:prev,idempotency_key:crypto.randomUUID(),note},()=>this.afterSuccess());
    } else {
      const from=type==="transfer"?src:(type==="consume"?loc:undefined);
      const to=type==="transfer"?dst:(type==="receipt"?loc:undefined);
      if((type==="transfer"&&(!from||!to||from===to)) || (type!=="transfer"&&!loc)){
        this.$("status").textContent="Gültige Standorte wählen.";return;
      }
      await this.action("book_transaction",{kind:type,item_id:id,
        from_location_id:from,to_location_id:to,quantity:q,
        idempotency_key:crypto.randomUUID(),note},()=>this.afterSuccess());
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
      + '<label>Kategorie<select id="category"><option>Allgemein</option><option>Geschirr</option>'
      + '<option>Verbrauchsmaterial</option><option>Reinigungsmittel</option>'
      + '<option>Werkzeug</option><option>Gartengerät</option></select></label></div>'
      + '<div class="hint">Artikel an diesen Standorten führen:</div>'
      + '<div id="new-locations"></div>'
      + '<button id="additem">Artikel anlegen</button></section>'
      + '<section><h3>Artikel-Standorte bearbeiten</h3>'
      + '<label>Artikel<select id="assigned-item"></select></label>'
      + '<div id="assignment-list"></div>'
      + '<button id="save-assignment">Zuordnung speichern</button>'
      + '<div class="hint">Standorte mit Bestand können nicht entfernt werden.</div></section>'
      + '<section><h3>Standort anlegen</h3><div class="row"><label>Kürzel<input id="code"></label>'
      + '<label>Name<input id="locname"></label></div><button id="addloc">Standort anlegen</button></section>'
      + '<section><h3>Mindest- und Sollbestand</h3><div class="row">'
      + '<label>Artikel<select id="item"></select></label><label>Standort<select id="loc"></select></label>'
      + '<label>Minimum<input id="min" type="number" min="0" value="2"></label>'
      + '<label>Soll<input id="target" type="number" min="0" value="10"></label></div>'
      + '<button id="policy">Regel speichern</button>'
      + '<div id="policy-status" class="status" role="status" aria-live="polite"></div></section>'
      + '<section><h3>QR-Etiketten drucken</h3><div class="hint">'
      + 'QR-Link öffnet die Erfassung. Keine Zugangsdaten enthalten. A4-Vorlage für Avery L4773 (63,5 × 33,9 mm; 24 Etiketten/Bogen). Mit 100 % und ohne Skalierung drucken.'
      + '</div><label>Erreichbare Home-Assistant-Adresse'
      + '<input id="base" placeholder="https://mein-home-assistant.example" /></label>'
      + '<label>Standortfilter<select id="group"><option value="">Alle Standorte</option></select></label>'
      + '<div class="hint">Ein QR-Etikett pro aktiver Artikel-Standort-Kombination.</div>'
      + '<button id="print">QR-Etikettenbogen öffnen</button></section>'
      + '<section><h3>Testdaten löschen</h3>'
      + '<div class="hint">Nur Administratoren. Vorher HA-Backup erstellen. Löschen ist unwiderruflich.</div>'
      + '<label>Einzelnen Artikel vollständig löschen<select id="delete-item"></select></label>'
      + '<button id="delete" class="danger">Artikel inklusive Beständen löschen</button>'
      + '<p class="hint">Gesamtbestand zurücksetzen löscht alle Mengen, Inventurmarkierungen und'
      + ' Bewegungen. Artikel und Standorte bleiben erhalten.</p>'
      + '<button id="reset" class="danger">Gesamtbestand zurücksetzen</button></section>'
      + '<div id="status" class="status" role="status"></div></div></ha-card><style>'+css+'</style>';
    this.$("additem").onclick=()=>this.createItem();
    this.$("addloc").onclick=()=>this.createLocation();
    this.$("policy").onclick=()=>this.policy();
    this.$("assigned-item").onchange=()=>{this._editorSignature="";this.renderAssignments();};
    this.$("save-assignment").onclick=()=>this.saveAssignments();
    this.$("print").onclick=()=>this.labels();
    this.$("delete").onclick=()=>this.removeItem();
    this.$("reset").onclick=()=>this.resetStock();
    this.$("base").value=window.location.origin;
  }
  update(){
    if(!this._ready)return;
    const {items,locations}=this.data;
    refill(this.$("item"),items,"name");
    refill(this.$("delete-item"),items,"name");
    refill(this.$("assigned-item"),items,"name");
    refill(this.$("loc"),locations,"name");
    refill(this.$("group"),[{id:"",name:"Alle Standorte"},...locations],"name");
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
      category:this.$("category").value,location_ids},()=>{
        this.$("name").value="";
        for(const cb of this.$("new-locations").querySelectorAll("input"))cb.checked=false;
      });
  }
  createLocation(){
    const code=this.$("code").value.trim(),name=this.$("locname").value.trim();
    if(!code||!name){this.$("status").textContent="Kürzel und Namen angeben.";return;}
    this.action("create_location",{code,name},
      ()=>{this.$("code").value="";this.$("locname").value="";});
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
  labels(){
    try{
      const {items,locations}=this.data;
      const capturePath=this.config?.capture_path||DEFAULT_CAPTURE_PATH;
      const base=this.$("base").value.trim();
      const filter=this.$("group").value;
      const rows=items.flatMap(item=>locations.filter(loc=>
        (item.location_ids||[]).includes(loc.id)&&(!filter||filter===loc.id))
        .map(loc=>({
          name:loc.name+" · "+item.name,
          sub:item.sku+" · "+loc.code,
          url:makeCaptureUrl(base,capturePath,{inventory_item:item.id,inventory_location:loc.id})
        })));
      printLabels(rows);
      this.$("status").textContent=rows.length+" Kombinationen als QR-Bogen geöffnet. Cmd/Ctrl+P drucken.";
    }catch(e){this.$("status").textContent="QR-Fehler: "+(e?.message||e);}
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

const all = [
  ["mittelhof-inventory-overview",InventoryOverview],
  ["mittelhof-inventory-capture",InventoryCapture],
  ["mittelhof-inventory-admin",InventoryAdmin],
  ["mittelhof-inventory-card",InventoryCapture],  // Backwards-compatible dashboard alias.
];
for(const [name,kind] of all){
  if(!customElements.get(name))customElements.define(name,kind);
}
window.customCards=window.customCards||[];
for(const [name] of all){
  if(!window.customCards.some(x=>x.type===name))window.customCards.push({type:name,name});
}
