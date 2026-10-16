import "./vendor/qrgen.js";
import "./vendor/jsQR.js";
/* Mittelhof Inventar v2.1.0: physical-area stock, no old-area aliases. */
const ROUTE="/inventar-dashboard/erfassung";
const empty=()=>({items:[],categories:[],locations:[],templates:[],instances:[],stock:[]});
const css=".body{padding:8px 16px 18px}section{padding:10px 0;border-top:1px solid var(--divider-color)}label{display:block;margin:8px 0 4px}input:not([type=checkbox]),select{width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--divider-color);border-radius:6px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}button{background:var(--primary-color);color:white;border:0;border-radius:6px;padding:10px;margin:7px 6px 5px 0;cursor:pointer}button.danger{background:var(--error-color,#b22)}.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:5px}.checks label{margin:0}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px}.hint{font-size:.88rem;color:var(--secondary-text-color)}.status{min-height:18px;margin:7px 0}table{width:100%;border-collapse:collapse}td,th{padding:7px;border-bottom:1px solid var(--divider-color);text-align:left}.scroll{overflow-x:auto}.entry{display:grid;grid-template-columns:minmax(140px,1fr) 100px;gap:12px;align-items:center;margin:6px 0}";
function dom(tag,text,parent,cls){const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;if(parent)parent.appendChild(e);return e;}
function options(sel,rows,placeholder="Bitte wählen"){const sig=JSON.stringify(rows);if(sig===sel.dataset.sig)return;const old=sel.value;sel.replaceChildren(new Option(placeholder,""));for(const r of rows)sel.add(new Option(r.name,r.id));sel.value=rows.some(r=>r.id===old)?old:"";sel.dataset.sig=sig;}
function serial(){if(globalThis.crypto?.getRandomValues){const b=new Uint8Array(16);globalThis.crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");}return Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);}
function instName(d,a){return (d.templates.find(t=>t.id===a.template_id)?.name||"?")+(a.label?" ("+a.label+")":"")+" · "+(d.locations.find(l=>l.id===a.location_id)?.name||"?");}
function checkList(root,rows,selected=[]){root.replaceChildren();for(const row of rows){const label=dom("label",null,root),cb=dom("input",null,label);cb.type="checkbox";cb.value=row.id;cb.checked=selected.includes(row.id);label.append(" "+row.name);}}
function chosen(root){return [...root.querySelectorAll("input:checked")].map(x=>x.value);}
function qrSVG(content){const q=window.qrgen.QrCode.encodeText(content,window.qrgen.QrCode.Ecc.HIGH),p=[],m=4;for(let y=0;y<q.size;y++)for(let x=0;x<q.size;x++)if(q.getModule(x,y))p.push("M"+(x+m)+","+(y+m)+"h1v1h-1z");const z=q.size+8;return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+z+' '+z+'"><rect width="'+z+'" height="'+z+'" fill="white"/><path d="'+p.join(" ")+'" fill="black"/></svg>';}
function safe(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function printLabels(d,base,areas){if(!areas.length)throw Error("Keine Bereiche ausgewählt");const root=new URL(base);if(!["http:","https:"].includes(root.protocol))throw Error("Ungültige URL");const w=window.open("","_blank");if(!w)throw Error("Pop-up blockiert");let pages="";for(let start=0;start<areas.length;start+=24){const labels=areas.slice(start,start+24).map(a=>{const link=new URL(ROUTE,root);link.searchParams.set("inventory_instance",a.id);return '<div class="label">'+qrSVG(link.toString())+'<span>'+safe(instName(d,a))+'</span></div>';}).join("");pages+='<div class="sheet"><div class="grid">'+labels+'</div></div>';}w.document.open();w.document.write('<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{font-family:Arial;margin:0}.sheet{height:297mm;break-after:page}.grid{display:grid;margin:12.9mm 9.75mm;grid-template-columns:repeat(3,63.5mm);grid-auto-rows:33.9mm}.label{display:flex;align-items:center;box-sizing:border-box;padding:2mm;overflow:hidden;font-size:8pt}.label svg{width:26mm;height:26mm;flex-shrink:0}.label span{padding-left:2mm;overflow-wrap:anywhere}</style></head><body>'+pages+'</body></html>');w.document.close();}
function aggregate(d,selected,category){const items=new Map(d.items.map(x=>[x.id,x])),rows=new Map();for(const r of d.stock){const item=items.get(r.item_id);if(!selected.has(r.location_id)||!item||(category&&item.category_id!==category))continue;let x=rows.get(item.id);if(!x){x={item,count:0,unknown:0};rows.set(item.id,x);}r.counted?x.count+=r.quantity:x.unknown++;}return [...rows.values()].sort((a,b)=>a.item.sku.localeCompare(b.item.sku,"de"));}

/* Compare corresponding logical-area templates across physical locations.
   Every physical instance contributes its own quantity exactly once. */
function compareAreas(d,templateId,siteIds,categoryId=""){
  const items=new Map(d.items.map(i=>[i.id,i]));
  const records=new Map(d.stock.map(r=>[r.item_id+"|"+r.instance_id,r]));
  const columns=d.locations.filter(l=>siteIds.has(l.id)).map(site=>({
    site,instances:d.instances.filter(a=>a.location_id===site.id&&a.template_id===templateId)
  }));
  const found=new Set();
  for(const col of columns)for(const area of col.instances)
    for(const rec of d.stock.filter(r=>r.instance_id===area.id)){
      const item=items.get(rec.item_id);
      if(item&&(!categoryId||item.category_id===categoryId))found.add(item.id);
    }
  const rows=[...found].map(id=>{
    const item=items.get(id);
    const cells=columns.map(col=>{
      if(!col.instances.length)return {state:"area_missing",quantity:null,uncounted:0};
      let quantity=0,uncounted=0,assigned=0;
      for(const area of col.instances){
        const rec=records.get(id+"|"+area.id);
        if(!rec)continue;
        assigned++;
        if(rec.counted)quantity+=rec.quantity;
        else uncounted++;
      }
      if(!assigned)return {state:"not_assigned",quantity:null,uncounted:0};
      return {state:uncounted?(uncounted===assigned?"uncounted":"partial"):"counted",
        quantity:uncounted===assigned?null:quantity,uncounted,assigned};
    });
    const assigned=cells.filter(c=>["counted","partial","uncounted"].includes(c.state));
    const unknown=cells.some(c=>["area_missing","partial","uncounted"].includes(c.state));
    const knownQuantities=cells.filter(c=>c.state==="counted").map(c=>c.quantity);
    let status="equal",reason="Gleich";
    if(cells.some(c=>c.state==="area_missing")){
      status="area_missing";reason="Bereich fehlt an Standort";
    }else if(unknown){
      status="incomplete";reason="Inventur unvollständig";
    }else if(columns.length>1&&cells.filter(c=>c.state==="counted"&&c.quantity>0).length===1){
      const where=cells.findIndex(c=>c.state==="counted"&&c.quantity>0);
      status="only_stock";
      reason="Bestand nur in "+columns[where].site.name;
    }else if(assigned.length<columns.length){
      status="missing";
      reason="Nicht überall zugeordnet";
    }else if(new Set(knownQuantities).size>1){
      status="different";reason="Mengenabweichung";
    }
    return {item,cells,status,reason};
  }).sort((a,b)=>a.item.name.localeCompare(b.item.name,"de"));
  return {columns,rows};
}


function matchingCategoryItems(items,categoryIds){
  return items.filter(item=>categoryIds.has(item.category_id))
    .sort((a,b)=>a.name.localeCompare(b.name,"de"));
}
function changeAssignmentDraft(draft,itemId,checked){
  const next=new Set(draft);
  if(checked)next.add(itemId);
  else next.delete(itemId);
  return next;
}

class Base extends HTMLElement{
  setConfig(c){this.config=c||{};}
  set hass(h){this._hass=h;if(!this._ready){this.render();this._ready=true;this.refresh();}}
  $(id){return this.querySelector("#"+id);}
  getCardSize(){return 10;}
  get data(){return this._data||empty();}
  status(id,text,error=false){const e=this.$(id);if(e){e.textContent=text;e.style.color=error?"var(--error-color,#b22)":"var(--primary-text-color)";}}
  async refresh(){try{this._data=await this._hass.connection.sendMessagePromise({type:"mittelhof_inventory/read"});this.update();}catch(e){this.status("status","Lesefehler: "+(e.message||e),true);}}
  async run(action,data,id="status",done){if(this._busy)return false;this._busy=true;this.status(id,"Speichere …");try{const r=await this._hass.connection.sendMessagePromise({type:"mittelhof_inventory/execute",action,data});if(!r?.saved||!r.snapshot)throw Error("Keine Speicherquittung");this._data=r.snapshot;if(done)done(r.result);this.update();this.status(id,"Gespeichert und rückgelesen.");return true;}catch(e){this.status(id,"Fehler: "+(e.message||e),true);return false;}finally{this._busy=false;}}
}
class Overview extends Base{
  render(){this.innerHTML='<ha-card header="Inventarübersicht"><div class="body"><div id="sites" class="checks"></div><button id="all">Alle Standorte</button><button id="none">Keine</button><label>Kategorie<select id="category"></select></label><p id="info" class="hint"></p><div id="groups"></div><section><h3>Artikel-Gesamtbestände (gefiltert)</h3><div id="totals" class="scroll"></div></section><div id="status" class="status"></div></div></ha-card><style>'+css+'</style>';this.$("all").onclick=()=>{this._manual=true;this._selected=new Set(this.data.locations.map(x=>x.id));this.update();};this.$("none").onclick=()=>{this._manual=true;this._selected=new Set();this.update();};this.$("category").onchange=()=>this.update();}
  update(){if(!this._ready)return;const d=this.data;if(!this._manual)this._selected=new Set(d.locations.map(x=>x.id));else this._selected=new Set([...this._selected].filter(id=>d.locations.some(x=>x.id===id)));const site=this.$("sites"),sig=JSON.stringify(d.locations);if(site.dataset.sig!==sig){site.dataset.sig=sig;checkList(site,d.locations);for(const cb of site.querySelectorAll("input"))cb.onchange=()=>{this._manual=true;cb.checked?this._selected.add(cb.value):this._selected.delete(cb.value);this.update();};}for(const cb of site.querySelectorAll("input"))cb.checked=this._selected.has(cb.value);options(this.$("category"),[{id:"",name:"Alle Kategorien"},...d.categories],"Alle Kategorien");const category=this.$("category").value,container=this.$("groups");container.replaceChildren();let physical=0,positions=0;for(const site of d.locations.filter(x=>this._selected.has(x.id))){const section=dom("section",null,container);dom("h3",site.name,section);for(const area of d.instances.filter(x=>x.location_id===site.id)){const found=d.stock.filter(r=>r.instance_id===area.id).filter(r=>!category||d.items.find(i=>i.id===r.item_id)?.category_id===category);if(category&&!found.length)continue;physical++;dom("h4",instName(d,area).split(" · ")[0],section);const table=dom("table",null,dom("div",null,section,"scroll")),head=dom("tr",null,table);["Artikel","Bestand"].forEach(x=>dom("th",x,head));for(const r of found){const item=d.items.find(x=>x.id===r.item_id);if(!item)continue;positions++;const tr=dom("tr",null,table);dom("td",item.sku+" · "+item.name,tr);dom("td",r.counted?r.quantity+" "+item.unit:"— nicht gezählt",tr);}if(!found.length)dom("p","Noch keine Artikel zugeordnet.",section,"hint");} }this.$("info").textContent=this._selected.size+" Standorte · "+physical+" physische Inventurbereiche · "+positions+" Artikelpositionen";const target=this.$("totals");target.replaceChildren();const totals=aggregate(d,this._selected,category);if(!totals.length){dom("p","Keine Bestandspositionen für diese Auswahl.",target);return;}const table=dom("table",null,target),head=dom("tr",null,table);["Artikel","Kategorie","Summe"].forEach(x=>dom("th",x,head));for(const x of totals){const tr=dom("tr",null,table);dom("td",x.item.sku+" · "+x.item.name,tr);dom("td",d.categories.find(c=>c.id===x.item.category_id)?.name||"—",tr);dom("td",x.count+" "+x.item.unit+(x.unknown?" ("+x.unknown+" noch nicht gezählt)":"") ,tr);}}
}
class Capture extends Base{
  render(){this.innerHTML='<ha-card header="Inventur und Bestandsbewegungen"><div class="body"><section><h3>Physischer Inventurbereich</h3><label>Bereich<select id="instance"></select></label><button id="reload">Bestände neu laden</button><div id="rows"></div><button id="count">Inventur prüfen</button><p id="preview" class="hint"></p><div id="status" class="status"></div></section><section><h3>QR-Code einlesen</h3><p class="hint">iPhone-Kamera: QR-Link öffnen. Alternativ QR-Foto wählen.</p><input id="photo" type="file" accept="image/*" capture="environment"/><div id="qr-status" class="status"></div></section><section><h3>Bewegung</h3><label>Art<select id="kind"><option value="receipt">Zugang</option><option value="consume">Entnahme</option><option value="transfer">Umlagerung</option></select></label><label>Artikel<select id="item"></select></label><div class="row"><label>Von<select id="from"></select></label><label>Nach<select id="to"></select></label></div><label>Menge<input id="qty" type="number" min="1" value="1"/></label><button id="move">Bewegung prüfen</button><div id="move-status" class="status"></div></section></div></ha-card><style>'+css+'</style>';this.$("instance").onchange=()=>{this._sig="";this._pending=null;this.update();};this.$("reload").onclick=()=>{this._sig="";this.refresh();};this.$("count").onclick=()=>this.count();this.$("photo").onchange=e=>this.scan(e.target.files?.[0]);this.$("move").onclick=()=>this.move();for(const id of ["kind","item"])this.$(id).onchange=()=>{this._movement=null;this.update();};}
  update(){if(!this._ready)return;const d=this.data,available=d.instances.map(x=>({id:x.id,name:instName(d,x)}));options(this.$("instance"),available);const linked=new URLSearchParams(window.location.search).get("inventory_instance");if(!this._deep&&linked&&d.instances.some(x=>x.id===linked)){this._deep=true;this.$("instance").value=linked;}const id=this.$("instance").value,rows=d.stock.filter(x=>x.instance_id===id),sig=id+JSON.stringify(rows);if(this._sig!==sig){this._sig=sig;this._pending=null;this.$("count").textContent="Inventur prüfen";const target=this.$("rows");target.replaceChildren();for(const rec of rows){const item=d.items.find(x=>x.id===rec.item_id);if(!item)continue;const row=dom("div",null,target,"entry"),label=dom("div",null,row);dom("strong",item.sku+" · "+item.name,label);dom("div",rec.counted?"Aktuell: "+rec.quantity+" "+item.unit:"Noch nicht gezählt",label,"hint");const input=dom("input",null,row);input.dataset.item=rec.item_id;input.type="number";input.min="0";input.max="1000000";input.value=rec.counted?rec.quantity:"";input.oninput=()=>{this._pending=null;this.$("count").textContent="Inventur prüfen";};}if(!rows.length)dom("p","Diesem Bereich sind noch keine Artikel zugeordnet.",target,"hint");this.$("preview").textContent="";}options(this.$("item"),d.items.map(x=>({id:x.id,name:x.sku+" · "+x.name})));const item=this.$("item").value,assigned=new Set(d.stock.filter(x=>x.item_id===item).map(x=>x.instance_id)),valid=available.filter(x=>assigned.has(x.id));options(this.$("from"),valid);options(this.$("to"),valid);this.$("from").disabled=this.$("kind").value==="receipt";this.$("to").disabled=this.$("kind").value==="consume";}
  async count(){const instance_id=this.$("instance").value;if(!instance_id)return this.status("status","Bereich wählen.",true);const counts=[];for(const e of this.$("rows").querySelectorAll("input[data-item]")){if(e.value.trim()==="")continue;const quantity=Number(e.value),rec=this.data.stock.find(x=>x.instance_id===instance_id&&x.item_id===e.dataset.item);if(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000)return this.status("status","Ungültige Menge.",true);counts.push({item_id:e.dataset.item,quantity,expected_quantity:rec?.quantity??0,expected_counted:!!rec?.counted});}if(!counts.length)return this.status("status","Mindestens eine Menge eingeben.",true);const fingerprint=JSON.stringify([instance_id,counts]);if(this._pending?.fingerprint!==fingerprint){this._pending={fingerprint,payload:{instance_id,counts,idempotency_key:serial()}};this.$("preview").textContent=counts.length+" Positionen prüfen; erneuter Klick speichert verbindlich.";this.$("count").textContent="Inventur verbindlich speichern";return;}await this.run("count_instance",this._pending.payload,"status",()=>{this._sig="";this._pending=null;this.$("preview").textContent="";this.$("count").textContent="Inventur prüfen";});}
  async move(){const kind=this.$("kind").value,item_id=this.$("item").value,quantity=Number(this.$("qty").value),from_instance_id=kind==="receipt"?null:this.$("from").value||null,to_instance_id=kind==="consume"?null:this.$("to").value||null;if(!item_id||!Number.isSafeInteger(quantity)||quantity<1||(kind!=="receipt"&&!from_instance_id)||(kind!=="consume"&&!to_instance_id)||(kind==="transfer"&&from_instance_id===to_instance_id))return this.status("move-status","Artikel, Menge und Bereiche prüfen.",true);const data={kind,item_id,quantity};if(from_instance_id)data.from_instance_id=from_instance_id;if(to_instance_id)data.to_instance_id=to_instance_id;const fingerprint=JSON.stringify(data);if(this._movement?.fingerprint!==fingerprint){this._movement={fingerprint,payload:{...data,idempotency_key:serial()}};this.$("move").textContent="Bewegung verbindlich buchen";this.status("move-status","Zweiter Klick bestätigt "+quantity+" Einheiten.");return;}await this.run("book_movement",this._movement.payload,"move-status",()=>{this._sig="";this._movement=null;this.$("move").textContent="Bewegung prüfen";});}
  async scan(file){if(!file)return;const blob=URL.createObjectURL(file);try{const img=new Image();img.src=blob;await img.decode();const scale=Math.min(1,1300/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),decoded=window.jsQR?.(pixels.data,pixels.width,pixels.height,{inversionAttempts:"attemptBoth"})?.data;if(!decoded)throw Error("Kein QR erkannt");const url=new URL(decoded);if(!["https:","http:"].includes(url.protocol)||url.pathname!==ROUTE)throw Error("Ungültiger Inventarlink");const id=url.searchParams.get("inventory_instance");if(!this.data.instances.some(x=>x.id===id))throw Error("Bereich existiert nicht");this.$("instance").value=id;this._sig="";this.update();this.status("qr-status","Bereich erkannt.");}catch(e){this.status("qr-status","QR-Fehler: "+(e.message||e),true);}finally{URL.revokeObjectURL(blob);this.$("photo").value="";}}
}
class Admin extends Base{
  render(){this.innerHTML='<ha-card header="Inventarverwaltung"><div class="body"><section><h3>Kategorien</h3><label>Neu<input id="cat-new"/></label><button id="cat-add">Hinzufügen</button><label>Vorhandene Kategorie<select id="cat"></select></label><label>Name<input id="cat-name"/></label><button id="cat-save">Umbenennen</button><button id="cat-delete" class="danger">Löschen</button><div id="cat-status" class="status"></div></section><section><h3>Artikelstamm</h3><p class="hint">Artikelnummer automatisch, keine Menge oder Pflichtstandort.</p><label>Artikel (leer = neu)<select id="item"></select></label><label>Name<input id="item-name"/></label><div class="row"><label>Kategorie<select id="item-cat"></select></label><label>Einheit<input id="unit" value="Stück"/></label></div><div class="row"><label>Hersteller<input id="manufacturer"/></label><label>Produktmodell<input id="model"/></label></div><button id="item-save">Artikel speichern</button><button id="item-delete" class="danger">Artikel löschen</button><div id="item-status" class="status"></div></section><section><h3>Standorte</h3><label>Standort (leer = neu)<select id="location"></select></label><div class="row"><label>Kürzel<input id="loc-code"/></label><label>Name<input id="loc-name"/></label></div><button id="loc-save">Standort speichern</button><button id="loc-delete" class="danger">Standort löschen</button><div id="loc-status" class="status"></div></section><section><h3>Logische Inventurbereiche</h3><label>Vorlage (leer = neu)<select id="template"></select></label><label>Name<input id="tpl-name"/></label><button id="tpl-save">Vorlage speichern</button><button id="tpl-delete" class="danger">Vorlage löschen</button><p class="hint">Vorlage mehreren Standorten zuweisen:</p><div id="tpl-sites" class="checks"></div><button id="assign">Physische Bereiche anlegen</button><div id="tpl-status" class="status"></div></section><section><h3>Physische Bereiche: Artikelzuordnung</h3><label>Bereich<select id="instance"></select></label><p class="hint">Zuerst eine oder mehrere Kategorien auswählen. Es erscheinen nur die Artikel dieser Kategorien, ohne Artikelnummer. Bereits zugeordnete Artikel anderer Kategorien bleiben erhalten.</p><div id="assign-categories" class="checks"></div><p id="assign-info" class="hint"></p><div id="assigned" class="checks"></div><button id="items-save">Artikelzuordnung speichern</button><button id="instance-delete" class="danger">Bereich entfernen</button><div id="area-status" class="status"></div></section><section><h3>QR-Etiketten</h3><label>Vom iPhone erreichbare HA-Adresse<input id="base"/></label><label>Standortfilter<select id="qr-location"></select></label><button id="print">QR-Etiketten drucken</button><div id="qr-status" class="status"></div></section><section><h3>Testbestände</h3><button id="reset" class="danger">Alle Bestände zurücksetzen</button><div id="reset-status" class="status"></div></section><div id="status" class="status"></div></div></ha-card><style>'+css+'</style>';this.$("base").value=window.location.origin;this.$("cat").onchange=()=>{this.$("cat-name").value=this.data.categories.find(x=>x.id===this.$("cat").value)?.name||"";};for(const x of ["item","location","template","instance"])this.$(x).onchange=()=>this["load_"+x]();const actions={"cat-add":()=>this.createCategory(),"cat-save":()=>this.updateCategory(),"cat-delete":()=>this.removeCategory(),"item-save":()=>this.saveItem(),"item-delete":()=>this.removeItem(),"loc-save":()=>this.saveLocation(),"loc-delete":()=>this.removeLocation(),"tpl-save":()=>this.saveTemplate(),"tpl-delete":()=>this.removeTemplate(),"assign":()=>this.assign(),"items-save":()=>this.saveAssignment(),"instance-delete":()=>this.removeInstance(),"print":()=>this.print(),"reset":()=>this.reset()};for(const [id,fn] of Object.entries(actions))this.$(id).onclick=fn;}
  update(){if(!this._ready)return;const d=this.data;options(this.$("cat"),d.categories);options(this.$("item-cat"),d.categories);options(this.$("item"),d.items.map(x=>({id:x.id,name:x.sku+" · "+x.name})),"Neuer Artikel");options(this.$("location"),d.locations,"Neuer Standort");options(this.$("template"),d.templates,"Neue Vorlage");options(this.$("instance"),d.instances.map(x=>({id:x.id,name:instName(d,x)})));options(this.$("qr-location"),[{id:"",name:"Alle Standorte"},...d.locations],"Alle Standorte");for(const x of ["item","location","template","instance"])this["load_"+x]();}
  load_item(){const id=this.$("item").value;if(this._loadedItem===id)return;this._loadedItem=id;const x=this.data.items.find(i=>i.id===id);this.$("item-name").value=x?.name||"";this.$("item-cat").value=x?.category_id||"";this.$("unit").value=x?.unit||"Stück";this.$("manufacturer").value=x?.manufacturer||"";this.$("model").value=x?.product_name||"";}
  load_location(){const id=this.$("location").value;if(this._loadedLocation===id)return;this._loadedLocation=id;const x=this.data.locations.find(i=>i.id===id);this.$("loc-code").value=x?.code||"";this.$("loc-code").disabled=!!x;this.$("loc-name").value=x?.name||"";}
  load_template(){const id=this.$("template").value;if(this._loadedTemplate!==id){this._loadedTemplate=id;this.$("tpl-name").value=this.data.templates.find(t=>t.id===id)?.name||"";}const box=this.$("tpl-sites"),sig=JSON.stringify(this.data.locations);if(sig!==box.dataset.sig){box.dataset.sig=sig;checkList(box,this.data.locations);}}

  load_instance(){
    const id=this.$("instance").value,d=this.data;
    const categoryBox=this.$("assign-categories");
    const catSignature=JSON.stringify(d.categories);
    if(catSignature!==categoryBox.dataset.sig){
      const previous=this._chosenCategories||new Set();
      categoryBox.dataset.sig=catSignature;
      checkList(categoryBox,d.categories);
      this._chosenCategories=new Set([...previous].filter(cat=>d.categories.some(x=>x.id===cat)));
      for(const cb of categoryBox.querySelectorAll("input[type=checkbox]")){
        cb.checked=this._chosenCategories.has(cb.value);
        cb.onchange=()=>{
          if(cb.checked)this._chosenCategories.add(cb.value);
          else this._chosenCategories.delete(cb.value);
          this.render_instance_items();
        };
      }
    }
    if(id!==this._editingInstance){
      this._editingInstance=id;
      this._assignmentDraft=new Set(d.stock.filter(x=>x.instance_id===id).map(x=>x.item_id));
    }
    this.render_instance_items();
  }
  render_instance_items(){
    const d=this.data,id=this.$("instance").value;
    const box=this.$("assigned");
    box.replaceChildren();
    if(!id){
      this.$("assign-info").textContent="Bitte zuerst einen physischen Inventurbereich wählen.";
      return;
    }
    const chosenCategories=this._chosenCategories||new Set();
    const visible=matchingCategoryItems(d.items,chosenCategories);
    this.$("assign-info").textContent=chosenCategories.size
      ? visible.length+" Artikel der gewählten Kategorien · "+this._assignmentDraft.size+
        " insgesamt zugeordnet (auch ausgeblendete Kategorien)."
      : "Bitte mindestens eine Kategorie auswählen. "+this._assignmentDraft.size+
        " Artikel sind diesem Bereich bereits zugeordnet.";
    for(const item of visible){
      const label=dom("label",null,box),cb=dom("input",null,label);
      cb.type="checkbox";
      cb.value=item.id;
      cb.checked=this._assignmentDraft.has(item.id);
      cb.onchange=()=>{
        this._assignmentDraft=changeAssignmentDraft(this._assignmentDraft,item.id,cb.checked);
        const status=this.$("assign-info");
        status.textContent=chosenCategories.size+" Kategorien · "+this._assignmentDraft.size+
          " Artikel ausgewählt (inklusive anderer Kategorien).";
      };
      const extra=[item.manufacturer,item.product_name].filter(Boolean).join(" · ");
      label.append(" "+item.name+(extra?" ("+extra+")":""));
    }
  }
  createCategory(){this.run("create_category",{name:this.$("cat-new").value},"cat-status",()=>this.$("cat-new").value="");}
  updateCategory(){this.run("update_category",{category_id:this.$("cat").value,name:this.$("cat-name").value},"cat-status");}
  removeCategory(){if(window.confirm("Kategorie löschen? Nur wenn keinem Artikel zugeordnet."))this.run("delete_category",{category_id:this.$("cat").value},"cat-status");}
  saveItem(){const id=this.$("item").value,data={name:this.$("item-name").value,category_id:this.$("item-cat").value,unit:this.$("unit").value,manufacturer:this.$("manufacturer").value,product_name:this.$("model").value};if(id)data.item_id=id;this.run(id?"update_item":"create_item",data,"item-status",()=>{this._loadedItem=null;this.$("item").value="";});}
  removeItem(){const id=this.$("item").value;if(id&&window.confirm("Artikel entfernen? Nur ohne Restbestand."))this.run("delete_item",{item_id:id},"item-status",()=>this._loadedItem=null);}
  saveLocation(){const id=this.$("location").value,data=id?{location_id:id,name:this.$("loc-name").value}:{name:this.$("loc-name").value,code:this.$("loc-code").value};this.run(id?"update_location":"create_location",data,"loc-status",()=>{this._loadedLocation=null;this.$("location").value="";});}
  removeLocation(){const id=this.$("location").value;if(id&&window.confirm("Standort inklusive seiner leeren Bereiche entfernen?"))this.run("delete_location",{location_id:id},"loc-status",()=>this._loadedLocation=null);}
  saveTemplate(){const id=this.$("template").value,data=id?{template_id:id,name:this.$("tpl-name").value}:{name:this.$("tpl-name").value};this.run(id?"update_template":"create_template",data,"tpl-status",()=>{this._loadedTemplate=null;this.$("template").value="";});}
  removeTemplate(){const id=this.$("template").value;if(id&&window.confirm("Vorlage löschen? Nur wenn nicht an Standorten verwendet."))this.run("delete_template",{template_id:id},"tpl-status");}
  assign(){this.run("assign_template",{template_id:this.$("template").value,location_ids:chosen(this.$("tpl-sites"))},"tpl-status");}
  saveAssignment(){
    const id=this.$("instance").value;
    if(!id)return this.status("area-status","Bereich wählen.",true);
    // Crucial: transmit ALL assignments, not only filtered/visible checkboxes.
    const item_ids=[...this._assignmentDraft];
    this.run("set_instance_items",{instance_id:id,item_ids},"area-status",()=>{
      this._editingInstance=null;
    });
  }
  removeInstance(){const id=this.$("instance").value;if(id&&window.confirm("Physischen Inventurbereich entfernen? Nur bei 0 Bestand."))this.run("delete_instance",{instance_id:id},"area-status",()=>{this._editingInstance=null;});}
  print(){try{const d=this.data,filter=this.$("qr-location").value;printLabels(d,this.$("base").value,d.instances.filter(a=>!filter||a.location_id===filter));this.status("qr-status","QR-Etikettenbogen geöffnet. Druck 100 %.");}catch(e){this.status("qr-status","QR-Fehler: "+(e.message||e),true);}}
  reset(){if(window.confirm("ALLE Bestände und Buchungen löschen? Artikel/Bereiche bleiben bestehen."))this.run("reset_stock",{},"reset-status");}
}

class InventoryComparison extends Base{
  render(){
    this.innerHTML='<ha-card header="Inventurbereiche – Standortvergleich"><div class="body">'+
      '<p class="hint">Gleichen logischen Inventurbereich zwischen Standorten vergleichen. Mehrere physische Instanzen eines Standorts werden addiert.</p>'+
      '<label>Logischer Inventurbereich<select id="compare-template"></select></label>'+
      '<label>Kategorie (optional)<select id="compare-category"></select></label>'+
      '<strong>Standorte im Vergleich</strong><div id="compare-sites" class="checks"></div>'+
      '<label><input type="checkbox" id="only-differences"/> Nur Abweichungen / fehlende Inventuren anzeigen</label>'+
      '<div id="compare-summary" class="hint"></div>'+
      '<div id="compare-result" class="scroll"></div>'+
      '<p class="hint">— = Artikel nicht zugeordnet. Nicht gezählt = keine Erstinventur. Bereich fehlt = Vorlage an diesem Standort nicht zugewiesen. Ungezählte Mengen werden nie als Null interpretiert.</p>'+
      '<div id="status" class="status"></div></div></ha-card><style>'+css+'</style>';
    this.$("compare-template").onchange=()=>this.update();
    this.$("compare-category").onchange=()=>this.update();
    this.$("only-differences").onchange=()=>this.update();
  }
  update(){
    if(!this._ready)return;
    const d=this.data;
    options(this.$("compare-template"),d.templates,"Inventurbereich wählen");
    options(this.$("compare-category"),[{id:"",name:"Alle Kategorien"},...d.categories],"Alle Kategorien");
    const sites=this.$("compare-sites"),sig=JSON.stringify(d.locations);
    if(!this._manuallySelected){
      const houses=d.locations.filter(x=>["13","14","15"].includes(x.code));
      this._sites=new Set((houses.length?houses:d.locations).map(x=>x.id));
    }else this._sites=new Set([...this._sites].filter(id=>d.locations.some(x=>x.id===id)));
    if(sites.dataset.signature!==sig){
      sites.dataset.signature=sig;
      checkList(sites,d.locations);
      for(const cb of sites.querySelectorAll("input[type=checkbox]")){
        cb.onchange=()=>{this._manuallySelected=true;cb.checked?
          this._sites.add(cb.value):this._sites.delete(cb.value);this.update();};
      }
    }
    for(const cb of sites.querySelectorAll("input[type=checkbox]"))cb.checked=this._sites.has(cb.value);
    const target=this.$("compare-result");target.replaceChildren();
    const templateId=this.$("compare-template").value,categoryId=this.$("compare-category").value;
    if(!templateId||!this._sites.size){
      this.$("compare-summary").textContent="Logischen Inventurbereich und mindestens einen Standort wählen.";
      return;
    }
    const result=compareAreas(d,templateId,this._sites,categoryId);
    const showOnly=this.$("only-differences").checked;
    const rows=result.rows.filter(r=>!showOnly||r.status!=="equal");
    const flagged=result.rows.filter(r=>r.status!=="equal").length;
    this.$("compare-summary").textContent=result.columns.length+" Standorte · "+
      result.rows.length+" Artikel · "+flagged+" Abweichungen/offene Prüfungen";
    if(!rows.length){
      dom("p",showOnly?"Keine Abweichungen in den erfassten Positionen.":"Keine Artikelzuordnungen in diesem Vergleich.",target,"hint");
      return;
    }
    const table=dom("table",null,target),thead=dom("thead",null,table),head=dom("tr",null,thead);
    table.style.minWidth=Math.max(680,result.columns.length*150+300)+"px";
    dom("th","Artikel",head);
    for(const col of result.columns)dom("th",col.site.name,head);
    dom("th","Bewertung",head);
    const body=dom("tbody",null,table);
    for(const row of rows){
      const tr=dom("tr",null,body);
      if(row.status!=="equal")tr.style.fontWeight="500";
      dom("td",row.item.name,tr);
      for(const cell of row.cells){
        let value="—";
        if(cell.state==="area_missing")value="Bereich fehlt";
        if(cell.state==="uncounted")value="Nicht gezählt";
        if(cell.state==="counted")value=cell.quantity+" "+row.item.unit;
        if(cell.state==="partial")value=cell.quantity+" "+row.item.unit+" + ungezählt";
        dom("td",value,tr);
      }
      dom("td",row.reason,tr);
    }
  }
}

const registry=[["mittelhof-inventory-overview",Overview],["mittelhof-inventory-comparison",InventoryComparison],["mittelhof-inventory-capture",Capture],["mittelhof-inventory-admin",Admin]];
for(const [name,ctor] of registry)if(!customElements.get(name))customElements.define(name,ctor);
window.customCards=window.customCards||[];
for(const [name] of registry)if(!window.customCards.some(x=>x.type===name))window.customCards.push({type:name,name});
