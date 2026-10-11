class MittelhofInventoryCard extends HTMLElement {
  setConfig(config) { this.config = config; this._rendered = false; }
  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) { this.render(); this._rendered = true; }
    this.updateLists();
  }
  getCardSize() { return 12; }
  render() {
    this.innerHTML = `<ha-card header="Mittelhof Inventar"><div class="content">
      <div class="status" id="status" aria-live="polite"></div>
      <section><h3>Bestand buchen</h3><label>Artikel <select id="item"></select></label><label>Standort <select id="loc"></select></label>
      <label>Buchungsart <select id="kind"><option value="consume">Verbrauch / Entnahme</option><option value="receipt">Neuer Wareneingang (erhöht Gesamtbestand)</option><option value="transfer">Umlagerung (Bestand verteilen)</option></select></label>
      <label id="source-wrap">Von Standort <select id="source"></select></label><label id="target-wrap">Nach Standort <select id="target"></select></label><label>Menge <input id="quantity" type="number" min="1" step="1" value="1"></label><button id="book">Buchen</button></section>
      <section><h3>Neuer Artikel</h3><label>Artikelnummer <input id="sku"></label><label>Name <input id="itemname"></label>
      <label>Einheit <input id="unit" value="Stück"></label><button id="additem">Artikel anlegen</button></section>
      <section><h3>Neuer Standort</h3><label>Kürzel <input id="code"></label><label>Name <input id="locname"></label>
      <button id="addloc">Standort anlegen</button></section>
      <section><h3>Mindest- und Sollbestand</h3><label>Minimum <input type="number" min="0" id="min" value="2"></label>
      <label>Soll <input type="number" min="0" id="target" value="10"></label><label>Bestellvielfaches <input type="number" min="1" id="multiple" value="1"></label>
      <button id="policy">Speichern</button></section>
      <section><h3>Bestand je Standort und Artikel</h3>
      <label>Standort filtern <select id="stock-location"><option value="">Alle Standorte</option></select></label>
      <div id="stock-table" style="overflow-x:auto"></div></section>
      <section><h3>Nachbestellvorschläge</h3><div id="suggestions"></div></section>
      </div></ha-card><style>
      .content {padding: 0 16px 18px}section{border-top:1px solid var(--divider-color);padding:10px 0}
      label{display:block;margin:8px 0}input,select{display:block;box-sizing:border-box;width:100%;padding:10px;
      background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:7px}
      button{margin-top:8px;border:0;border-radius:8px;background:var(--primary-color);color:white;padding:12px 16px;cursor:pointer}
      .status{min-height:1.5rem;color:var(--primary-text-color)}
      </style>`;
    const $ = id => this.querySelector('#'+id);
    const send = async (service, data, onSuccess) => {
      if (!this._hass) return;
      $('status').textContent='Verarbeite ...';
      try { await this._hass.callService('mittelhof_inventory', service, data);
        $('status').textContent='Gespeichert. Sensoraktualisierung folgt.';
        if (onSuccess) onSuccess();
      } catch (error) { $('status').textContent='Fehler: '+String(error?.message || error); }
    };
    const syncMode = () => {
      const kind=$('kind').value;
      $('source-wrap').style.display=(kind==='consume'||kind==='transfer')?'block':'none';
      $('target-wrap').style.display=(kind==='receipt'||kind==='transfer')?'block':'none';
    };
    $('kind').addEventListener('change',syncMode);
    syncMode();
    $('book').onclick=async()=>{
      const kind=$('kind').value, quantity=Number($('quantity').value);
      if (!Number.isSafeInteger(quantity) || quantity<1) {
        $('status').textContent='Bitte eine positive ganze Menge eingeben.';return;
      }
      const src=kind==='consume'||kind==='transfer' ? $('source').value : undefined;
      const dst=kind==='receipt'||kind==='transfer' ? $('target').value : undefined;
      if (!($('item').value) || (kind!=='receipt'&&!src) || (kind!=='consume'&&!dst) ||
          (kind==='transfer'&&src===dst)) {
        $('status').textContent='Artikel und gültige Standorte auswählen.';return;
      }
      await send('book_transaction',{
        kind,item_id:$('item').value,from_location_id:src,
        to_location_id:dst,quantity
      },()=>{
        $('quantity').value='1';
        $('item').selectedIndex=-1;
        $('source').selectedIndex=-1;
        $('target').selectedIndex=-1;
      });
    };
    $('additem').onclick=()=>send('create_item',{sku:$('sku').value,name:$('itemname').value,unit:$('unit').value});
    $('addloc').onclick=()=>send('create_location',{code:$('code').value,name:$('locname').value});
    $('policy').onclick=()=>send('set_stock_policy',{
      item_id:$('item').value,location_id:$('loc').value,min_quantity:Number($('min').value),
      target_quantity:Number($('target').value),reorder_multiple:Number($('multiple').value)});
  }
  updateLists() {
    if (!this._rendered) return;
    const records = (id, suffix) => {
      const state = this._hass.states[id] || Object.entries(this._hass.states).find(([key]) => key.endsWith('_inventar_'+suffix))?.[1];
      return Array.isArray(state?.attributes?.records) ? state.attributes.records : [];
    };
    const items = records(this.config.items_entity || 'sensor.inventar_artikel', 'artikel');
    const locations = records(this.config.locations_entity || 'sensor.inventar_standorte', 'standorte');
    const $ = id => this.querySelector('#'+id);
    for (const [id, data, label] of [['item', items, 'name'],['loc', locations, 'name'],['source',locations,'name'],['target',locations,'name']]) {
      const el=$(id), value=el.value, signatures=data.map(x=>x.id).join();
      if (el.dataset.signature===signatures) continue;
      el.replaceChildren();
      for(const x of data) {const opt=document.createElement('option');opt.value=x.id;opt.textContent=x[label];el.appendChild(opt);}
      if(data.some(x=>x.id===value)) el.value=value;
      else el.selectedIndex=-1;
      el.dataset.signature=signatures;
    }
    const stock=records(this.config.stock_entity || 'sensor.inventar_bestandspositionen', 'bestandspositionen');
    const filter = $('stock-location');
    const oldFilter = filter.value;
    const signature = locations.map(x => x.id+'='+x.name).join('|');
    if (filter.dataset.signature !== signature) {
      filter.replaceChildren(new Option('Alle Standorte', ''));
      for (const loc of locations) filter.add(new Option(loc.name, loc.id));
      filter.value = locations.some(x => x.id === oldFilter) ? oldFilter : '';
      filter.dataset.signature = signature;
    }
    if (!filter.dataset.handler) {
      filter.addEventListener('change', () => this.updateLists());
      filter.dataset.handler='yes';
    }
    const table=$('stock-table');
    table.replaceChildren();
    if (!items.length || !locations.length) {
      table.textContent='Zuerst Artikel und Standorte anlegen.';
    } else {
      const locs=locations.filter(l=>!filter.value||l.id===filter.value);
      const grid=document.createElement('table');
      grid.style.cssText='width:100%;border-collapse:collapse;font-size:0.9rem;min-width:280px';
      const header=document.createElement('tr');
      for (const title of ['Artikel', ...locs.map(l=>l.name), 'Gesamt']) {
        const cell=document.createElement('th');cell.textContent=title;
        cell.style.cssText='text-align:left;padding:8px;border-bottom:1px solid var(--divider-color)';header.appendChild(cell);
      }
      const thead=document.createElement('thead');thead.appendChild(header);grid.appendChild(thead);
      const body=document.createElement('tbody');
      const quantityByKey=new Map(stock.map(r=>[r.item_id+'|'+r.location_id,Number(r.quantity)||0]));
      for (const item of [...items].sort((a,b)=>a.name.localeCompare(b.name,'de'))) {
        const tr=document.createElement('tr');
        const quantities=locs.map(loc=>quantityByKey.get(item.id+'|'+loc.id)||0);
        const cells=[(item.sku||'—')+' – '+item.name+' ('+item.unit+')',...quantities.map(String),String(quantities.reduce((a,b)=>a+b,0))];
        cells.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;
          td.style.cssText='padding:8px;border-bottom:1px solid var(--divider-color);'+(index?'text-align:right;':'');tr.appendChild(td);});
        body.appendChild(tr);
      }
      grid.appendChild(body);table.appendChild(grid);
    }
    const sugg=records(this.config.suggestions_entity || 'sensor.inventar_fehlbestande', 'fehlbestande');
    const text=sugg.length?sugg.map(x=>`${x.location}: ${x.name} – ${x.suggested_quantity} nachfüllen`).join('\n'):'Keine Vorschläge';
    if ($('suggestions').textContent!==text) $('suggestions').textContent=text;
  }
}
if (!customElements.get('mittelhof-inventory-card')) customElements.define('mittelhof-inventory-card', MittelhofInventoryCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(x=>x.type==='mittelhof-inventory-card')) window.customCards.push({type:'mittelhof-inventory-card',name:'Mittelhof Inventar'});
