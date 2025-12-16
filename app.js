/************ YOU MUST SET THIS ************/
const API_URL = "https://script.google.com/macros/s/AKfycbw8BYyOsdn64Z4qsIIa9L3vNc7wBqIWwmFM8-hgg_oikz_pmDRCuGLVCjbiItE5RRn_/exec";
/*******************************************/

function getToken(){ return (localStorage.getItem("PHU_TUNG_TOKEN") || "").trim(); }

const UI = { MAX_CATEGORIES: 10, MAX_ITEMS_PER_CATEGORY: 20 };

let currentLocView = "KHO";
let allProducts = [];
let stockMap = {};
let quoteCart = new Map();
let moveType = "IN";

/************ JSONP ************/
function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(16).slice(2);
    const script = document.createElement("script");

    const q = new URLSearchParams({ action, token: getToken(), callback: cb, ...params });

    window[cb] = (resp) => {
      delete window[cb];
      script.remove();
      if (!resp || resp.ok !== true) return reject(resp?.error || "API_ERROR");
      resolve(resp.data);
    };

    script.onerror = () => {
      delete window[cb];
      script.remove();
      reject("NETWORK_ERROR");
    };

    script.src = `${API_URL}?${q.toString()}`;
    document.body.appendChild(script);
  });
}

function el(sel){ return document.querySelector(sel); }
function els(sel){ return Array.from(document.querySelectorAll(sel)); }
function money(n){ return Number(n||0).toLocaleString("vi-VN"); }
function openModal(id){ el(id).classList.add("show"); }
function closeModal(id){ el(id).classList.remove("show"); }
function show(elem, yes){ if(elem) elem.style.display = yes ? "" : "none"; }
function escapeHtml(s){
  s = String(s ?? "");
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/************ UI FEEDBACK ************/
function flashBtn(btn, mode="ok"){
  if(!btn) return;
  btn.classList.add("flash");
  if(mode==="err") btn.classList.add("shake");
  setTimeout(()=>{ btn.classList.remove("flash"); btn.classList.remove("shake"); }, 250);
}
function toast(type, message, detail=""){
  const wrap = document.querySelector("#toastWrap");
  if(!wrap) return;
  const t = document.createElement("div");
  t.className = `toast ${type} in`;
  t.innerHTML = `
    <div class="dot"></div>
    <div>
      <div class="msg">${escapeHtml(message)}</div>
      ${detail ? `<div class="sub">${escapeHtml(detail)}</div>` : ``}
    </div>
  `;
  wrap.appendChild(t);
  setTimeout(()=>{
    t.classList.remove("in");
    t.classList.add("out");
    setTimeout(()=>t.remove(), 200);
  }, 2400);
}
function setBusy(button, busy, labelBusy="Đang xử lý..."){
  if(!button) return;
  if(busy){
    button.dataset._oldText = button.textContent;
    button.textContent = labelBusy;
    button.disabled = true;
    button.style.opacity = "0.75";
  }else{
    button.textContent = button.dataset._oldText || button.textContent;
    button.disabled = false;
    button.style.opacity = "";
  }
}

/************ OPTIMISTIC UPDATES ************/
function updateLocalStockByDelta(productId, location, delta){
  const pid = String(productId);
  if(!stockMap[pid]) stockMap[pid] = { PRODUCT_ID: pid, KHO_TON: 0, CUA_HANG_TON: 0 };
  if(location === "KHO") stockMap[pid].KHO_TON = Number(stockMap[pid].KHO_TON||0) + delta;
  if(location === "CUA_HANG") stockMap[pid].CUA_HANG_TON = Number(stockMap[pid].CUA_HANG_TON||0) + delta;
}
function updateLocalPriceByOEM(oem, newPrice){
  const target = String(oem||"").trim();
  allProducts.forEach(p=>{
    if(String(p.OEM||"").trim() === target) p.GIA = Number(newPrice||0);
  });
}

/************ INIT ************/
document.addEventListener("click", (e) => {
  const c = e.target.getAttribute("data-close");
  if (c) closeModal(c);

  const b = e.target.closest(".btn, .big-btn, .tab-btn, .icon-btn");
  if(b) flashBtn(b);
});

// header image fallback
const headerTruck = document.querySelector("#headerTruck");
headerTruck?.addEventListener("error", ()=> headerTruck.classList.add("hide"));

els(".tab-btn[data-tab]").forEach(btn => {
  btn.addEventListener("click", async () => {
    els(".tab-btn[data-tab]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentLocView = btn.dataset.tab;
    el("#viewLoc").textContent = currentLocView;

    const locSel = el("#m_location");
    if(locSel) locSel.value = currentLocView;

    await refreshAll(true);
  });
});

el("#btnSearch").addEventListener("click", doSearch);
el("#q").addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSearch(); });

el("#btnOpenAdd").addEventListener("click", ()=>openModal("#modalAdd"));
el("#btnOpenIn").addEventListener("click", ()=>openMove("IN"));
el("#btnOpenOut").addEventListener("click", ()=>openMove("OUT"));
el("#btnQuote").addEventListener("click", ()=>{ renderQuoteModal(); openModal("#modalQuote"); });

el("#btnSaveProduct").addEventListener("click", saveProduct);
el("#btnDoMove").addEventListener("click", doMove);

el("#btnClearQuote").addEventListener("click", ()=>{
  quoteCart.clear();
  updateQuoteCount();
  renderQuoteModal();
  toast("info","Đã xoá chọn báo giá");
});
el("#btnMakePdf").addEventListener("click", makePdfQuote);

// refresh button with toast
el("#btnRefresh").addEventListener("click", async ()=>{
  const btn = el("#btnRefresh");
  setBusy(btn,true,"Đang tải...");
  try{
    await refreshAll(true);
    toast("ok","Đã tải dữ liệu","Kho/Cửa hàng đã cập nhật.");
  }catch(e){
    flashBtn(btn,"err");
    toast("err","Lỗi tải dữ liệu", String(e));
  }finally{
    setBusy(btn,false);
  }
});

// token modal
el("#btnToken").addEventListener("click", ()=>{
  el("#app_token").value = getToken();
  openModal("#modalToken");
});
el("#btnSaveToken").addEventListener("click", ()=>{
  const btn = el("#btnSaveToken");
  const t = el("#app_token").value.trim();
  if(!t){
    flashBtn(btn,"err");
    toast("err","TOKEN trống","Vui lòng dán token rồi lưu.");
    return;
  }
  localStorage.setItem("PHU_TUNG_TOKEN", t);
  closeModal("#modalToken");
  toast("ok","Đã lưu TOKEN","Bấm 'Làm mới' để tải dữ liệu.");
});

// image preview
const imgInput = document.querySelector("#p_img");
const imgPreview = document.querySelector("#p_img_preview");
imgInput?.addEventListener("change", async () => {
  const f = imgInput.files?.[0];
  if (!f) { imgPreview.style.display="none"; imgPreview.src=""; return; }
  const url = await fileToDataURL(f);
  imgPreview.src = url;
  imgPreview.style.display = "block";
});

/************ BOOT ************/
(async function boot(){
  if(!getToken()){
    openModal("#modalToken");
    toast("info","Nhập TOKEN để dùng app");
    return;
  }
  try{
    await jsonp("ping");
    el("#m_location").value = currentLocView;
    await refreshAll(true);
    toast("ok","Kết nối thành công");
  }catch(err){
    toast("err","Không kết nối được API / TOKEN sai", String(err));
  }
})();

/************ DATA LOAD ************/
async function refreshAll(hardReload=false){
  // hardReload=true: tải lại từ server (chậm hơn nhưng đồng bộ)
  if(!hardReload){
    // không dùng nữa, nhưng để sau này mở rộng
    return;
  }
  const [products, stock] = await Promise.all([ jsonp("getProducts"), jsonp("getStock") ]);
  allProducts = products || [];
  stockMap = {};
  (stock||[]).forEach(s => stockMap[String(s.PRODUCT_ID)] = s);

  const q = el("#q").value.trim();
  if(q) renderSearchResult(filterLocal(q));
  else renderDefault();
}

function getTon(productId){
  const s = stockMap[String(productId)];
  if(!s) return 0;
  return currentLocView === "KHO" ? Number(s.KHO_TON||0) : Number(s.CUA_HANG_TON||0);
}

/************ RENDER ************/
function renderDefault(){
  show(el("#categoryRows"), true);
  show(el("#listSection"), false);
  renderCategoryRows(allProducts);
}
function renderSearchResult(result){
  show(el("#categoryRows"), false);
  show(el("#listSection"), true);
  renderListAll(result);
}

function renderCategoryRows(list){
  const byCat = new Map();
  (list||[]).forEach(p=>{
    const cat = (p.LOAI||"KHÁC").trim() || "KHÁC";
    if(!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  });

  const cats = Array.from(byCat.entries()).sort((a,b)=>b[1].length - a[1].length);
  const top = cats.slice(0, UI.MAX_CATEGORIES);
  const rest = cats.slice(UI.MAX_CATEGORIES);

  const merged = new Map(top);
  if(rest.length){
    const other = [];
    rest.forEach(([_, arr])=>other.push(...arr));
    merged.set("KHÁC", (merged.get("KHÁC")||[]).concat(other));
  }

  const catRows = el("#categoryRows");
  catRows.innerHTML = "";

  for(const [cat, items] of merged.entries()){
    const shown = items.slice(0, UI.MAX_ITEMS_PER_CATEGORY);
    const more = items.length - shown.length;

    const wrap = document.createElement("div");
    wrap.className = "cat-row";
    wrap.innerHTML = `
      <div class="cat-title">${escapeHtml(cat)} <span class="muted">(${items.length})</span></div>
      <div class="cat-scroll"></div>
      ${more>0 ? `<div class="muted" style="margin-top:6px">... và còn ${more} sản phẩm</div>` : ``}
    `;
    const sc = wrap.querySelector(".cat-scroll");
    shown.forEach(p => sc.appendChild(productCard(p)));
    catRows.appendChild(wrap);
  }
}

function renderListAll(list){
  const listEl = el("#list");
  listEl.innerHTML = "";
  (list||[]).forEach(p => listEl.appendChild(productCard(p)));
}

function productCard(p){
  const pid = String(p.ID);
  const chosen = quoteCart.has(pid);
  const img = p.IMAGE_URL ? p.IMAGE_URL : "";
  const ton = getTon(pid);

  const card = document.createElement("div");
  card.className = "prod-card" + (chosen ? " selected" : "");

  card.innerHTML = `
    <div class="prod-top">
      <img class="prod-img" src="${img || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='rgba(0,0,0,0.06)'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='rgba(0,0,0,0.45)' font-size='10'%3Eno%20img%3C/text%3E%3C/svg%3E"}" />
      <div class="prod-meta">
        <div class="prod-oem">${escapeHtml(p.OEM || "")} <span class="muted">(#${pid})</span></div>
        <div class="prod-alt">OEM thay thế: <b>${escapeHtml(p.OEM_THAY_THE || "-")}</b></div>
        <div class="prod-name">${escapeHtml(p.TEN || "")}</div>
      </div>
    </div>
    <div class="prod-foot">
      <div>Loại: <b>${escapeHtml(p.LOAI || "-")}</b></div>
      <div>Tồn(${currentLocView}): <b>${ton}</b></div>
      <div>Giá: <b>${money(p.GIA)}đ</b></div>
    </div>
  `;

  card.addEventListener("click", ()=>{
    if(quoteCart.has(pid)) quoteCart.delete(pid);
    else quoteCart.set(pid, { qty: 1, price: Number(p.GIA||0) });
    updateQuoteCount();

    const q = el("#q").value.trim();
    if(q) renderSearchResult(filterLocal(q));
    else renderDefault();
  });

  return card;
}

function updateQuoteCount(){ el("#quoteCount").textContent = String(quoteCart.size); }

/************ SEARCH ************/
function filterLocal(q){
  q = q.toLowerCase();
  return allProducts.filter(p=>{
    const oem = String(p.OEM||"").toLowerCase();
    const alt = String(p.OEM_THAY_THE||"").toLowerCase();
    const ten = String(p.TEN||"").toLowerCase();
    const loai = String(p.LOAI||"").toLowerCase();
    return oem.includes(q) || alt.includes(q) || ten.includes(q) || loai.includes(q);
  });
}
function doSearch(){
  const q = el("#q").value.trim();
  if(!q){ renderDefault(); return; }
  renderSearchResult(filterLocal(q));
}

/************ ADD PRODUCT ************/
async function saveProduct(){
  const btn = el("#btnSaveProduct");
  setBusy(btn,true,"Đang lưu...");

  const oem = el("#p_oem").value.trim();
  const alt = el("#p_alt").value.trim();
  const ten = el("#p_ten").value.trim();
  const brand = el("#p_brand").value.trim();
  const loai = el("#p_loai").value.trim();
  const dvt = el("#p_dvt").value.trim();
  const gia = el("#p_gia").value.trim();
  const note = el("#p_note").value.trim();
  const initKho = el("#p_init_kho").value.trim();
  const initStore = el("#p_init_store").value.trim();
  const file = el("#p_img").files[0];

  if(!oem || !ten){
    setBusy(btn,false);
    flashBtn(btn,"err");
    toast("err","Thiếu OEM hoặc TÊN");
    return;
  }

  try{
    const created = await jsonp("createProduct", {
      oem, oem_thay_the: alt, ten, thuong_hieu: brand,
      loai, don_vi_tinh: dvt, gia, ghi_chu: note, image_url: "",
      init_kho: initKho, init_store: initStore
    });

    // optimistic add
    const newObj = {
      ID: created.id, OEM:oem, OEM_THAY_THE:alt, TEN:ten,
      THUONG_HIEU:brand, LOAI:loai, DON_VI_TINH:dvt,
      GIA: Number(String(gia||"0").replace(/,/g,'')) || 0,
      GHI_CHU:note, IMAGE_URL:""
    };
    allProducts.unshift(newObj);
    stockMap[String(created.id)] = {
      PRODUCT_ID: String(created.id),
      KHO_TON: Number(initKho||0),
      CUA_HANG_TON: Number(initStore||0)
    };

    if(file){
      const dataUrl = await fileToDataURL(file);
      const up = await jsonp("uploadImage", { product_id: created.id, data_url: dataUrl });
      newObj.IMAGE_URL = up.image_url;
    }

    closeModal("#modalAdd");
    clearAddForm();

    const q = el("#q").value.trim();
    if(q) renderSearchResult(filterLocal(q));
    else renderDefault();

    toast("ok","Đã thêm sản phẩm thành công", `ID ${created.id} • OEM ${oem}`);
  }catch(e){
    flashBtn(btn,"err");
    toast("err","Thêm sản phẩm thất bại", String(e));
  }finally{
    setBusy(btn,false);
  }
}

function clearAddForm(){
  ["#p_oem","#p_alt","#p_ten","#p_brand","#p_loai","#p_dvt","#p_gia","#p_note","#p_init_kho","#p_init_store"]
    .forEach(id=>el(id).value="");
  el("#p_img").value = "";
  if(imgPreview){ imgPreview.src=""; imgPreview.style.display="none"; }
}

function fileToDataURL(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = ()=>rej("READ_FILE_ERROR");
    r.readAsDataURL(file);
  });
}

/************ MOVEMENT (OEM) ************/
function openMove(type){
  moveType = type;
  el("#moveTitle").textContent = (type==="IN" ? "Nhập hàng (theo OEM)" : "Xuất hàng (theo OEM)");
  el("#m_oem").value = "";
  el("#m_qty").value = "";
  el("#m_new_price").value = "";
  el("#m_note").value = "";
  el("#m_location").value = currentLocView;
  show(el("#priceWrap"), type === "IN");
  openModal("#modalMove");
}

async function doMove(){
  const btn = el("#btnDoMove");
  setBusy(btn,true,"Đang ghi...");

  const location = el("#m_location").value.trim();
  const oem = el("#m_oem").value.trim();
  const qty = el("#m_qty").value.trim();
  const newPrice = el("#m_new_price").value.trim();
  const note = el("#m_note").value.trim();

  if(!oem || !qty){
    setBusy(btn,false);
    flashBtn(btn,"err");
    toast("err","Thiếu dữ liệu","Vui lòng nhập OEM và Số lượng.");
    return;
  }

  try{
    const resp = await jsonp("createMovementByOEM", {
      location, type: moveType, oem, qty,
      new_price: (moveType==="IN" ? newPrice : ""),
      note
    });

    // optimistic update
    const delta = (moveType === "IN" ? Number(qty) : -Number(qty));
    updateLocalStockByDelta(resp.product_id, location, delta);
    if(resp.updated_price != null) updateLocalPriceByOEM(resp.oem, resp.updated_price);

    closeModal("#modalMove");

    const q = el("#q").value.trim();
    if(q) renderSearchResult(filterLocal(q));
    else renderDefault();

    if(resp.updated_price != null){
      toast("ok","Nhập hàng thành công", `OEM ${resp.oem} • SL ${qty} • Giá mới ${money(resp.updated_price)}đ`);
    }else{
      toast("ok", (moveType==="IN" ? "Nhập hàng thành công" : "Xuất hàng thành công"), `OEM ${resp.oem} • SL ${qty}`);
    }
  }catch(e){
    flashBtn(btn,"err");
    toast("err","Nhập/Xuất thất bại", String(e));
  }finally{
    setBusy(btn,false);
  }
}

/************ QUOTE ************/
function renderQuoteModal(){
  const box = el("#quoteItems");
  box.innerHTML = "";

  if(quoteCart.size === 0){
    box.innerHTML = `<div class="muted">Chưa chọn sản phẩm. Bấm vào sản phẩm để thêm vào báo giá.</div>`;
    el("#quoteResult").innerHTML = "";
    return;
  }

  for(const [pid, it] of quoteCart.entries()){
    const p = allProducts.find(x=>String(x.ID)===pid);
    const row = document.createElement("div");
    row.className = "quote-row";
    row.innerHTML = `
      <div style="flex:1">
        <div><b>${escapeHtml(p?.OEM||"")}</b> <span class="muted">(#${pid})</span></div>
        <div class="muted">OEM thay thế: <b>${escapeHtml(p?.OEM_THAY_THE||"-")}</b> • ${escapeHtml(p?.TEN||"")}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input data-pid="${pid}" class="qi-qty" inputmode="numeric" value="${it.qty}" title="Số lượng"/>
        <input data-pid="${pid}" class="qi-price" inputmode="numeric" value="${it.price}" title="Đơn giá"/>
        <button class="btn ghost" data-remove="${pid}">Xoá</button>
      </div>
    `;
    box.appendChild(row);
  }

  box.querySelectorAll("[data-remove]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      quoteCart.delete(btn.dataset.remove);
      updateQuoteCount();
      renderQuoteModal();
      toast("info","Đã xoá 1 sản phẩm khỏi báo giá");
    });
  });

  box.querySelectorAll(".qi-qty").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const pid = inp.dataset.pid;
      const v = Math.max(1, parseInt(inp.value||"1",10));
      const it = quoteCart.get(pid);
      it.qty = isNaN(v) ? 1 : v;
      quoteCart.set(pid, it);
    });
  });

  box.querySelectorAll(".qi-price").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const pid = inp.dataset.pid;
      const v = Number(String(inp.value||"0").replace(/,/g,''));
      const it = quoteCart.get(pid);
      it.price = isNaN(v) ? 0 : v;
      quoteCart.set(pid, it);
    });
  });

  el("#quoteResult").innerHTML = "";
}

async function makePdfQuote(){
  const btn = el("#btnMakePdf");
  setBusy(btn,true,"Đang tạo PDF...");

  if(quoteCart.size === 0){
    setBusy(btn,false);
    flashBtn(btn,"err");
    toast("err","Chưa chọn sản phẩm","Bấm vào sản phẩm để thêm vào báo giá.");
    return;
  }

  try{
    const customer = el("#c_name").value.trim();
    const phone = el("#c_phone").value.trim();
    const address = el("#c_addr").value.trim();

    const items = [];
    for(const [pid, it] of quoteCart.entries()){
      items.push({ product_id: pid, qty: it.qty, price: it.price });
    }

    const resp = await jsonp("createQuotePdf", {
      customer, phone, address,
      items_json: JSON.stringify(items)
    });

    el("#quoteResult").innerHTML = `
      <div>Đã tạo: <b>${resp.quote_no}</b> • Tổng: <b>${money(resp.total)}đ</b></div>
      <div><a href="${resp.pdf_url}" target="_blank" rel="noopener">Mở PDF / In báo giá</a></div>
    `;
    toast("ok","Tạo báo giá thành công", `Mã ${resp.quote_no} • Tổng ${money(resp.total)}đ`);
  }catch(e){
    flashBtn(btn,"err");
    toast("err","Tạo báo giá thất bại", String(e));
  }finally{
    setBusy(btn,false);
  }
}
