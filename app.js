/************ YOU MUST SET THESE ************/
const API_URL = "https://script.google.com/macros/s/AKfycbxOgMxgpBYs9DS1iphWMiLBEJ6PcmD3YXUO8gvOHGoKUsZpOjZBn8MYLo5edR8gAXhc/exec";
const TOKEN   = "Thanhhai_Thaovy";
/*******************************************/

const UI = {
  MAX_CATEGORIES: 10,         // không tra cứu: hiển thị tối đa 10 loại
  MAX_ITEMS_PER_CATEGORY: 20  // không tra cứu: mỗi loại tối đa 20 sp (tượng trưng)
};

let currentLoc = "KHO"; // KHO / CUA_HANG
let allProducts = [];
let stockMap = {}; // product_id -> {KHO_TON, CUA_HANG_TON}
let quoteCart = new Map(); // product_id -> {qty, price}
let moveType = "IN";

/************ JSONP helper ************/
function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(16).slice(2);
    const script = document.createElement("script");

    const q = new URLSearchParams({
      action,
      token: TOKEN,
      callback: cb,
      ...params
    });

    window[cb] = (resp) => {
      try {
        delete window[cb];
        script.remove();
        if (!resp || resp.ok !== true) return reject(resp?.error || "API_ERROR");
        resolve(resp.data);
      } catch (e) { reject(String(e)); }
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

function money(n){
  n = Number(n||0);
  return n.toLocaleString("vi-VN");
}

function openModal(id){ el(id).classList.add("show"); }
function closeModal(id){ el(id).classList.remove("show"); }

function show(elem, yes){
  if(!elem) return;
  elem.style.display = yes ? "" : "none";
}

/************ INIT ************/
document.addEventListener("click", (e) => {
  const c = e.target.getAttribute("data-close");
  if (c) closeModal(c);
});

els(".tab-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    els(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentLoc = btn.dataset.tab;
    el("#viewLoc").textContent = currentLoc;
    await refreshAll();
  });
});

el("#btnRefresh").addEventListener("click", refreshAll);
el("#btnSearch").addEventListener("click", doSearch);
el("#q").addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSearch(); });

el("#btnOpenAdd").addEventListener("click", ()=>openModal("#modalAdd"));
el("#btnOpenIn").addEventListener("click", ()=>openMove("IN"));
el("#btnOpenOut").addEventListener("click", ()=>openMove("OUT"));
el("#btnQuote").addEventListener("click", ()=>{
  renderQuoteModal();
  openModal("#modalQuote");
});

el("#btnSaveProduct").addEventListener("click", saveProduct);
el("#btnDoMove").addEventListener("click", doMove);

el("#btnClearQuote").addEventListener("click", ()=>{
  quoteCart.clear();
  updateQuoteCount();
  renderQuoteModal();
});

el("#btnMakePdf").addEventListener("click", makePdfQuote);

// Preview image before upload
const imgInput = document.querySelector("#p_img");
const imgPreview = document.querySelector("#p_img_preview");
imgInput?.addEventListener("change", async () => {
  const f = imgInput.files?.[0];
  if (!f) {
    imgPreview.style.display = "none";
    imgPreview.src = "";
    return;
  }
  const url = await fileToDataURL(f);
  imgPreview.src = url;
  imgPreview.style.display = "block";
});

async function boot(){
  try{
    await jsonp("ping");
    await refreshAll();
  }catch(err){
    alert("Không kết nối được API. Kiểm tra API_URL / TOKEN.\n" + err);
  }
}
boot();

/************ LOAD + RENDER ************/
async function refreshAll(){
  const [products, stock] = await Promise.all([
    jsonp("getProducts"),
    jsonp("getStock")
  ]);
  allProducts = products || [];
  stockMap = {};
  (stock||[]).forEach(s => stockMap[String(s.PRODUCT_ID)] = s);

  // Logic: trống -> trượt tượng trưng; có q -> ALL list
  const q = el("#q").value.trim();
  if(q) renderSearchResult(filterLocal(q));
  else renderDefault();
}

function renderDefault(){
  // không tra: trượt tượng trưng
  show(el("#categoryRows"), true);
  show(el("#listSection"), false);
  renderCategoryRows(allProducts);
}

function renderSearchResult(result){
  // có tra: ALL danh sách dọc
  show(el("#categoryRows"), false);
  show(el("#listSection"), true);
  renderListAll(result);
}

function getTon(productId){
  const s = stockMap[String(productId)];
  if(!s) return 0;
  return currentLoc === "KHO" ? Number(s.KHO_TON||0) : Number(s.CUA_HANG_TON||0);
}

function renderCategoryRows(list){
  const byCat = new Map();
  (list||[]).forEach(p=>{
    const cat = (p.LOAI||"KHÁC").trim() || "KHÁC";
    if(!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  });

  // sort categories by count desc
  const cats = Array.from(byCat.entries()).sort((a,b)=>b[1].length - a[1].length);

  // top N categories, rest gộp KHÁC
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
      <img class="prod-img" src="${img || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='rgba(255,255,255,0.06)'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='rgba(255,255,255,0.45)' font-size='10'%3Eno%20img%3C/text%3E%3C/svg%3E"}" />
      <div class="prod-meta">
        <div class="prod-oem">${escapeHtml(p.OEM || "")} <span class="muted">(#${pid})</span></div>
        <div class="prod-alt">OEM thay thế: <b>${escapeHtml(p.OEM_THAY_THE || "-")}</b></div>
        <div class="prod-name">${escapeHtml(p.TEN || "")}</div>
      </div>
    </div>
    <div class="prod-foot">
      <div>Loại: <b>${escapeHtml(p.LOAI || "-")}</b></div>
      <div>Tồn: <b>${ton}</b></div>
      <div>Giá: <b>${money(p.GIA)}đ</b></div>
    </div>
  `;

  // Click: add/remove quote
  card.addEventListener("click", ()=>{
    if(quoteCart.has(pid)){
      quoteCart.delete(pid);
    }else{
      quoteCart.set(pid, { qty: 1, price: Number(p.GIA||0) });
    }
    updateQuoteCount();

    // refresh current view state
    const q = el("#q").value.trim();
    if(q) renderSearchResult(filterLocal(q));
    else renderDefault();
  });

  return card;
}

function updateQuoteCount(){
  el("#quoteCount").textContent = String(quoteCart.size);
}

/************ SEARCH ************/
async function doSearch(){
  const q = el("#q").value.trim();
  if(!q){
    renderDefault();
    return;
  }

  // local filter (nhanh cho 1-5k sp). Muốn chuẩn server thì đổi sang jsonp("searchProducts",{q})
  const result = filterLocal(q);
  renderSearchResult(result);
}

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

/************ ADD PRODUCT ************/
async function saveProduct(){
  const oem = el("#p_oem").value.trim();
  const alt = el("#p_alt").value.trim();
  const ten = el("#p_ten").value.trim();
  const brand = el("#p_brand").value.trim();
  const loai = el("#p_loai").value.trim();
  const dvt = el("#p_dvt").value.trim();
  const gia = el("#p_gia").value.trim();
  const note = el("#p_note").value.trim();
  const file = el("#p_img").files[0];

  if(!oem || !ten){
    alert("Thiếu OEM hoặc TÊN");
    return;
  }

  // 1) create product first to get ID
  const created = await jsonp("createProduct", {
    oem, oem_thay_the: alt, ten, thuong_hieu: brand, loai, don_vi_tinh: dvt, gia, ghi_chu: note, image_url: ""
  });
  const productId = created.id;

  // 2) upload image (optional)
  if(file){
    const dataUrl = await fileToDataURL(file);
    await jsonp("uploadImage", { product_id: productId, data_url: dataUrl });
  }

  closeModal("#modalAdd");
  clearAddForm();
  await refreshAll();
  alert("Đã lưu sản phẩm ID: " + productId);
}

function clearAddForm(){
  ["#p_oem","#p_alt","#p_ten","#p_brand","#p_loai","#p_dvt","#p_gia","#p_note"].forEach(id=>el(id).value="");
  el("#p_img").value = "";
  const pv = el("#p_img_preview");
  if(pv){ pv.src=""; pv.style.display="none"; }
}

function fileToDataURL(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = ()=>rej("READ_FILE_ERROR");
    r.readAsDataURL(file);
  });
}

/************ MOVEMENT ************/
function openMove(type){
  moveType = type;
  el("#moveTitle").textContent = (type==="IN" ? "Nhập hàng" : "Xuất hàng") + ` (${currentLoc})`;
  el("#m_pid").value = "";
  el("#m_qty").value = "";
  el("#m_price").value = "";
  el("#m_note").value = "";
  openModal("#modalMove");
}

async function doMove(){
  const productId = el("#m_pid").value.trim();
  const qty = el("#m_qty").value.trim();
  const price = el("#m_price").value.trim();
  const note = el("#m_note").value.trim();

  if(!productId || !qty){
    alert("Thiếu ID hoặc số lượng");
    return;
  }

  try{
    const resp = await jsonp("createMovement", {
      location: currentLoc,
      type: moveType,
      product_id: productId,
      qty,
      price_at_time: price,
      note
    });

    closeModal("#modalMove");
    await refreshAll();
    alert(`OK: ${resp.ref_no}`);
  }catch(e){
    alert("Lỗi nhập/xuất: " + e);
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
  if(quoteCart.size === 0){
    alert("Chưa chọn sản phẩm");
    return;
  }

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
}

/************ UTIL ************/
function escapeHtml(s){
  s = String(s ?? "");
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
