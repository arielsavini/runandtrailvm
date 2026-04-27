
import { initializeApp }            from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, onSnapshot,
         setDoc, deleteDoc, updateDoc, arrayUnion,
         query, orderBy, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadString, getDownloadURL, deleteObject }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getAuth, GoogleAuthProvider, signInWithPopup,
         signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

/* ══════════════════════════════════════════
   FIREBASE CONFIG — pegá tus credenciales aquí
   (Firebase Console → Proyecto → Configuración → SDK web)
══════════════════════════════════════════ */
const firebaseConfig = {
  apiKey: "AIzaSyDMGO_vhg8iduBl76CHpv7lmN69C74EOUk",
  authDomain: "run-trail-vm.firebaseapp.com",
  projectId: "run-trail-vm",
  storageBucket: "run-trail-vm.firebasestorage.app",
  messagingSenderId: "547743990222",
  appId: "1:547743990222:web:bdfb0eda352bbcfb2aeb9f",
  measurementId: "G-MFRN4QJPP3"
};

/* ══════════════════════════════════════════
   TU EMAIL DE ADMIN (el que usás para loguearte con Google)
══════════════════════════════════════════ */
const ADMIN_EMAIL = 'arielsavini@gmail.com'; // ← cambiá por tu Gmail

const fbApp   = initializeApp(firebaseConfig);
const db      = getFirestore(fbApp);
const storage = getStorage(fbApp);
const auth    = getAuth(fbApp);
const googleProvider = new GoogleAuthProvider();

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let currentUser = null;
let races = [], filtered = [];
let selDists = [], curMood = null, editId = null, partRaceId = null;
let partPhotos = [], racePhotoFile = null, racePhotoURL = null, geoC = null, wData = null;
let locPickerMap = null, _locSearchResults = [];

const MS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const TL = {trail:'Trail 🏔', road:'Road 🏙', ultra:'Ultra ⚡', mixed:'Mixto 🔀', duatlon:'Duatlón 🚴', triatlon:'Triatlón 🏊'};
const TI = {trail:'🏔', road:'🏙', ultra:'⚡', mixed:'🔀', duatlon:'🚴', triatlon:'🏊'};

const FB_READY = firebaseConfig.apiKey !== 'TU_API_KEY';

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
async function init() {
  showPageLoader(true);

  if (FB_READY) {
    // Escuchar cambios de sesión de Firebase Auth en tiempo real
    onAuthStateChanged(auth, fbUser => {
      if (fbUser) {
        currentUser = {
          id:      fbUser.uid,
          name:    fbUser.displayName || fbUser.email,
          email:   fbUser.email,
          picture: fbUser.photoURL,
          isAdmin: fbUser.email === ADMIN_EMAIL
        };
      } else {
        currentUser = null;
      }
      updateNav();
      // Re-suscribir con el nuevo estado de auth (anónimo o autenticado)
      subscribeRaces();
      if (activeTab === 'training') renderTrainingTab();
    });
  } else {
    // Sin Firebase: modo demo
    races = demoRaces();
    filtered = [...races];
    renderAll();
    showPageLoader(false);
    showFirebaseWarning();
  }
}

function renderAll() {
  filtered = applyCurrentFilters();
  renderFeatured();
  renderCards();
  updateStats();
  if (activeTab === 'mapa' && raceMapInst) renderMapTab();
}

/* ══════════════════════════════════════════
   FIREBASE — TIEMPO REAL
══════════════════════════════════════════ */
let _racesUnsub = null;
function subscribeRaces() {
  // Cancelar suscripción previa antes de crear una nueva
  if (_racesUnsub) { _racesUnsub(); _racesUnsub = null; }
  const q = query(collection(db, 'races'), orderBy('date', 'asc'));
  _racesUnsub = onSnapshot(q, snap => {
    races = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filtered = applyCurrentFilters();
    renderAll();
    showPageLoader(false);
  }, err => {
    console.error('Firestore races:', err.code, err.message);
    showPageLoader(false);
    if (err.code === 'permission-denied') {
      toast('🔒', 'Iniciá sesión para ver las carreras');
    } else {
      races = demoRaces();
      renderAll();
      toast('⚠️', 'Error al conectar con la base de datos');
    }
  });
}

/* ══════════════════════════════════════════
   FIREBASE — GUARDAR / EDITAR CARRERA
══════════════════════════════════════════ */
async function fbSaveRace(race) {
  const { id, ...data } = race;
  data.updatedAt = serverTimestamp();
  await setDoc(doc(db, 'races', id), data);
}

async function fbDeleteRace(id) {
  // Borrar foto de Storage si existe
  const r = races.find(x => x.id === id);
  if (r?.photoPath) {
    try { await deleteObject(ref(storage, r.photoPath)); } catch(e) {}
  }
  await deleteDoc(doc(db, 'races', id));
}

async function fbAddParticipation(raceId, part) {
  await updateDoc(doc(db, 'races', raceId), {
    participations: arrayUnion(part)
  });
}

/* ══════════════════════════════════════════
   FIREBASE — SUBIR FOTO
══════════════════════════════════════════ */
async function uploadPhoto(file, path) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const storRef = ref(storage, path);
        await uploadString(storRef, ev.target.result, 'data_url');
        const url = await getDownloadURL(storRef);
        resolve({ url, path });
      } catch(e) { reject(e); }
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPartPhoto(file, path) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const storRef = ref(storage, path);
        await uploadString(storRef, ev.target.result, 'data_url');
        const url = await getDownloadURL(storRef);
        resolve(url);
      } catch(e) { reject(e); }
    };
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════
   FIREBASE AUTH — LOGIN / LOGOUT
══════════════════════════════════════════ */
async function loginWithGoogle() {
  if (!FB_READY) {
    // Modo demo sin Firebase: simular login para probar la UI
    currentUser = { id:'demo_user', name:'Usuario Demo', email:'demo@demo.com', picture:null, isAdmin:false };
    updateNav(); renderCards(); updateStats();
    cm('loginOv');
    toast('👟', '¡Bienvenido en modo demo! Configurá Firebase para el login real.', 'ok');
    return;
  }
  try {
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, googleProvider);
    cm('loginOv');
    toast('👟', `¡Bienvenido!`, 'ok');
  } catch(e) {
    if (e.code === 'auth/popup-blocked') {
      toast('⚠️', 'El popup fue bloqueado. Permití popups para este sitio en tu navegador.');
    } else if (e.code === 'auth/cancelled-popup-request') {
      // usuario cerró el popup, no mostrar error
    } else {
      toast('❌', 'Error al iniciar sesión: ' + e.message);
      console.error(e);
    }
  }
}

async function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  if (FB_READY) {
    await signOut(auth);
  } else {
    currentUser = null;
    updateNav(); renderCards(); updateStats();
  }
  toast('👋', 'Sesión cerrada');
}

function openLogin() { oo('loginOv'); }

/* ══════════════════════════════════════════
   NAV
══════════════════════════════════════════ */
function updateNav() {
  const nav = document.getElementById('navRight'), fab = document.getElementById('adminFab');
  if (currentUser) {
    const av = currentUser.picture
      ? `<div class="avatar" onclick="logout()" title="Cerrar sesión"><img src="${currentUser.picture}"></div>`
      : `<div class="avatar" onclick="logout()" title="Cerrar sesión">${currentUser.name[0].toUpperCase()}</div>`;
    const notifEnabled = localStorage.getItem('push_subscribed') === '1';
    const bellTitle    = notifEnabled ? 'Notificaciones activadas — click para desactivar' : 'Activar notificaciones de carreras';
    const bellBtn      = `<button class="notif-btn${notifEnabled ? ' enabled' : ''}" id="notifBtn" onclick="togglePushNotifications()" title="${bellTitle}">🔔</button>`;
    const profileBtn   = `<button class="btn btn-ghost btn-profile" onclick="openProfileConfig()" title="Mi perfil público" style="padding:7px 12px;font-size:12px">👤 Mi perfil</button>`;
    nav.innerHTML = `<span class="user-chip"><span class="dot"></span>${currentUser.name.split(' ')[0]}</span>${currentUser.isAdmin ? '<span class="admin-badge">ADMIN</span>' : ''}${profileBtn}${bellBtn}${av}`;
    if (currentUser.isAdmin) fab.classList.add('on'); else fab.classList.remove('on');
  } else {
    nav.innerHTML = `<button class="btn btn-ghost" onclick="openLogin()">Ingresar</button><button class="btn btn-accent" onclick="openLogin()">Registrarse</button>`;
    fab.classList.remove('on');
  }
}

/* ══════════════════════════════════════════
   STATS
══════════════════════════════════════════ */
function updateStats() {
  document.getElementById('sTotal').textContent = races.length;
  document.getElementById('sProvs').textContent = new Set(races.map(r => r.provincia).filter(Boolean)).size;
  document.getElementById('sParts').textContent = currentUser
    ? races.filter(r => (r.participations || []).some(p => p.userId === currentUser.id)).length
    : 0;
}

/* ══════════════════════════════════════════
   FEATURED
══════════════════════════════════════════ */
function renderFeatured() {
  const row = document.getElementById('featRow'), wrap = document.getElementById('featWrap');
  const feat = races.filter(r => r.featured).slice(0, 3);
  if (!feat.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  row.innerHTML = feat.map(r => {
    const [y, mo, d] = r.date.split('-');
    return `<div class="feat-card" onclick="openDetail('${r.id}')">
      <div class="fbg">${r.photo ? `<img src="${r.photo}">` : (TI[r.type] || '🏃')}</div>
      <div class="fov"></div>
      <div class="finfo">
        <div class="fname">${r.name}</div>
        <div class="fmeta">${d}/${mo}/${y}${r.provincia ? ' · ' + r.provincia : ''}</div>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   FILTERS
══════════════════════════════════════════ */
function applyCurrentFilters() {
  const tipo  = document.getElementById('fTipo')?.value  || '';
  const prov  = document.getElementById('fProv')?.value  || '';
  const desde = document.getElementById('fDesde')?.value || '';
  const hasta = document.getElementById('fHasta')?.value || '';
  const sort  = document.getElementById('sortSel')?.value || 'date-asc';
  let out = races.filter(r => {
    if (tipo  && r.type      !== tipo) return false;
    if (prov  && r.provincia !== prov) return false;
    if (desde && r.date      <  desde) return false;
    if (hasta && r.date      >  hasta) return false;
    return true;
  });
  out.sort((a, b) => {
    if (sort === 'date-asc')  return a.date.localeCompare(b.date);
    if (sort === 'date-desc') return b.date.localeCompare(a.date);
    return a.name.localeCompare(b.name);
  });
  return out;
}

function applyFilters() {
  const tipo  = document.getElementById('fTipo').value;
  const prov  = document.getElementById('fProv').value;
  const desde = document.getElementById('fDesde').value;
  const hasta = document.getElementById('fHasta').value;
  filtered = applyCurrentFilters();
  renderChips(tipo, prov, desde, hasta);
  renderCards();
}

function clearFilters() {
  ['fTipo','fProv','fDesde','fHasta'].forEach(id => document.getElementById(id).value = '');
  filtered = [...races]; renderChips('','','',''); renderCards();
}

function renderChips(tipo, prov, desde, hasta) {
  const c = document.getElementById('activeChips');
  const chips = [];
  if (tipo)  chips.push([`Tipo: ${TL[tipo]}`,  () => { document.getElementById('fTipo').value  = ''; applyFilters(); }]);
  if (prov)  chips.push([`Provincia: ${prov}`, () => { document.getElementById('fProv').value  = ''; applyFilters(); }]);
  if (desde) chips.push([`Desde: ${fd(desde)}`,() => { document.getElementById('fDesde').value = ''; applyFilters(); }]);
  if (hasta) chips.push([`Hasta: ${fd(hasta)}`,() => { document.getElementById('fHasta').value = ''; applyFilters(); }]);
  window._cc = chips.map(ch => ch[1]);
  c.innerHTML = chips.map((_, i) => `<span class="chip">${chips[i][0]} <button onclick="window._cc[${i}]()">×</button></span>`).join('');
}

/* ══════════════════════════════════════════
   CARDS
══════════════════════════════════════════ */
function renderCards() {
  const grid = document.getElementById('cardsGrid'), rc = document.getElementById('resCount');
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">SIN RESULTADOS</div><div class="empty-sub">Probá cambiando los filtros.</div><button class="btn btn-accent" onclick="clearFilters()">Ver todas</button></div>`;
    rc.innerHTML = 'Sin resultados'; return;
  }
  rc.innerHTML = `Mostrando <strong>${filtered.length}</strong> de <strong>${races.length}</strong> carreras`;
  grid.innerHTML = filtered.map(r => buildCard(r)).join('');
}

function buildCard(r) {
  const [y, mo, d] = r.date.split('-');
  const pc = currentUser ? ((r.participations || []).some(p => p.userId === currentUser.id) ? 1 : 0) : 0;
  const imgH = r.photo ? `<img src="${r.photo}" alt="${r.name}" loading="lazy">` : `<div class="c-img-ph">${TI[r.type] || '🏃'}</div>`;
  const wH = r.weather ? `<div class="c-weather">${r.weather.icon} <span class="wt">${r.weather.temp}°C</span> ${r.weather.desc}</div>` : '';
  const adm = currentUser?.isAdmin ? `<button class="cb-adm" onclick="event.stopPropagation();editRace('${r.id}')" title="Editar">✏</button><button class="cb-adm" onclick="event.stopPropagation();delRace('${r.id}')" title="Eliminar">🗑</button>` : '';
  const userPart = currentUser ? (r.participations || []).find(p => p.userId === currentUser.id) : null;
  const timesBtn = currentUser
    ? `<button class="cb-pri" onclick="event.stopPropagation();openPart('${r.id}')">${userPart ? '✏ Mi información' : '⏱ Mis tiempos'}</button>`
    : `<button class="cb-pri" onclick="event.stopPropagation();openLogin()">⏱ Mis tiempos</button>`;
  return `<div class="race-card" onclick="openDetail('${r.id}')">
    <div class="c-img">
      ${imgH}<div class="c-ov"></div>
      <div class="c-badges">
        <span class="bdg bdg-${r.type}">${TL[r.type] || r.type}</span>
        ${r.distances?.[0] ? `<span class="bdg bdg-dark">${r.distances[0]}</span>` : ''}
      </div>
      ${pc > 0 ? `<div class="c-part-count">⏱ Mi tiempo</div>` : ''}
      <div class="c-date"><div class="day">${d}</div><div class="mon">${MS[parseInt(mo)-1]} ${y}</div></div>
    </div>
    <div class="c-body">
      <div class="c-name">${r.name}</div>
      ${r.provincia ? `<div class="c-loc"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${r.city ? r.city + ', ' : ''}${r.provincia}</div>` : ''}
      ${r.distances?.length ? `<div class="c-dists">${r.distances.map(x => `<span class="dpill">${x}</span>`).join('')}</div>` : ''}
      ${wH}
    </div>
    <div class="c-foot">${timesBtn}<button class="cb-sec" onclick="event.stopPropagation();openDetail('${r.id}')">Ver más</button>${adm}</div>
  </div>`;
}

/* ══════════════════════════════════════════
   DETAIL
══════════════════════════════════════════ */
function openDetail(id) {
  const r = races.find(x => x.id === id); if (!r) return;
  document.getElementById('dName').textContent = r.name;
  document.getElementById('dSub').textContent  = `${fd(r.date)}${r.provincia ? ' · ' + r.provincia : ''}${r.city ? ' · ' + r.city : ''}`;
  // Solo el dueño y el admin pueden ver las participaciones
  const visibleParts = (r.participations || []).filter(p =>
    currentUser?.isAdmin || (currentUser && p.userId === currentUser.id)
  );
  const partsH = visibleParts.map(p => {
    const moods = ['','😵','😓','😊','😄','🤩'];
    const avH = p.userPic ? `<div class="pav"><img src="${p.userPic}"></div>` : `<div class="pav">${(p.userName||'?')[0].toUpperCase()}</div>`;
    const picsH = (p.photos || []).map(ph => `<img src="${ph}" onclick="bigImg('${ph}')">`).join('');
    return `<div class="pcard">
      <div class="ptop"><div class="puser">${avH}<div><div class="pname">${p.userName||'Corredor'}</div><div class="pwhen">${p.createdAt ? fd(p.createdAt.split('T')[0]) : ''}</div></div></div><div style="font-size:22px">${moods[p.mood]||''}</div></div>
      <div class="pstats">
        ${p.time     ? `<div class="pst"><div class="lbl">TIEMPO</div><div class="val">${p.time}</div></div>` : ''}
        ${p.distance ? `<div class="pst"><div class="lbl">DISTANCIA</div><div class="val sm">${p.distance}</div></div>` : ''}
        ${p.position ? `<div class="pst"><div class="lbl">POSICIÓN</div><div class="val sm">#${p.position}</div></div>` : ''}
      </div>
      ${p.comment ? `<div class="pcomment">"${p.comment}"</div>` : ''}
      ${picsH ? `<div class="pphotos">${picsH}</div>` : ''}
    </div>`;
  }).join('');
  // Mensaje vacío según estado de autenticación
  const partsEmpty = !currentUser
    ? `<div class="empty" style="padding:32px"><div class="empty-icon">🔒</div><div class="empty-title" style="font-size:20px">INICIÁ SESIÓN</div><div class="empty-sub">Iniciá sesión para ver y cargar tus tiempos en esta carrera.</div><button class="btn btn-accent" style="margin-top:16px" onclick="cm('detailOv');openLogin()">Iniciar sesión</button></div>`
    : currentUser.isAdmin
      ? `<div class="empty" style="padding:32px"><div class="empty-icon">⏱</div><div class="empty-title" style="font-size:20px">SIN REGISTROS AÚN</div><div class="empty-sub">Todavía nadie cargó sus resultados.</div></div>`
      : `<div class="empty" style="padding:32px"><div class="empty-icon">⏱</div><div class="empty-title" style="font-size:20px">AÚN NO CARGASTE TUS TIEMPOS</div><div class="empty-sub">Hacé clic en "Registrar mis tiempos" para agregar tu resultado.</div></div>`;
  document.getElementById('dBody').innerHTML = `
    ${r.photo ? `<img src="${r.photo}" class="dhero">` : `<div class="dhero-ph">${TI[r.type]||'🏃'}</div>`}
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">
      <span class="bdg bdg-${r.type}">${TL[r.type]}</span>
      ${(r.distances||[]).map(x => `<span class="bdg bdg-dark">${x}</span>`).join('')}
    </div>
    <div class="meta-grid">
      <div class="mc"><div class="ml">Fecha</div><div class="mv">${fd(r.date)}</div></div>
      ${r.provincia ? `<div class="mc"><div class="ml">Provincia</div><div class="mv" style="font-size:13px">${r.provincia}</div></div>` : ''}
      ${r.city      ? `<div class="mc"><div class="ml">Ciudad</div><div class="mv" style="font-size:13px">${r.city}</div></div>` : ''}
      ${r.weather   ? `<div class="mc"><div class="ml">Clima</div><div class="mv">${r.weather.icon} ${r.weather.temp}°C</div><div style="font-size:11px;color:var(--muted)">${r.weather.desc}</div></div>` : ''}
      ${r.coords    ? `<div class="mc"><div class="ml">GPS</div><div class="mv" style="font-size:12px;font-family:'Space Mono',monospace">${r.coords.lat}, ${r.coords.lng}</div></div>` : ''}
    </div>
    ${r.description ? `<p style="color:var(--muted);font-size:13px;line-height:1.7;margin-bottom:16px">${r.description}</p>` : ''}
    <div class="act-row">
      ${r.url    ? `<a class="act-btn" href="${r.url}" target="_blank">🔗 Página oficial</a>` : ''}
      ${r.coords ? `<a class="act-btn" href="https://www.google.com/maps?q=${r.coords.lat},${r.coords.lng}" target="_blank">🗺 Google Maps</a>` : ''}
      <button class="act-btn" onclick="cm('detailOv');openPart('${r.id}')">${currentUser ? ((r.participations||[]).find(p=>p.userId===currentUser.id) ? '✏ Mi información' : '⏱ Registrar mis tiempos') : '🔐 Iniciá sesión para registrar'}</button>
      ${currentUser && (r.participations||[]).find(p=>p.userId===currentUser.id) ? `<button class="act-btn" style="color:var(--accent);border-color:rgba(232,255,71,.3)" onclick="openShareCard('${r.id}')">📤 Compartir resultado</button>` : ''}
      ${currentUser?.isAdmin ? `<button class="act-btn" style="color:#ff6b6b;border-color:rgba(255,68,68,.3)" onclick="cm('detailOv');delRace('${r.id}')">🗑 Eliminar</button><button class="act-btn" onclick="cm('detailOv');editRace('${r.id}')">✏ Editar</button>` : ''}
    </div>
    <div class="sdiv"></div>
    <div class="stitle">RESULTADOS Y EXPERIENCIAS</div>
    ${partsH || partsEmpty}
  `;
  oo('detailOv');
}
function bigImg(src) { const w = window.open(); w.document.write(`<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${src}" style="max-width:100%;max-height:100vh"></body>`); }

/* ══════════════════════════════════════════
   ADD / EDIT RACE (solo admin)
══════════════════════════════════════════ */
function openAddRace() {
  if (!currentUser?.isAdmin) { toast('🔒', 'Solo el administrador puede agregar carreras'); return; }
  editId = null; selDists = []; racePhotoFile = null; racePhotoURL = null; geoC = null; wData = null;
  document.getElementById('arTitle').textContent = 'NUEVA CARRERA';
  ['rName','rCity','rUrl','rDesc','wCity'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('rDate').value = '';
  document.getElementById('rProv').value = '';
  document.getElementById('rFeatured').checked = false;
  document.getElementById('wbox').style.display = 'none';
  clearLocation();
  document.getElementById('rpPrev').innerHTML = '<div class="ui">📷</div><p>Click para subir foto de portada</p>';
  document.querySelectorAll('.dtag').forEach(t => t.classList.remove('sel'));
  oo('addRaceOv');
}

function editRace(id) {
  if (!currentUser?.isAdmin) return;
  const r = races.find(x => x.id === id); if (!r) return;
  openAddRace(); editId = id;
  document.getElementById('arTitle').textContent = 'EDITAR CARRERA';
  document.getElementById('rName').value = r.name || '';
  document.getElementById('rType').value = r.type || 'trail';
  document.getElementById('rDate').value = r.date || '';
  document.getElementById('rProv').value = r.provincia || '';
  document.getElementById('rCity').value = r.city || '';
  document.getElementById('rUrl').value  = r.url  || '';
  document.getElementById('rDesc').value = r.description || '';
  document.getElementById('rFeatured').checked = r.featured || false;
  selDists = [...(r.distances || [])];
  document.querySelectorAll('.dtag').forEach(t => { if (selDists.includes(t.textContent.trim())) t.classList.add('sel'); });
  if (r.photo) { racePhotoURL = r.photo; document.getElementById('rpPrev').innerHTML = `<img src="${r.photo}" class="prev">`; }
  if (r.weather) { wData = r.weather; document.getElementById('wicon').textContent = r.weather.icon; document.getElementById('wtemp').textContent = `${r.weather.temp}°C`; document.getElementById('wdesc').textContent = r.weather.desc; document.getElementById('wbox').style.display = 'flex'; }
  if (r.coords) { geoC = r.coords; const locLabel = [r.city, r.provincia].filter(Boolean).join(', '); _showLocOnPicker(r.coords.lat, r.coords.lng, locLabel); }
}

function prevRacePhoto(e) {
  const f = e.target.files[0]; if (!f) return;
  racePhotoFile = f;
  const reader = new FileReader();
  reader.onload = ev => {
    racePhotoURL = ev.target.result;
    document.getElementById('rpPrev').innerHTML = `<img src="${racePhotoURL}" class="prev">`;
  };
  reader.readAsDataURL(f);
}

function togDist(btn, val) {
  if (selDists.includes(val)) { selDists = selDists.filter(d => d !== val); btn.classList.remove('sel'); }
  else { selDists.push(val); btn.classList.add('sel'); }
}

function addCD(e) {
  if (e.key !== 'Enter') return;
  const val = e.target.value.trim().toUpperCase(); if (!val) return;
  if (!selDists.includes(val)) {
    selDists.push(val);
    const b = document.createElement('button'); b.className = 'dtag sel'; b.textContent = val;
    b.onclick = () => togDist(b, val);
    document.getElementById('dtCont').appendChild(b);
  }
  e.target.value = '';
}

/* ══════════════════════════════════════════
   LOCATION PICKER (Nominatim / OpenStreetMap)
══════════════════════════════════════════ */
async function searchLocation() {
  const q = document.getElementById('locSearch').value.trim();
  if (!q) { toast('⚠️', 'Ingresá un lugar para buscar'); return; }
  const btn = document.getElementById('locSearchBtn');
  btn.innerHTML = '<span class="spin"></span>';
  const resultsBox = document.getElementById('locResults');
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`,
      { headers: { 'Accept-Language': 'es' } }
    );
    _locSearchResults = await res.json();
    resultsBox.style.display = 'block';
    if (!_locSearchResults.length) {
      resultsBox.innerHTML = '<div class="loc-no-results">Sin resultados. Intentá con más detalle, ej: "Villa Mercedes, San Luis, Argentina".</div>';
    } else {
      resultsBox.innerHTML = _locSearchResults.map((r, i) =>
        `<button type="button" class="loc-result-item" onclick="selectLocation(${i})">${r.display_name}</button>`
      ).join('');
    }
  } catch(e) {
    toast('⚠️', 'Error al buscar. Verificá tu conexión.');
  }
  btn.innerHTML = '📍 Buscar';
}

function selectLocation(idx) {
  const r = _locSearchResults[idx]; if (!r) return;
  geoC = { lat: parseFloat(r.lat).toFixed(5), lng: parseFloat(r.lon).toFixed(5) };
  document.getElementById('locSearch').value = r.display_name.split(',').slice(0, 3).join(',').trim();
  document.getElementById('locResults').style.display = 'none';
  _showLocOnPicker(geoC.lat, geoC.lng, null);
  toast('📍', 'Ubicación seleccionada', 'ok');
}

function _showLocOnPicker(lat, lng, label) {
  if (label) document.getElementById('locSearch').value = label;
  document.getElementById('locCoords').textContent = `${lat}, ${lng}`;
  document.getElementById('locBottom').style.display = 'flex';
  const mapEl = document.getElementById('locMapPreview');
  mapEl.style.display = 'block';
  setTimeout(() => {
    if (locPickerMap) { locPickerMap.remove(); locPickerMap = null; }
    locPickerMap = L.map(mapEl, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(locPickerMap);
    const ll = [parseFloat(lat), parseFloat(lng)];
    locPickerMap.setView(ll, 13);
    L.circleMarker(ll, { radius: 8, color: '#e8ff47', fillColor: '#e8ff47', fillOpacity: 1, weight: 3 }).addTo(locPickerMap);
  }, 80);
}

function clearLocation() {
  geoC = null;
  const el = id => document.getElementById(id);
  if (el('locSearch'))     el('locSearch').value = '';
  if (el('locResults'))    el('locResults').style.display    = 'none';
  if (el('locMapPreview')) el('locMapPreview').style.display = 'none';
  if (el('locBottom'))     el('locBottom').style.display     = 'none';
  if (locPickerMap) { locPickerMap.remove(); locPickerMap = null; }
}

async function fetchW() {
  const city = document.getElementById('wCity').value.trim(); if (!city) { toast('⚠️', 'Ingresá el nombre de la ciudad'); return; }
  const btn = document.querySelector('.wfbtn'); btn.innerHTML = '<span class="spin"></span>';
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const data = await res.json(); const cur = data.current_condition[0];
    const desc = cur.weatherDesc[0].value;
    const im = {'Sunny':'☀️','Clear':'☀️','Partly':'⛅','Cloud':'☁️','Overcast':'☁️','Mist':'🌫','Rain':'🌧','Snow':'❄️','Thunder':'⛈','Blizzard':'🌨'};
    let icon = '🌡'; for (const [k,v] of Object.entries(im)) { if (desc.includes(k)) { icon = v; break; } }
    wData = { temp: cur.temp_C, desc, icon };
    document.getElementById('wicon').textContent = icon;
    document.getElementById('wtemp').textContent = `${cur.temp_C}°C`;
    document.getElementById('wdesc').textContent = desc;
    document.getElementById('wbox').style.display = 'flex';
    toast('🌡', `${city}: ${cur.temp_C}°C, ${desc}`, 'ok');
  } catch(e) { toast('⚠️', 'No se pudo obtener el clima'); }
  btn.textContent = '🌡 FETCH';
}

async function saveRace() {
  if (!currentUser?.isAdmin) return;
  const name = document.getElementById('rName').value.trim();
  const date = document.getElementById('rDate').value;
  if (!name || !date) { toast('⚠️', 'Nombre y fecha son requeridos'); return; }

  const saveBtn = document.querySelector('#addRaceOv .btn-accent');
  saveBtn.innerHTML = '<span class="spin"></span> Guardando...'; saveBtn.disabled = true;

  try {
    const raceId = editId || 'r_' + Date.now();
    let photoURL = racePhotoURL, photoPath = null;

    // Si hay un archivo nuevo, subirlo a Storage
    if (racePhotoFile && FB_READY) {
      toast('📤', 'Subiendo foto...', 'ok');
      photoPath = `races/${raceId}/cover_${Date.now()}`;
      const result = await uploadPhoto(racePhotoFile, photoPath);
      photoURL = result.url;
      photoPath = result.path;
    }

    const existingRace = races.find(r => r.id === editId);
    const race = {
      id: raceId, name, date,
      type:        document.getElementById('rType').value,
      provincia:   document.getElementById('rProv').value,
      city:        document.getElementById('rCity').value.trim(),
      distances:   [...selDists],
      url:         document.getElementById('rUrl').value.trim(),
      description: document.getElementById('rDesc').value.trim(),
      photo:       photoURL || null,
      photoPath:   photoPath || (existingRace?.photoPath || null),
      coords:      geoC,
      weather:     wData,
      featured:    document.getElementById('rFeatured').checked,
      participations: existingRace?.participations || []
    };

    if (FB_READY) {
      await fbSaveRace(race);
    } else {
      if (editId) { races = races.map(r => r.id === editId ? race : r); }
      else { races.push(race); }
      filtered = [...races]; renderAll();
    }

    cm('addRaceOv');
    toast('🏔', `"${name}" guardada y visible para todos`, 'ok');
  } catch(e) {
    console.error(e);
    toast('❌', 'Error al guardar. Revisá la consola.');
  }

  saveBtn.innerHTML = 'GUARDAR CARRERA'; saveBtn.disabled = false;
}

async function delRace(id) {
  if (!currentUser?.isAdmin) return;
  const r = races.find(x => x.id === id);
  if (!r || !confirm(`¿Eliminar "${r.name}"? Esta acción no se puede deshacer.`)) return;
  try {
    if (FB_READY) { await fbDeleteRace(id); }
    else { races = races.filter(x => x.id !== id); filtered = filtered.filter(x => x.id !== id); renderAll(); }
    toast('🗑', 'Carrera eliminada');
  } catch(e) { toast('❌', 'Error al eliminar'); }
}

/* ══════════════════════════════════════════
   PARTICIPATION
══════════════════════════════════════════ */
function openPart(raceId) {
  if (!currentUser) { openLogin(); return; }
  partRaceId = raceId; partPhotos = []; curMood = null;
  const r = races.find(x => x.id === raceId);
  document.getElementById('pRaceLabel').textContent = r?.name || '—';
  document.getElementById('pDist').innerHTML = (r?.distances || ['—']).map(d => `<option>${d}</option>`).join('');

  // Buscar registro existente del usuario
  const existing = (r?.participations || []).find(p => p.userId === currentUser.id);

  // Cambiar título y botón según si ya hay datos
  document.querySelector('#partOv .mt').textContent = existing ? 'MI INFORMACIÓN' : 'MIS TIEMPOS';
  document.querySelector('#partOv .btn-accent').textContent = existing ? 'ACTUALIZAR MIS TIEMPOS' : 'GUARDAR MIS TIEMPOS';

  if (existing) {
    document.getElementById('pTime').value    = existing.time     || '';
    document.getElementById('pPos').value     = existing.position || '';
    document.getElementById('pComment').value = existing.comment  || '';
    const distSel = document.getElementById('pDist');
    for (let i = 0; i < distSel.options.length; i++) {
      if (distSel.options[i].value === existing.distance) { distSel.selectedIndex = i; break; }
    }
    if (existing.mood) { curMood = existing.mood; document.querySelector(`.mbtn[data-mood="${existing.mood}"]`)?.classList.add('sel'); }
    if (existing.photos?.length) {
      document.getElementById('ppPrev').innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap">${existing.photos.map(ph => `<img src="${ph}" style="width:66px;height:66px;object-fit:cover;border-radius:6px">`).join('')}</div><p style="font-size:11px;color:var(--muted);margin-top:6px">Agregá más fotos abajo (se suman a las existentes)</p>`;
    } else {
      document.getElementById('ppPrev').innerHTML = '<div class="ui">📸</div><p>Click para subir fotos</p>';
    }
  } else {
    ['pTime','pPos','pComment'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ppPrev').innerHTML = '<div class="ui">📸</div><p>Click para subir fotos</p>';
    document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('sel'));
  }
  oo('partOv');
}

function selMood(m) {
  curMood = m;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('sel'));
  document.querySelector(`.mbtn[data-mood="${m}"]`).classList.add('sel');
}

// partPhotos ahora guarda { file, previewUrl } para subir al guardar
function prevPartPhotos(e) {
  partPhotos = [];
  const files = [...e.target.files]; if (!files.length) return;
  const prev = document.getElementById('ppPrev'); prev.innerHTML = '';
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = ev => {
      partPhotos.push({ file: f, url: ev.target.result });
      prev.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap">${partPhotos.map(p => `<img src="${p.url}" style="width:66px;height:66px;object-fit:cover;border-radius:6px">`).join('')}</div>`;
    };
    reader.readAsDataURL(f);
  });
}

async function savePart() {
  const r = races.find(x => x.id === partRaceId); if (!r) return;
  const saveBtn = document.querySelector('#partOv .btn-accent');
  saveBtn.innerHTML = '<span class="spin"></span> Guardando...'; saveBtn.disabled = true;

  try {
    // Subir fotos nuevas
    const newPhotoURLs = [];
    if (FB_READY && partPhotos.length) {
      toast('📤', `Subiendo ${partPhotos.length} foto(s)...`, 'ok');
      for (let i = 0; i < partPhotos.length; i++) {
        const path = `participations/${partRaceId}/${currentUser.id}_${Date.now()}_${i}`;
        const url = await uploadPartPhoto(partPhotos[i].file, path);
        newPhotoURLs.push(url);
      }
    } else {
      partPhotos.forEach(p => newPhotoURLs.push(p.url));
    }

    // Buscar registro existente
    const existingIdx = (r.participations || []).findIndex(p => p.userId === currentUser.id);
    const existing    = existingIdx >= 0 ? r.participations[existingIdx] : null;

    // Combinar fotos existentes con nuevas
    const allPhotos = [...(existing?.photos || []), ...newPhotoURLs];

    const part = {
      id:        existing?.id || 'p_' + Date.now(),
      userId:    currentUser.id,
      userName:  currentUser.name,
      userPic:   currentUser.picture || null,
      time:      document.getElementById('pTime').value.trim(),
      distance:  document.getElementById('pDist').value,
      position:  document.getElementById('pPos').value,
      mood:      curMood,
      comment:   document.getElementById('pComment').value.trim(),
      photos:    allPhotos,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (FB_READY) {
      const updatedParts = [...(r.participations || [])];
      if (existingIdx >= 0) { updatedParts[existingIdx] = part; }
      else { updatedParts.push(part); }
      const { doc: d2, updateDoc: ud } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await ud(d2(db, 'races', partRaceId), { participations: updatedParts });
    } else {
      r.participations = r.participations || [];
      if (existingIdx >= 0) { r.participations[existingIdx] = part; }
      else { r.participations.push(part); }
      renderCards(); updateStats();
    }

    cm('partOv');
    toast('⏱', existing ? '¡Tus tiempos fueron actualizados!' : '¡Tus tiempos están visibles para todos!', 'ok');
    setTimeout(() => openDetail(partRaceId), 400);
  } catch(e) {
    console.error(e);
    toast('❌', 'Error al guardar tus tiempos');
  }

  const isEdit = document.querySelector('#partOv .mt').textContent === 'MI INFORMACIÓN';
  saveBtn.innerHTML = isEdit ? 'ACTUALIZAR MIS TIEMPOS' : 'GUARDAR MIS TIEMPOS';
  saveBtn.disabled = false;
}

/* ══════════════════════════════════════════
   PAGE LOADER
══════════════════════════════════════════ */
function showPageLoader(show) {
  let el = document.getElementById('pageLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pageLoader';
    el.style.cssText = 'position:fixed;inset:0;z-index:9998;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;transition:opacity .4s';
    el.innerHTML = '<div style="font-family:Bebas Neue,sans-serif;font-size:48px;color:var(--accent);letter-spacing:4px">RUN & TRAIL VM</div><div class="spin" style="width:24px;height:24px;border-width:3px"></div>';
    document.body.appendChild(el);
  }
  if (!show) { el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }
}

function showFirebaseWarning() {
  const w = document.createElement('div');
  w.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(232,255,71,.1);border:1px solid rgba(232,255,71,.3);border-radius:8px;padding:10px 18px;font-size:12px;color:var(--accent);font-family:Space Mono,monospace;z-index:300;text-align:center;max-width:420px;line-height:1.6';
  w.innerHTML = '⚙ Firebase no configurado — modo demo activo.<br>Completá las credenciales en el código para activar login con Google y sincronización en la nube.';
  document.body.appendChild(w);
  setTimeout(() => w.remove(), 8000);
}

/* ══════════════════════════════════════════
   DEMO RACES (sin Firebase)
══════════════════════════════════════════ */
function demoRaces() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), nd = now.getDate();
  const dd = p => new Date(y, m, nd+p).toISOString().split('T')[0];
  return [
    {id:'d1',name:'Ultra Trail Aconcagua',type:'ultra',date:dd(5),provincia:'Mendoza',city:'Las Heras',distances:['50K','100K'],url:'https://example.com',description:'Icónica carrera en la Cordillera de los Andes. Desnivel positivo +4.200m.',photo:null,coords:{lat:'-32.6532',lng:'-70.0112'},weather:{temp:8,desc:'Soleado',icon:'☀️'},participations:[],featured:true},
    {id:'d2',name:'Maratón de Buenos Aires',type:'road',date:dd(12),provincia:'CABA',city:'Buenos Aires',distances:['10K','21K','42K'],url:'https://example.com',description:'La maratón más importante de Argentina por las avenidas porteñas.',photo:null,coords:{lat:'-34.6037',lng:'-58.3816'},weather:{temp:19,desc:'Nublado',icon:'☁️'},participations:[],featured:true},
    {id:'d3',name:'Trail Sierras de Córdoba',type:'trail',date:dd(19),provincia:'Córdoba',city:'Villa Carlos Paz',distances:['21K','42K'],url:'https://example.com',description:'Trail por las sierras cordobesas. Desnivel +1.800m.',photo:null,coords:{lat:'-31.4135',lng:'-64.5009'},weather:{temp:14,desc:'Despejado',icon:'☀️'},participations:[],featured:true},
    {id:'d4',name:'Cross Country Salta',type:'trail',date:dd(28),provincia:'Salta',city:'Salta Capital',distances:['10K','21K'],url:'',description:'Carrera de montaña por los cerros del norte argentino.',photo:null,coords:null,weather:null,participations:[],featured:false},
    {id:'d5',name:'Maratón de Rosario',type:'road',date:dd(34),provincia:'Santa Fe',city:'Rosario',distances:['5K','10K','21K','42K'],url:'',description:'Maratón plana y veloz sobre el costanero del Paraná.',photo:null,coords:null,weather:{temp:22,desc:'Soleado',icon:'☀️'},participations:[],featured:false},
    {id:'d6',name:'100K del Desierto',type:'ultra',date:dd(42),provincia:'San Luis',city:'San Luis',distances:['50K','100K'],url:'',description:'Ultra por el desierto puntano.',photo:null,coords:null,weather:null,participations:[],featured:false},
  ];
}

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
function fd(s) { if(!s) return '—'; const[y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }
function oo(id) { document.getElementById(id).classList.add('open'); }
function cm(id) { document.getElementById(id).classList.remove('open'); }
function coo(e, id) { if (e.target.id === id) cm(id); }

let _tt;
function toast(icon, msg, type='') {
  clearTimeout(_tt);
  const t = document.getElementById('toast');
  document.getElementById('tIcon').textContent = icon;
  document.getElementById('tMsg').textContent  = msg;
  t.className = `toast show ${type}`;
  _tt = setTimeout(() => t.classList.remove('show'), 3400);
}

/* ══════════════════════════════════════════
   TABS
══════════════════════════════════════════ */
let activeTab = 'calendar';
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-dropdown-item').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
  const dtab = document.getElementById('dtab-' + tab);
  if (dtab) dtab.classList.add('active');
  const label = document.getElementById('tabDropdownLabel');
  if (label && dtab) label.textContent = dtab.childNodes[0].textContent.trim();
  if (tab === 'training')       renderTrainingTab();
  if (tab === 'inscripciones')  renderInscripcionesTab();
  if (tab === 'mapa')           renderMapTab();
  if (tab === 'triatlon')       renderTriathlonTab();
}
function toggleTabDropdown() {
  const trigger = document.getElementById('tabDropdownTrigger');
  const menu    = document.getElementById('tabDropdownMenu');
  trigger.classList.toggle('open');
  menu.classList.toggle('open');
}
function closeTabDropdown() {
  document.getElementById('tabDropdownTrigger').classList.remove('open');
  document.getElementById('tabDropdownMenu').classList.remove('open');
}

/* ══════════════════════════════════════════
   STRAVA CONFIG
   Registrate gratis en https://www.strava.com/settings/api
══════════════════════════════════════════ */
const STRAVA_CLIENT_ID     = '213897';           // ← tu Client ID de Strava (strava.com/settings/api)
const FUNCTIONS_BASE_URL   = 'https://us-central1-run-trail-vm.cloudfunctions.net'; // Firebase Cloud Functions (stravaActivities, stravaStreams)
const STRAVA_AUTH_URL      = 'https://strava-auth.runandtrailvm.workers.dev';        // Cloudflare Worker (token exchange)
const STRAVA_REDIRECT      = window.location.origin + window.location.pathname;

/* ══════════════════════════════════════════
   WORKOUTS STATE
══════════════════════════════════════════ */
let workouts        = [];   // array de entrenamientos del usuario actual
let stravaToken     = null;
let linkingWkId     = null;
let wkDetailMapInst = null;
let workoutFilters  = { type: '', year: '', month: '' };
const WK_PAGE_SIZE  = 20;
let wkCurrentPage   = 0;

/* ══════════════════════════════════════════
   TRAINING TAB RENDER
══════════════════════════════════════════ */
let _workoutsListenerActive = false;

function renderTrainingTab() {
  const lock    = document.getElementById('trainLock');
  const content = document.getElementById('trainContent');

  console.log('[tab training] currentUser:', currentUser?.id || 'NULL', '| FB_READY:', FB_READY, '| listener:', _workoutsListenerActive);

  if (!currentUser) {
    lock.style.display = 'block'; content.style.display = 'none';
    console.warn('[tab training] NO HAY USUARIO LOGUEADO — mostrando lock screen');
    return;
  }
  lock.style.display = 'none'; content.style.display = 'block';

  // Cargar workouts solo la primera vez (evitar listeners duplicados)
  if (FB_READY && !_workoutsListenerActive) {
    _workoutsListenerActive = true;
    loadWorkoutsFromFirestore();
  } else if (FB_READY) {
    // Ya hay listener activo, solo re-render con datos actuales
    renderWorkouts();
  } else {
    // Demo workouts locales
    workouts = loadLocalWorkouts();
    renderWorkouts();
  }

  // Strava token check — sessionStorage primero, luego Firestore (persistencia por usuario)
  const st = sessionStorage.getItem('strava_token');
  if (st) {
    stravaToken = JSON.parse(st);
    document.getElementById('stravaDisconnected').style.display = 'none';
    document.getElementById('stravaConnected').style.display    = 'flex';
    document.getElementById('syncStravaBtn').style.display      = 'flex';
  } else if (FB_READY && currentUser) {
    // Intentar recuperar token de Firestore (otro dispositivo / sesión nueva)
    loadStravaTokenFromFirestore();
  }

  // Handle Strava OAuth callback
  const params = new URLSearchParams(window.location.hash.replace('#','?') || window.location.search);
  if (params.get('strava_code') || new URLSearchParams(window.location.search).get('code') && sessionStorage.getItem('strava_pending')) {
    handleStravaCallback();
  }
}

function loadLocalWorkouts() {
  try { return JSON.parse(localStorage.getItem('tg_workouts_' + currentUser?.id) || '[]'); } catch(e) { return []; }
}
function saveLocalWorkouts() {
  try { localStorage.setItem('tg_workouts_' + currentUser?.id, JSON.stringify(workouts)); } catch(e) {}
}

async function loadWorkoutsFromFirestore() {
  try {
    const { collection: col, query: q2, where, getDocs, onSnapshot: ons } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const wkQuery = q2(col(db, 'workouts'), where('userId','==', currentUser.id));

    // Fetch inmediato para mostrar datos enseguida
    const snap = await getDocs(wkQuery);
    workouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Deduplicar por id por seguridad
    workouts = [...new Map(workouts.map(w => [w.id, w])).values()];
    workouts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    renderWorkouts();

    if (snap.empty) {
      console.log('[workouts] Firestore query returned 0 docs. userId:', currentUser.id);
    } else {
      console.log('[workouts] Loaded', snap.docs.length, 'workouts from Firestore');
    }

    // Listener en tiempo real para actualizaciones (sync posterior)
    ons(wkQuery,
      s => {
        workouts = s.docs.map(d => ({ id: d.id, ...d.data() }));
        workouts = [...new Map(workouts.map(w => [w.id, w])).values()];
        workouts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        renderWorkouts();
      },
      err => {
        console.warn('[workouts] Firestore listener error:', err.code, err.message);
        toast('⚠️', 'Error Firestore: ' + err.code);
      }
    );
  } catch(e) {
    console.error('[workouts] loadWorkoutsFromFirestore error:', e.code || e.message);
    toast('⚠️', 'Error cargando entrenamientos: ' + (e.code || e.message));
    workouts = loadLocalWorkouts();
    renderWorkouts();
  }
}

async function saveWorkoutToFirestore(wk) {
  try {
    const { doc: d2, setDoc: sd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { id, ...rawData } = wk;
    // Firestore no acepta valores undefined — los eliminamos antes de guardar
    const data = Object.fromEntries(Object.entries(rawData).filter(([, v]) => v !== undefined));
    await sd(d2(db, 'workouts', id), data);
    console.log('[workouts] Guardado en Firestore:', id);
  } catch(e) {
    console.error('[workouts] Error al guardar en Firestore:', e.code, e.message, '| workout id:', wk.id);
    // No agregamos wk al array aquí — syncStrava lo hace siempre después de esta llamada
  }
}

async function deleteWorkoutFromFirestore(id) {
  try {
    const { doc: d2, deleteDoc: dd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await dd(d2(db, 'workouts', id));
  } catch(e) {
    workouts = workouts.filter(w => w.id !== id); saveLocalWorkouts();
  }
}

/* ══════════════════════════════════════════
   RENDER WORKOUT CARDS
══════════════════════════════════════════ */
const WK_TYPE_ICONS = { run:'🏃', trail:'🏔', cycling:'🚴', swimming:'🏊', other:'⚡' };
const WK_TYPE_LABELS = { run:'Running', trail:'Trail Run', cycling:'Ciclismo', swimming:'Natación', other:'Otro' };

function renderWorkouts() {
  const grid  = document.getElementById('trainGrid');
  const badge = document.getElementById('trainBadge');

  // Populate year filter options dynamically
  populateWkYearFilter();

  // Update badge (total unfiltered)
  badge.textContent = workouts.length;
  badge.style.display = workouts.length ? 'inline' : 'none';
  const badgeMob = document.getElementById('trainBadgeMob');
  if (badgeMob) { badgeMob.textContent = workouts.length; badgeMob.style.display = workouts.length ? 'inline' : 'none'; }

  // Update summary stats (always all workouts)
  updateTrainSummary();

  // Monthly chart
  renderMonthlyStats();

  // Apply filters
  const filtered = getFilteredWorkouts();
  const toShow   = filtered.slice(0, (wkCurrentPage + 1) * WK_PAGE_SIZE);

  // Update filter count label
  const countEl = document.getElementById('wkFilterCount');
  if (countEl) {
    const hasFilter = workoutFilters.type || workoutFilters.year || workoutFilters.month;
    countEl.textContent = hasFilter ? `${filtered.length} de ${workouts.length}` : `${workouts.length} actividades`;
  }

  // Empty states
  if (!filtered.length) {
    grid.innerHTML = workouts.length
      ? `<div class="train-empty"><div class="ei">🔍</div><h3>SIN RESULTADOS</h3><p>No hay actividades que coincidan con los filtros seleccionados.</p></div>`
      : `<div class="train-empty"><div class="ei">🏃</div><h3>SIN ENTRENAMIENTOS AÚN</h3><p>Subí un archivo <strong>GPX</strong> o <strong>FIT</strong> desde Garmin Connect,<br>o conectá tu cuenta de <strong>Strava</strong> para sincronizar.</p></div>`;
    const lm = document.getElementById('wkLoadMore');
    if (lm) lm.classList.remove('visible');
    return;
  }

  // Destroy old Leaflet instances before rebuilding DOM
  Object.keys(miniMaps).forEach(k => { try { miniMaps[k].remove(); } catch(e) {} delete miniMaps[k]; });

  grid.innerHTML = toShow.map(w => buildWkCard(w)).join('');
  toShow.forEach(w => { if (w.track && w.track.length) renderMiniMap(w.id, w.track); });

  // Load more button
  const lm = document.getElementById('wkLoadMore');
  if (lm) {
    const remaining = filtered.length - toShow.length;
    if (remaining > 0) {
      lm.classList.add('visible');
      const info = document.getElementById('wkLoadMoreInfo');
      if (info) info.textContent = `Mostrando ${toShow.length} de ${filtered.length} actividades`;
    } else {
      lm.classList.remove('visible');
    }
  }
}

function getFilteredWorkouts() {
  return workouts.filter(w => {
    if (workoutFilters.type  && w.type !== workoutFilters.type) return false;
    if (workoutFilters.year  && !(w.date || '').startsWith(workoutFilters.year)) return false;
    if (workoutFilters.month && (w.date || '').substring(5, 7) !== workoutFilters.month) return false;
    return true;
  });
}

function populateWkYearFilter() {
  const sel = document.getElementById('wfYear');
  if (!sel) return;
  const currentVal = sel.value;
  const years = [...new Set(workouts.map(w => (w.date || '').substring(0, 4)).filter(Boolean))].sort((a, b) => b - a);
  sel.innerHTML = '<option value="">Todos</option>' + years.map(y => `<option value="${y}"${y === currentVal ? ' selected' : ''}>${y}</option>`).join('');
}

function applyWkFilters() {
  workoutFilters.type  = document.getElementById('wfType').value;
  workoutFilters.year  = document.getElementById('wfYear').value;
  workoutFilters.month = document.getElementById('wfMonth').value;
  wkCurrentPage = 0;
  renderWorkouts();
}

function clearWkFilters() {
  workoutFilters = { type: '', year: '', month: '' };
  ['wfType','wfYear','wfMonth'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  wkCurrentPage = 0;
  renderWorkouts();
}

function loadMoreWorkouts() {
  wkCurrentPage++;
  // Append new cards without destroying existing ones
  const filtered = getFilteredWorkouts();
  const start    = wkCurrentPage * WK_PAGE_SIZE;
  const batch    = filtered.slice(start, start + WK_PAGE_SIZE);
  const grid     = document.getElementById('trainGrid');
  if (grid && batch.length) {
    grid.insertAdjacentHTML('beforeend', batch.map(w => buildWkCard(w)).join(''));
    batch.forEach(w => { if (w.track && w.track.length) renderMiniMap(w.id, w.track); });
  }
  const lm   = document.getElementById('wkLoadMore');
  const info = document.getElementById('wkLoadMoreInfo');
  const shown = Math.min((wkCurrentPage + 1) * WK_PAGE_SIZE, filtered.length);
  if (shown >= filtered.length) {
    if (lm) lm.classList.remove('visible');
  } else {
    if (info) info.textContent = `Mostrando ${shown} de ${filtered.length} actividades`;
  }
}

function buildWkCard(w) {
  const typeIcon  = WK_TYPE_ICONS[w.type]  || '🏃';
  const typeLbl   = WK_TYPE_LABELS[w.type] || w.type;
  const dist      = w.distance ? (w.distance / 1000).toFixed(2) : '—';
  const timeStr   = w.movingTime ? formatDuration(w.movingTime) : '—';
  const pace      = w.distance && w.movingTime ? formatPace(w.movingTime / (w.distance / 1000)) : '—';
  const elev      = w.totalElevGain ? Math.round(w.totalElevGain) + 'm' : '—';
  const linked    = w.linkedRaceId ? races.find(r => r.id === w.linkedRaceId) : null;

  return `<div class="wk-card" id="wkcard-${w.id}">
    <div class="wk-map" onclick="openWkDetail('${w.id}')">
      ${w.track && w.track.length
        ? `<div class="wk-map-inner" id="minimap-${w.id}"></div>`
        : `<div class="wk-map-ph">${typeIcon}</div>`}
      <div class="wk-type-badge">
        <span class="bdg bdg-${w.type === 'trail' ? 'trail' : w.type === 'cycling' ? 'ultra' : 'road'}">${typeIcon} ${typeLbl}</span>
      </div>
      ${w.source === 'strava' ? '<span style="position:absolute;top:8px;right:8px;background:#fc4c02;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:100px;font-family:Space Mono,monospace">STRAVA</span>' : ''}
      ${w.source === 'gpx'    ? '<span style="position:absolute;top:8px;right:8px;background:var(--accent);color:#0c0c0a;font-size:9px;font-weight:700;padding:2px 7px;border-radius:100px;font-family:Space Mono,monospace">GPX</span>' : ''}
    </div>
    <div class="wk-body" onclick="openWkDetail('${w.id}')">
      <div class="wk-name">${w.name || 'Entrenamiento'}</div>
      <div class="wk-date">${fdLong(w.date)}${linked ? ' · 🏆 '+linked.name : ''}</div>
      <div class="wk-stats">
        <div class="wk-stat"><div class="wsl">Dist</div><div class="wsv">${dist} km</div></div>
        <div class="wk-stat"><div class="wsl">Tiempo</div><div class="wsv">${timeStr}</div></div>
        <div class="wk-stat"><div class="wsl">Ritmo</div><div class="wsv">${pace}</div></div>
        <div class="wk-stat"><div class="wsl">Desnivel</div><div class="wsv">${elev}</div></div>
      </div>
    </div>
    <div class="wk-foot">
      <button class="wk-link-race" onclick="openLinkRace('${w.id}')">🏆 ${linked ? 'Carrera vinculada' : 'Vincular carrera'}</button>
      <button class="wk-del" onclick="deleteWorkout('${w.id}')">🗑</button>
    </div>
  </div>`;
}

function updateTrainSummary() {
  const totalDist  = workouts.reduce((a, w) => a + (w.distance || 0), 0) / 1000;
  const totalTime  = workouts.reduce((a, w) => a + (w.movingTime || 0), 0) / 3600;
  const totalElev  = workouts.reduce((a, w) => a + (w.totalElevGain || 0), 0);
  document.getElementById('tsSumAct').textContent  = workouts.length;
  document.getElementById('tsSumDist').textContent = totalDist.toFixed(1);
  document.getElementById('tsSumTime').textContent = totalTime.toFixed(1);
  document.getElementById('tsSumElev').textContent = Math.round(totalElev);
}

/* ══════════════════════════════════════════
   MONTHLY KM CHART
══════════════════════════════════════════ */
function renderMonthlyStats() {
  const wrap = document.getElementById('monthlyChartWrap');
  if (!wrap) return;
  if (!workouts.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  // Build last 12 months
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().substring(0, 7);
    months.push({ key, label: d.toLocaleString('es', { month: 'short' }) + '\'' + String(d.getFullYear()).slice(2), km: 0 });
  }
  workouts.forEach(w => {
    const mo = months.find(m => m.key === (w.date || '').substring(0, 7));
    if (mo) mo.km += (w.distance || 0) / 1000;
  });
  months.forEach(m => { m.km = Math.round(m.km * 10) / 10; });

  const canvas = document.getElementById('monthlyChartCanvas');
  if (!canvas) return;
  drawBarChart(canvas, months.map(m => m.km), months.map(m => m.label));
}

function drawBarChart(canvas, values, labels) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 600;
  const H   = 140;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const maxV   = Math.max(...values, 1);
  const n      = values.length;
  const pad    = 10;
  const botPad = 28;
  const topPad = 18;
  const chartW = W - pad * 2;
  const chartH = H - botPad - topPad;
  const gap    = chartW / n;
  const barW   = gap * 0.65;

  ctx.clearRect(0, 0, W, H);

  values.forEach((v, i) => {
    const barH = (v / maxV) * chartH;
    const x    = pad + i * gap + (gap - barW) / 2;
    const y    = topPad + chartH - barH;

    const grad = ctx.createLinearGradient(0, y, 0, topPad + chartH);
    grad.addColorStop(0, '#e8ff47');
    grad.addColorStop(1, 'rgba(232,255,71,0.25)');
    ctx.fillStyle = barH > 0 ? grad : 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, barH > 0 ? y : topPad + chartH - 2, barW, barH > 0 ? barH : 2, [3, 3, 0, 0]);
    } else {
      ctx.rect(x, barH > 0 ? y : topPad + chartH - 2, barW, barH > 0 ? barH : 2);
    }
    ctx.fill();

    if (v > 0) {
      ctx.fillStyle = '#e8ff47';
      ctx.font = `bold ${10}px 'Space Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(v >= 10 ? Math.round(v) : v, x + barW / 2, y - 4);
    }

    ctx.fillStyle = 'rgba(168,216,181,0.75)';
    ctx.font = `${9}px 'Space Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, H - 8);
  });
}

/* ══════════════════════════════════════════
   MINI-MAP (Leaflet)
══════════════════════════════════════════ */
const miniMaps = {};
function renderMiniMap(wkId, track) {
  const el = document.getElementById('minimap-' + wkId);
  if (!el || miniMaps[wkId]) return;
  try {
    const map = L.map(el, { zoomControl:false, dragging:false, scrollWheelZoom:false, attributionControl:false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
    const latlngs = track.map(p => [p.lat, p.lng]);
    const poly = L.polyline(latlngs, { color:'#e8ff47', weight:2.5, opacity:.9 }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding:[8,8] });
    // Start/end markers
    if (latlngs.length) {
      L.circleMarker(latlngs[0],  { radius:5, color:'#3ecf7a', fillColor:'#3ecf7a', fillOpacity:1, weight:2 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length-1], { radius:5, color:'#ff6b35', fillColor:'#ff6b35', fillOpacity:1, weight:2 }).addTo(map);
    }
    miniMaps[wkId] = map;
  } catch(e) {}
}

/* ══════════════════════════════════════════
   WORKOUT DETAIL MODAL
══════════════════════════════════════════ */
function openWkDetail(id) {
  const w = workouts.find(x => x.id === id); if (!w) return;
  document.getElementById('wkDetailName').textContent = w.name || 'Entrenamiento';
  document.getElementById('wkDetailSub').textContent  = fdLong(w.date) + (w.source === 'strava' ? ' · Strava' : w.source === 'gpx' ? ' · GPX/FIT' : '');
  const dist    = w.distance   ? (w.distance / 1000).toFixed(2) : null;
  const pace    = dist && w.movingTime ? formatPace(w.movingTime / parseFloat(dist)) : null;
  const speedKh = w.distance && w.movingTime ? ((w.distance / w.movingTime) * 3.6).toFixed(1) : null;

  document.getElementById('wkDetailBody').innerHTML = `
    ${w.track && w.track.length ? `<div class="wk-detail-map" id="wkDetailMap"></div>` : ''}
    <div class="wk-metrics">
      ${dist          ? `<div class="wm"><div class="wml">Distancia</div><div class="wmv">${dist}</div><div class="wmu">km</div></div>` : ''}
      ${w.movingTime  ? `<div class="wm"><div class="wml">Tiempo</div><div class="wmv">${formatDuration(w.movingTime)}</div></div>` : ''}
      ${pace          ? `<div class="wm"><div class="wml">Ritmo</div><div class="wmv">${pace}</div><div class="wmu">min/km</div></div>` : ''}
      ${speedKh       ? `<div class="wm"><div class="wml">Velocidad</div><div class="wmv">${speedKh}</div><div class="wmu">km/h</div></div>` : ''}
      ${w.totalElevGain ? `<div class="wm"><div class="wml">Desnivel +</div><div class="wmv">${Math.round(w.totalElevGain)}</div><div class="wmu">m</div></div>` : ''}
      ${w.avgHeartrate  ? `<div class="wm"><div class="wml">FC media</div><div class="wmv">${Math.round(w.avgHeartrate)}</div><div class="wmu">bpm</div></div>` : ''}
      ${w.maxHeartrate  ? `<div class="wm"><div class="wml">FC máxima</div><div class="wmv">${w.maxHeartrate}</div><div class="wmu">bpm</div></div>` : ''}
      ${w.avgCadence    ? `<div class="wm"><div class="wml">Cadencia</div><div class="wmv">${Math.round(w.avgCadence * 2)}</div><div class="wmu">ppm</div></div>` : ''}
      ${w.calories      ? `<div class="wm"><div class="wml">Calorías</div><div class="wmv">${w.calories}</div><div class="wmu">kcal</div></div>` : ''}
    </div>
    ${w.elevProfile && w.elevProfile.length ? `
      <div class="elev-chart">
        <div style="font-size:10px;font-family:'Space Mono',monospace;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Perfil de elevación</div>
        <canvas id="elevCanvas"></canvas>
      </div>` : ''}
    ${w.hrStream && w.hrStream.length ? `
      <div class="hr-chart">
        <div style="font-size:10px;font-family:'Space Mono',monospace;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Frecuencia cardíaca</div>
        <canvas id="hrCanvas"></canvas>
      </div>` : ''}
    <div class="act-row" style="margin-top:8px">
      <button class="act-btn" onclick="openLinkRace('${w.id}')">🏆 Vincular a carrera</button>
      ${w.stravaUrl ? `<a class="act-btn" href="${w.stravaUrl}" target="_blank">🔗 Ver en Strava</a>` : ''}
      <button class="act-btn" style="color:#ff6b6b;border-color:rgba(255,68,68,.3)" onclick="cm('wkDetailOv');deleteWorkout('${w.id}')">🗑 Eliminar</button>
    </div>
  `;
  oo('wkDetailOv');

  // Render detail map
  if (w.track && w.track.length) {
    setTimeout(() => {
      if (wkDetailMapInst) { wkDetailMapInst.remove(); wkDetailMapInst = null; }
      const mapEl = document.getElementById('wkDetailMap');
      if (!mapEl) return;
      wkDetailMapInst = L.map(mapEl, { attributionControl:false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(wkDetailMapInst);
      const latlngs = w.track.map(p => [p.lat, p.lng]);
      const poly = L.polyline(latlngs, { color:'#e8ff47', weight:3, opacity:1 }).addTo(wkDetailMapInst);
      wkDetailMapInst.fitBounds(poly.getBounds(), { padding:[20,20] });
      L.circleMarker(latlngs[0],  { radius:7, color:'#3ecf7a', fillColor:'#3ecf7a', fillOpacity:1, weight:2 }).bindPopup('Inicio').addTo(wkDetailMapInst);
      L.circleMarker(latlngs[latlngs.length-1], { radius:7, color:'#ff6b35', fillColor:'#ff6b35', fillOpacity:1, weight:2 }).bindPopup('Fin').addTo(wkDetailMapInst);
    }, 100);
  }

  // Elevation chart
  if (w.elevProfile && w.elevProfile.length) {
    setTimeout(() => {
      const ctx = document.getElementById('elevCanvas');
      if (!ctx) return;
      drawSimpleChart(ctx, w.elevProfile, '#e8ff47', 'rgba(232,255,71,0.15)');
    }, 150);
  }

  // HR chart
  if (w.hrStream && w.hrStream.length) {
    setTimeout(() => {
      const ctx = document.getElementById('hrCanvas');
      if (!ctx) return;
      drawSimpleChart(ctx, w.hrStream, '#ff6b35', 'rgba(255,107,53,0.15)');
    }, 150);
  }
}

function drawSimpleChart(canvas, data, lineColor, fillColor) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.offsetWidth || 600;
  const h = parseInt(canvas.style.height || canvas.height || 120);
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const step = w / (data.length - 1);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 12) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0, fillColor);
  grad.addColorStop(1, 'transparent');
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 2;
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
}

/* ══════════════════════════════════════════
   GPX / TCX PARSER
══════════════════════════════════════════ */
async function handleGpxUpload(event) {
  const files = [...event.target.files]; if (!files.length) return;
  toast('📂', `Procesando ${files.length} archivo(s)...`, 'ok');
  for (const file of files) {
    try {
      const text = await file.text();
      let wk;
      if (file.name.toLowerCase().endsWith('.gpx') || file.name.toLowerCase().endsWith('.tcx')) {
        wk = parseGPX(text, file.name);
      } else if (file.name.toLowerCase().endsWith('.fit')) {
        wk = parseFITFallback(file.name); // FIT necesita librería extra — fallback manual
      }
      if (wk) {
        wk.userId = currentUser.id;
        if (FB_READY) { await saveWorkoutToFirestore(wk); }
        else { workouts.unshift(wk); saveLocalWorkouts(); renderWorkouts(); }
        toast('✅', `"${wk.name}" importado`, 'ok');
      }
    } catch(e) {
      console.error(e);
      toast('⚠️', `Error al procesar ${file.name}`);
    }
  }
  event.target.value = '';
}

function parseGPX(xmlText, filename) {
  const parser = new DOMParser();
  const xml    = parser.parseFromString(xmlText, 'text/xml');
  const ns     = xml.documentElement.tagName === 'gpx' ? '' : '';
  const isTCX  = filename.toLowerCase().endsWith('.tcx');

  // GPX
  const trkpts = [...xml.querySelectorAll('trkpt')];
  let track = [], elevProfile = [], hrStream = [], cadStream = [];

  if (trkpts.length) {
    trkpts.forEach(pt => {
      const lat  = parseFloat(pt.getAttribute('lat'));
      const lng  = parseFloat(pt.getAttribute('lon'));
      const ele  = parseFloat(pt.querySelector('ele')?.textContent || '0');
      const hr   = parseInt(pt.querySelector('hr, heartrate, HeartRateBpm value')?.textContent || '0');
      const cad  = parseInt(pt.querySelector('cad, cadence')?.textContent || '0');
      track.push({ lat, lng });
      elevProfile.push(ele);
      if (hr)  hrStream.push(hr);
      if (cad) cadStream.push(cad);
    });
  }

  // TCX
  const tcxPts = [...xml.querySelectorAll('Trackpoint')];
  if (tcxPts.length && !trkpts.length) {
    tcxPts.forEach(pt => {
      const lat = parseFloat(pt.querySelector('LatitudeDegrees')?.textContent || '0');
      const lng = parseFloat(pt.querySelector('LongitudeDegrees')?.textContent || '0');
      const ele = parseFloat(pt.querySelector('AltitudeMeters')?.textContent   || '0');
      const hr  = parseInt(pt.querySelector('HeartRateBpm Value')?.textContent || '0');
      const cad = parseInt(pt.querySelector('RunCadence, Cadence')?.textContent || '0');
      if (lat && lng) { track.push({ lat, lng }); elevProfile.push(ele); }
      if (hr)  hrStream.push(hr);
      if (cad) cadStream.push(cad);
    });
  }

  // Metrics from GPX metadata
  const nameEl = xml.querySelector('name, trk > name');
  const timeEl = xml.querySelector('time, metadata time');
  const dist   = calcTrackDistance(track);
  const elevGain = calcElevGain(elevProfile);
  const timeSpan = calcTimeSpan(xml);

  // Decimate track for storage (max 500 points)
  const decimated = decimateTrack(track, 500);
  const elevDec   = decimateArray(elevProfile, 200);
  const hrDec     = decimateArray(hrStream, 200);

  return {
    id:            'wk_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    name:          nameEl?.textContent?.trim() || filename.replace(/\.(gpx|tcx|fit)$/i,''),
    date:          timeEl?.textContent?.split('T')[0] || new Date().toISOString().split('T')[0],
    type:          guessType(nameEl?.textContent || filename, dist),
    source:        'gpx',
    distance:      dist,
    movingTime:    timeSpan,
    totalElevGain: elevGain,
    avgHeartrate:  hrDec.length ? Math.round(hrDec.reduce((a,v)=>a+v,0)/hrDec.length) : null,
    maxHeartrate:  hrDec.length ? Math.max(...hrDec) : null,
    avgCadence:    cadStream.length ? Math.round(cadStream.reduce((a,v)=>a+v,0)/cadStream.length) : null,
    track:         decimated,
    elevProfile:   elevDec,
    hrStream:      hrDec,
    linkedRaceId:  null
  };
}

function parseFITFallback(filename) {
  // FIT es formato binario — mostrar instrucciones
  toast('ℹ️', 'Los archivos .FIT requieren conversión. En Garmin Connect: Actividad → ··· → Exportar GPX');
  return null;
}

function calcTrackDistance(track) {
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    total += haversine(track[i-1].lat, track[i-1].lng, track[i].lat, track[i].lng);
  }
  return total; // metros
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcElevGain(elev) {
  let gain = 0;
  for (let i = 1; i < elev.length; i++) { const d = elev[i]-elev[i-1]; if (d > 0) gain += d; }
  return gain;
}

function calcTimeSpan(xml) {
  const times = [...xml.querySelectorAll('time, Time')].map(t => new Date(t.textContent).getTime()).filter(Boolean);
  if (times.length < 2) return null;
  return Math.round((Math.max(...times) - Math.min(...times)) / 1000);
}

function decimateTrack(track, maxPts) {
  if (track.length <= maxPts) return track;
  const step = Math.ceil(track.length / maxPts);
  return track.filter((_, i) => i % step === 0);
}

function decimateArray(arr, maxPts) {
  if (arr.length <= maxPts) return arr;
  const step = Math.ceil(arr.length / maxPts);
  return arr.filter((_, i) => i % step === 0);
}

function guessType(name, dist) {
  const n = (name || '').toLowerCase();
  if (n.includes('trail') || n.includes('mountain') || n.includes('monte')) return 'trail';
  if (n.includes('cycling') || n.includes('bici') || n.includes('ciclismo')) return 'cycling';
  if (n.includes('swim') || n.includes('natación')) return 'swimming';
  if (dist > 5000) return 'run';
  return 'run';
}

/* ══════════════════════════════════════════
   STRAVA OAUTH (Authorization Code Flow)
══════════════════════════════════════════ */
function connectStrava() {
  if (STRAVA_CLIENT_ID === 'TU_STRAVA_CLIENT_ID') {
    toast('⚙️', 'Configurá STRAVA_CLIENT_ID en el código. Registrate gratis en strava.com/settings/api');
    return;
  }
  sessionStorage.setItem('strava_pending', '1');
  const scope = 'activity:read_all';
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT)}&response_type=code&scope=${scope}`;
  window.location.href = url;
}

async function handleStravaCallback() {
  sessionStorage.removeItem('strava_pending');
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return;
  window.history.replaceState({}, document.title, window.location.pathname);
  toast('⏳', 'Conectando con Strava...');
  // El intercambio code → token se hace en el Cloudflare Worker para no exponer el client_secret
  if (STRAVA_AUTH_URL.includes('TU_SUBDOMINIO')) {
    toast('⚙️', 'Configurá STRAVA_AUTH_URL con la URL de tu Cloudflare Worker.');
    return;
  }
  try {
    const res = await fetch(STRAVA_AUTH_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code, grant_type:'authorization_code' })
    });
    const data = await res.json();
    if (data.access_token) {
      stravaToken = data;
      sessionStorage.setItem('strava_token', JSON.stringify(data));
      await saveStravaTokenToFirestore(data);
      document.getElementById('stravaDisconnected').style.display = 'none';
      document.getElementById('stravaConnected').style.display    = 'flex';
      document.getElementById('syncStravaBtn').style.display      = 'flex';
      toast('🟠', '¡Strava conectado! Sincronizando actividades...', 'ok');
      await syncStrava();
    } else {
      toast('⚠️', 'Error al conectar Strava. Verificá las credenciales.');
    }
  } catch(e) {
    toast('⚠️', 'Error de conexión con Strava.');
  }
}

function disconnectStrava() {
  stravaToken = null;
  sessionStorage.removeItem('strava_token');
  deleteStravaTokenFromFirestore();
  document.getElementById('stravaDisconnected').style.display = 'flex';
  document.getElementById('stravaConnected').style.display    = 'none';
  document.getElementById('syncStravaBtn').style.display      = 'none';
  toast('👋', 'Strava desconectado');
}

/* ══════════════════════════════════════════
   STRAVA TOKEN AUTO-REFRESH
══════════════════════════════════════════ */
async function ensureFreshToken() {
  if (!stravaToken) return false;
  // expires_at is Unix seconds — refresh 60s before expiry
  const expiresAt = stravaToken.expires_at || 0;
  if (Date.now() / 1000 < expiresAt - 60) return true; // still valid

  toast('🔄', 'Renovando token de Strava...', 'ok');
  try {
    const res = await fetch(STRAVA_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: stravaToken.refresh_token })
    });
    const data = await res.json();
    if (data.access_token) {
      stravaToken = { ...stravaToken, ...data };
      sessionStorage.setItem('strava_token', JSON.stringify(stravaToken));
      await saveStravaTokenToFirestore(stravaToken);
      toast('✅', 'Token de Strava renovado', 'ok');
      return true;
    }
  } catch(e) { console.error('[strava] refresh error:', e); }
  toast('⚠️', 'Token de Strava expirado. Reconectá tu cuenta.');
  disconnectStrava();
  return false;
}

/* ══════════════════════════════════════════
   STRAVA TOKEN PERSISTENCE (Firestore por usuario)
══════════════════════════════════════════ */
async function saveStravaTokenToFirestore(tokenData) {
  if (!FB_READY || !currentUser) return;
  try {
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    // Solo guardamos los campos esenciales — no el access_token (expira igual)
    const toSave = {
      refresh_token: tokenData.refresh_token,
      expires_at:    tokenData.expires_at,
      athlete:       tokenData.athlete || null,
      updatedAt:     new Date().toISOString()
    };
    await setDoc(doc(db, 'strava_tokens', currentUser.id), toSave);
  } catch(e) { console.warn('[strava] no se pudo guardar token en Firestore:', e.message); }
}

async function loadStravaTokenFromFirestore() {
  if (!FB_READY || !currentUser) return;
  try {
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'strava_tokens', currentUser.id));
    if (!snap.exists()) return;
    const saved = snap.data();
    // Tenemos refresh_token guardado → renovamos para obtener access_token fresco
    const res = await fetch(STRAVA_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: saved.refresh_token })
    });
    const fresh = await res.json();
    if (fresh.access_token) {
      stravaToken = fresh;
      sessionStorage.setItem('strava_token', JSON.stringify(fresh));
      await saveStravaTokenToFirestore(fresh);
      document.getElementById('stravaDisconnected').style.display = 'none';
      document.getElementById('stravaConnected').style.display    = 'flex';
      document.getElementById('syncStravaBtn').style.display      = 'flex';
      console.log('[strava] Token restaurado desde Firestore para', currentUser.id);
    }
  } catch(e) { console.warn('[strava] no se pudo restaurar token desde Firestore:', e.message); }
}

async function deleteStravaTokenFromFirestore() {
  if (!FB_READY || !currentUser) return;
  try {
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await deleteDoc(doc(db, 'strava_tokens', currentUser.id));
  } catch(e) {}
}

async function syncStrava() {
  if (!stravaToken) return;
  const ok = await ensureFreshToken();
  if (!ok) return;

  const spin = document.getElementById('syncSpin');
  spin.style.display = 'inline-block';
  toast('🔄', 'Sincronizando actividades de Strava...', 'ok');
  try {
    // Fetch ALL activities via pagination — Strava max 200/page
    let allActivities = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`,
        { headers: { 'Authorization': `Bearer ${stravaToken.access_token}` } }
      );
      if (res.status === 401) {
        toast('⚠️', 'Token de Strava inválido. Reconectá tu cuenta.');
        disconnectStrava(); spin.style.display = 'none'; return;
      }
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      allActivities = allActivities.concat(batch);
      if (batch.length < 200) break;
      page++;
      toast('🔄', `Descargando... (${allActivities.length} actividades)`, 'ok');
    }

    let newCount = 0;
    for (const a of allActivities) {
      const exists = workouts.find(w => w.stravaId === a.id);
      if (exists) continue;
      // Fetch GPS/hr streams via Cloud Function proxy
      let track = [], elevProfile = [], hrStream = [];
      try {
        const streamRes = await fetch(`${FUNCTIONS_BASE_URL}/stravaStreams?activityId=${a.id}&token=${stravaToken.access_token}`);
        const streams = await streamRes.json();
        if (streams.latlng?.data)    track       = streams.latlng.data.map(([lat,lng]) => ({lat,lng}));
        if (streams.altitude?.data)  elevProfile = decimateArray(streams.altitude.data, 200);
        if (streams.heartrate?.data) hrStream    = decimateArray(streams.heartrate.data, 200);
      } catch(e) {}

      const wk = {
        id:            'strava_' + a.id,
        stravaId:      a.id,
        name:          a.name,
        date:          a.start_date_local?.split('T')[0],
        type:          mapStravaType(a.sport_type || a.type),
        source:        'strava',
        distance:      a.distance,
        movingTime:    a.moving_time,
        totalElevGain: a.total_elevation_gain,
        avgHeartrate:  a.average_heartrate,
        maxHeartrate:  a.max_heartrate,
        avgCadence:    a.average_cadence,
        calories:      a.calories,
        stravaUrl:     `https://www.strava.com/activities/${a.id}`,
        track:         decimateTrack(track, 500),
        elevProfile, hrStream,
        userId:        currentUser.id,
        linkedRaceId:  null
      };
      if (FB_READY) { await saveWorkoutToFirestore(wk); }
      workouts.unshift(wk);
      newCount++;
    }
    workouts = [...new Map(workouts.map(w => [w.id, w])).values()];
    workouts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!FB_READY) saveLocalWorkouts();
    renderWorkouts();
    toast('✅', `${newCount} actividades nuevas de Strava`, 'ok');
  } catch(e) {
    console.error('[strava] sync error:', e);
    toast('⚠️', 'Error al sincronizar Strava');
  }
  spin.style.display = 'none';
}

function mapStravaType(t) {
  const m = { Run:'run', TrailRun:'trail', VirtualRun:'run', Ride:'cycling', VirtualRide:'cycling', Swim:'swimming', Walk:'run', Hike:'trail' };
  return m[t] || 'run';
}

/* ══════════════════════════════════════════
   LINK WORKOUT TO RACE
══════════════════════════════════════════ */
function openLinkRace(wkId) {
  linkingWkId = wkId;
  const w = workouts.find(x => x.id === wkId);
  document.getElementById('linkWkName').textContent = w?.name || '—';
  const list = document.getElementById('linkRaceList');
  if (!races.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">No hay carreras en el calendario aún.</p>';
  } else {
    list.innerHTML = races.map(r => `
      <button onclick="linkWkToRace('${r.id}')" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;text-align:left;cursor:pointer;transition:border-color .15s;width:100%" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="font-size:20px">${WK_TYPE_ICONS['run']}</div>
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--text)">${r.name}</div>
          <div style="font-size:11px;color:var(--muted);font-family:'Space Mono',monospace">${fd(r.date)} · ${r.provincia||''}</div>
        </div>
        ${w?.linkedRaceId === r.id ? '<span style="margin-left:auto;color:var(--accent);font-size:12px">✓ Vinculada</span>' : ''}
      </button>`).join('');
  }
  oo('linkRaceOv');
}

async function linkWkToRace(raceId) {
  const wk = workouts.find(x => x.id === linkingWkId); if (!wk) return;
  wk.linkedRaceId = raceId;
  if (FB_READY) {
    try {
      const { doc: d2, updateDoc: ud } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await ud(d2(db, 'workouts', wk.id), { linkedRaceId: raceId });
    } catch(e) { saveLocalWorkouts(); }
  } else { saveLocalWorkouts(); }
  renderWorkouts();
  cm('linkRaceOv');
  const race = races.find(r => r.id === raceId);
  toast('🏆', `Vinculado a "${race?.name}"`, 'ok');
}

async function deleteWorkout(id) {
  if (!confirm('¿Eliminar este entrenamiento?')) return;
  if (FB_READY) { await deleteWorkoutFromFirestore(id); }
  else { workouts = workouts.filter(w => w.id !== id); saveLocalWorkouts(); renderWorkouts(); }
  toast('🗑', 'Entrenamiento eliminado');
}

/* ══════════════════════════════════════════
   FORMAT HELPERS
══════════════════════════════════════════ */
function formatDuration(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}
function formatPace(secsPerKm) {
  if (!secsPerKm || !isFinite(secsPerKm)) return '—';
  const m = Math.floor(secsPerKm / 60), s = Math.round(secsPerKm % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function fdLong(s) {
  if (!s) return '—';
  const [y,m,d] = s.split('-');
  const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${parseInt(d)} ${mNames[parseInt(m)-1]} ${y}`;
}

/* ══════════════════════════════════════════
   MIS INSCRIPCIONES
══════════════════════════════════════════ */
let inscripciones  = [];
let inscEditId       = null;
let inscPagoFile     = null;
let inscDeslindeFile = null;
let inscGpxFile      = null;
let inscRutaImgFile  = null;
let inscAltImgFile   = null;

function renderInscripcionesTab() {
  const lock    = document.getElementById('inscLock');
  const content = document.getElementById('inscContent');
  if (!currentUser) {
    lock.style.display = 'block'; content.style.display = 'none'; return;
  }
  lock.style.display = 'none'; content.style.display = 'block';
  if (FB_READY) {
    loadInscripcionesFromFirestore();
  } else {
    renderInscripciones();
  }
}

function renderInscripciones() {
  const grid = document.getElementById('inscGrid');
  // summary
  document.getElementById('inscSumTotal').textContent    = inscripciones.length;
  document.getElementById('inscSumPago').textContent     = inscripciones.filter(i => i.pagoURL).length;
  document.getElementById('inscSumDeslinde').textContent = inscripciones.filter(i => i.deslindeURL).length;
  // badge
  const badge = document.getElementById('inscBadge');
  badge.textContent = inscripciones.length;
  badge.style.display = inscripciones.length ? 'inline' : 'none';
  const badgeMob = document.getElementById('inscBadgeMob');
  if (badgeMob) { badgeMob.textContent = inscripciones.length; badgeMob.style.display = inscripciones.length ? 'inline' : 'none'; }

  if (!inscripciones.length) {
    grid.innerHTML = `<div class="insc-empty" style="grid-column:1/-1">
      <div class="ei">🎫</div>
      <h3>SIN INSCRIPCIONES AÚN</h3>
      <p style="font-size:14px;max-width:320px;margin:0 auto;line-height:1.6">Agregá tu primera inscripción con el botón de arriba.</p>
    </div>`; return;
  }
  grid.innerHTML = inscripciones.map(ins => buildInscCard(ins)).join('');
}

function buildInscCard(ins) {
  const race = races.find(r => r.id === ins.raceId);
  const [y, mo, d] = (ins.raceDate || '----').split('-');
  const typeEmoji = TI[ins.raceType] || '🏃';
  return `<div class="insc-card">
    <div class="insc-card-head">
      <div class="insc-card-name">${ins.raceName || 'Carrera'}</div>
      <span class="bdg bdg-${ins.raceType||'road'}">${typeEmoji}</span>
    </div>
    <div class="insc-card-meta">
      <div class="insc-meta-row">📅 <strong>${d && d!='--' ? d+'/'+mo+'/'+y : '—'}</strong>${ins.raceProvince ? ' · '+ins.raceProvince : ''}</div>
      ${ins.dorsal    ? `<div class="insc-meta-row">🎫 Dorsal: <strong>${ins.dorsal}</strong></div>` : ''}
      ${ins.distancia ? `<div class="insc-meta-row">📏 Distancia: <strong>${ins.distancia}</strong></div>` : ''}
      ${ins.categoria ? `<div class="insc-meta-row">🏷 Categoría: <strong>${ins.categoria}</strong></div>` : ''}
    </div>
    <div class="insc-card-pills">
      ${ins.pagoURL     ? '<span class="insc-pill insc-pill-acc">✓ Comprobante</span>' : '<span class="insc-pill">Sin comprobante</span>'}
      ${ins.deslindeURL ? '<span class="insc-pill insc-pill-acc">✓ Deslinde</span>'    : '<span class="insc-pill">Sin deslinde</span>'}
      ${ins.gpxURL      ? '<span class="insc-pill insc-pill-acc">✓ GPX</span>'         : ''}
      ${ins.stravaUrl   ? '<span class="insc-pill insc-pill-acc">✓ Strava</span>'      : ''}
      ${ins.rutaImgURL  ? '<span class="insc-pill insc-pill-acc">✓ Mapa</span>'        : ''}
      ${ins.altImgURL   ? '<span class="insc-pill insc-pill-acc">✓ Altitud</span>'     : ''}
    </div>
    <div class="insc-card-foot">
      <button class="insc-btn-pri" onclick="openInscDetail('${ins.id}')">Ver detalles</button>
      <button class="insc-btn-sec" onclick="editInsc('${ins.id}')">✏️</button>
      <button class="insc-btn-del" onclick="deleteInsc('${ins.id}')">🗑</button>
    </div>
  </div>`;
}

function openAddInsc() {
  if (!currentUser) { openLogin(); return; }
  inscEditId = null; inscPagoFile = null; inscDeslindeFile = null;
  inscGpxFile = null; inscRutaImgFile = null; inscAltImgFile = null;
  document.getElementById('inscModalTitle').textContent = 'NUEVA INSCRIPCIÓN';
  document.getElementById('inscSaveBtn').textContent    = 'GUARDAR INSCRIPCIÓN';
  ['inscDorsal','inscCat','inscNotas','inscStravaUrl'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('inscKitDate').value = '';
  document.getElementById('inscPagoPrev').innerHTML     = '<div class="ui">📄</div><p>Click para subir PDF o imagen</p>';
  document.getElementById('inscDeslindePrev').innerHTML = '<div class="ui">📋</div><p>Click para subir PDF o imagen</p>';
  document.getElementById('inscGpxPrev').innerHTML      = '<div class="ui">📍</div><p>Click para subir .gpx</p>';
  document.getElementById('inscRutaImgPrev').innerHTML  = '<div class="ui">🗺</div><p>Click para subir imagen de ruta</p>';
  document.getElementById('inscAltImgPrev').innerHTML   = '<div class="ui">📈</div><p>Click para subir imagen de altitud</p>';
  // Cargar carreras
  const sel = document.getElementById('inscRaceSel');
  sel.innerHTML = '<option value="">Seleccioná una carrera...</option>' +
    races.sort((a,b)=>a.date>b.date?1:-1).map(r => `<option value="${r.id}">${r.name} — ${fd(r.date)}</option>`).join('');
  document.getElementById('inscDist').innerHTML = '<option value="">—</option>';
  oo('addInscOv');
}

function inscRaceChanged() {
  const raceId = document.getElementById('inscRaceSel').value;
  const race   = races.find(r => r.id === raceId);
  const sel    = document.getElementById('inscDist');
  sel.innerHTML = '<option value="">—</option>' +
    (race?.distances || []).map(d => `<option>${d}</option>`).join('');
}

function prevInscFile(e, tipo) {
  const f = e.target.files[0]; if (!f) return;
  const isImg = f.type.startsWith('image/');
  const isPdf = f.type.includes('pdf');
  const preview = `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">${isPdf ? '📄' : isImg ? '🖼' : '📎'}</span><span style="font-size:12px;color:var(--text)">${f.name}</span></div>`;
  if (tipo === 'pago') {
    inscPagoFile = f;
    document.getElementById('inscPagoPrev').innerHTML = preview;
  } else if (tipo === 'deslinde') {
    inscDeslindeFile = f;
    document.getElementById('inscDeslindePrev').innerHTML = preview;
  } else if (tipo === 'gpx') {
    inscGpxFile = f;
    document.getElementById('inscGpxPrev').innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">📍</span><span style="font-size:12px;color:var(--text)">${f.name}</span></div>`;
  } else if (tipo === 'rutaimg') {
    inscRutaImgFile = f;
    document.getElementById('inscRutaImgPrev').innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">🗺</span><span style="font-size:12px;color:var(--text)">${f.name}</span></div>`;
  } else if (tipo === 'altimg') {
    inscAltImgFile = f;
    document.getElementById('inscAltImgPrev').innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">📈</span><span style="font-size:12px;color:var(--text)">${f.name}</span></div>`;
  }
}

async function uploadInscFile(file, path) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const storRef = ref(storage, path);
        await uploadString(storRef, ev.target.result, 'data_url');
        const url = await getDownloadURL(storRef);
        resolve({ url, path });
      } catch(e) { reject(e); }
    };
    reader.readAsDataURL(file);
  });
}

async function saveInsc() {
  const raceId = document.getElementById('inscRaceSel').value;
  if (!raceId) { toast('⚠️', 'Seleccioná una carrera'); return; }
  const race = races.find(r => r.id === raceId);
  const btn  = document.getElementById('inscSaveBtn');
  btn.innerHTML = '<span class="spin"></span> Guardando...'; btn.disabled = true;

  try {
    const id = inscEditId || 'ins_' + Date.now();
    let pagoURL = null, pagoPath = null, deslindeURL = null, deslindePath = null;
    let gpxURL = null, gpxPath = null, rutaImgURL = null, rutaImgPath = null, altImgURL = null, altImgPath = null;

    if (FB_READY && inscPagoFile) {
      toast('📤', 'Subiendo comprobante...', 'ok');
      const res = await uploadInscFile(inscPagoFile, `inscripciones/${currentUser.id}/${id}_pago`);
      pagoURL = res.url; pagoPath = res.path;
    }
    if (FB_READY && inscDeslindeFile) {
      toast('📤', 'Subiendo deslinde...', 'ok');
      const res = await uploadInscFile(inscDeslindeFile, `inscripciones/${currentUser.id}/${id}_deslinde`);
      deslindeURL = res.url; deslindePath = res.path;
    }
    if (FB_READY && inscGpxFile) {
      toast('📤', 'Subiendo GPX...', 'ok');
      const res = await uploadInscFile(inscGpxFile, `inscripciones/${currentUser.id}/${id}_gpx`);
      gpxURL = res.url; gpxPath = res.path;
    }
    if (FB_READY && inscRutaImgFile) {
      toast('📤', 'Subiendo imagen de ruta...', 'ok');
      const res = await uploadInscFile(inscRutaImgFile, `inscripciones/${currentUser.id}/${id}_rutaimg`);
      rutaImgURL = res.url; rutaImgPath = res.path;
    }
    if (FB_READY && inscAltImgFile) {
      toast('📤', 'Subiendo imagen de altitud...', 'ok');
      const res = await uploadInscFile(inscAltImgFile, `inscripciones/${currentUser.id}/${id}_altimg`);
      altImgURL = res.url; altImgPath = res.path;
    }

    const ins = {
      id,
      userId:       currentUser.id,
      raceId,
      raceName:     race.name,
      raceDate:     race.date,
      raceProvince: race.provincia || '',
      raceType:     race.type || 'road',
      dorsal:       document.getElementById('inscDorsal').value.trim(),
      distancia:    document.getElementById('inscDist').value,
      categoria:    document.getElementById('inscCat').value.trim(),
      kitDate:      document.getElementById('inscKitDate').value,
      notas:        document.getElementById('inscNotas').value.trim(),
      stravaUrl:    document.getElementById('inscStravaUrl').value.trim(),
      pagoURL:      pagoURL || (inscEditId ? (inscripciones.find(i=>i.id===inscEditId)?.pagoURL||null) : null),
      pagoPath:     pagoPath || null,
      deslindeURL:  deslindeURL || (inscEditId ? (inscripciones.find(i=>i.id===inscEditId)?.deslindeURL||null) : null),
      deslindePath: deslindePath || null,
      gpxURL:       gpxURL      || (inscEditId ? (inscripciones.find(i=>i.id===inscEditId)?.gpxURL||null)      : null),
      gpxPath:      gpxPath     || null,
      rutaImgURL:   rutaImgURL  || (inscEditId ? (inscripciones.find(i=>i.id===inscEditId)?.rutaImgURL||null)  : null),
      rutaImgPath:  rutaImgPath || null,
      altImgURL:    altImgURL   || (inscEditId ? (inscripciones.find(i=>i.id===inscEditId)?.altImgURL||null)   : null),
      altImgPath:   altImgPath  || null,
      createdAt:    new Date().toISOString()
    };

    if (FB_READY) {
      const { doc: d2, setDoc: sd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await sd(d2(db, 'inscripciones', id), ins);
    } else {
      const idx = inscripciones.findIndex(i => i.id === id);
      if (idx >= 0) inscripciones[idx] = ins; else inscripciones.push(ins);
      renderInscripciones();
    }

    cm('addInscOv');
    toast('🎫', '¡Inscripción guardada!', 'ok');
  } catch(e) {
    console.error(e);
    toast('❌', 'Error al guardar la inscripción');
  }
  btn.innerHTML = inscEditId ? 'ACTUALIZAR' : 'GUARDAR INSCRIPCIÓN'; btn.disabled = false;
}

function openInscDetail(id) {
  const ins = inscripciones.find(i => i.id === id); if (!ins) return;
  document.getElementById('inscDetTitle').textContent = ins.raceName || '—';
  document.getElementById('inscDetSub').textContent   = `${fd(ins.raceDate)}${ins.raceProvince ? ' · '+ins.raceProvince : ''}`;
  const rows = [
    ins.dorsal    ? { icon:'🎫', lbl:'Dorsal / N° inscripción', val: ins.dorsal } : null,
    ins.distancia ? { icon:'📏', lbl:'Distancia inscripta',     val: ins.distancia } : null,
    ins.categoria ? { icon:'🏷', lbl:'Categoría',               val: ins.categoria } : null,
    ins.kitDate   ? { icon:'📅', lbl:'Retiro de kit',           val: fd(ins.kitDate) } : null,
    ins.notas     ? { icon:'📝', lbl:'Notas',                   val: ins.notas } : null,
  ].filter(Boolean);

  document.getElementById('inscDetBody').innerHTML = `
    ${rows.map(row => `
      <div class="insc-detail-row">
        <div class="insc-detail-icon">${row.icon}</div>
        <div class="insc-detail-info"><div class="lbl">${row.lbl}</div><div class="val">${row.val}</div></div>
      </div>`).join('')}
    <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      ${ins.pagoURL
        ? `<a class="insc-pdf-btn" href="${ins.pagoURL}" target="_blank">📄 Ver comprobante de pago</a>`
        : `<span class="insc-pdf-btn" style="opacity:.5;cursor:default">📄 Sin comprobante</span>`}
      ${ins.deslindeURL
        ? `<a class="insc-pdf-btn" href="${ins.deslindeURL}" target="_blank">📋 Ver deslinde firmado</a>`
        : `<span class="insc-pdf-btn" style="opacity:.5;cursor:default">📋 Sin deslinde</span>`}
      ${ins.gpxURL
        ? `<a class="insc-pdf-btn" href="${ins.gpxURL}" target="_blank" download>📍 Descargar GPX</a>` : ''}
      ${ins.stravaUrl
        ? `<a class="insc-pdf-btn" href="${ins.stravaUrl}" target="_blank">🔗 Ver en Strava</a>` : ''}
      ${ins.rutaImgURL
        ? `<a class="insc-pdf-btn" href="${ins.rutaImgURL}" target="_blank">🗺 Ver mapa de ruta</a>` : ''}
      ${ins.altImgURL
        ? `<a class="insc-pdf-btn" href="${ins.altImgURL}" target="_blank">📈 Ver perfil de altitud</a>` : ''}
    </div>
    ${ins.rutaImgURL || ins.altImgURL ? `
    <div style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap">
      ${ins.rutaImgURL  ? `<img src="${ins.rutaImgURL}"  onclick="bigImg('${ins.rutaImgURL}')"  style="max-width:100%;border-radius:8px;border:1px solid var(--border);cursor:zoom-in" alt="Mapa de ruta">` : ''}
      ${ins.altImgURL   ? `<img src="${ins.altImgURL}"   onclick="bigImg('${ins.altImgURL}')"   style="max-width:100%;border-radius:8px;border:1px solid var(--border);cursor:zoom-in" alt="Perfil de altitud">` : ''}
    </div>` : ''}`;
  oo('inscDetailOv');
}

async function deleteInsc(id) {
  if (!confirm('¿Eliminar esta inscripción?')) return;
  if (FB_READY) {
    try {
      const { doc: d2, deleteDoc: dd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await dd(d2(db, 'inscripciones', id));
    } catch(e) { inscripciones = inscripciones.filter(i => i.id !== id); renderInscripciones(); }
  } else {
    inscripciones = inscripciones.filter(i => i.id !== id); renderInscripciones();
  }
  toast('🗑', 'Inscripción eliminada');
}

async function loadInscripcionesFromFirestore() {
  try {
    const { collection: col, query: q2, where, onSnapshot: ons } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const q = q2(col(db, 'inscripciones'), where('userId','==', currentUser.id));
    ons(q, snap => {
      inscripciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      inscripciones.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      renderInscripciones();
    }, err => {
      console.error('Error inscripciones:', err);
      toast('❌', 'Error al cargar inscripciones: ' + err.message);
    });
  } catch(e) { console.error('Error cargando inscripciones:', e); }
}

/* ══════════════════════════════════════════
   EDITAR INSCRIPCIÓN
══════════════════════════════════════════ */
function editInsc(id) {
  const ins = inscripciones.find(i => i.id === id); if (!ins) return;
  inscEditId = id; inscPagoFile = null; inscDeslindeFile = null;
  inscGpxFile = null; inscRutaImgFile = null; inscAltImgFile = null;
  document.getElementById('inscModalTitle').textContent = 'EDITAR INSCRIPCIÓN';
  document.getElementById('inscSaveBtn').textContent    = 'ACTUALIZAR';

  // Load race selector with current race pre-selected
  const sel = document.getElementById('inscRaceSel');
  sel.innerHTML = '<option value="">Seleccioná una carrera...</option>' +
    races.sort((a,b) => a.date > b.date ? 1 : -1).map(r =>
      `<option value="${r.id}"${r.id === ins.raceId ? ' selected' : ''}>${r.name} — ${fd(r.date)}</option>`
    ).join('');

  // Distance options for pre-selected race
  const raceForDist = races.find(r => r.id === ins.raceId);
  const distSel = document.getElementById('inscDist');
  distSel.innerHTML = '<option value="">—</option>' +
    (raceForDist?.distances || []).map(d => `<option${d === ins.distancia ? ' selected' : ''}>${d}</option>`).join('');

  // Pre-fill fields
  document.getElementById('inscDorsal').value     = ins.dorsal    || '';
  document.getElementById('inscCat').value        = ins.categoria || '';
  document.getElementById('inscKitDate').value    = ins.kitDate   || '';
  document.getElementById('inscNotas').value      = ins.notas     || '';
  document.getElementById('inscStravaUrl').value  = ins.stravaUrl || '';

  // Show existing file status
  document.getElementById('inscPagoPrev').innerHTML = ins.pagoURL
    ? `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">📄</span><span style="font-size:12px;color:var(--accent)">Comprobante ya cargado ✓ <span style="color:var(--muted)">(subí otro para reemplazar)</span></span></div>`
    : '<div class="ui">📄</div><p>Click para subir PDF o imagen</p>';
  document.getElementById('inscDeslindePrev').innerHTML = ins.deslindeURL
    ? `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">📋</span><span style="font-size:12px;color:var(--accent)">Deslinde ya cargado ✓ <span style="color:var(--muted)">(subí otro para reemplazar)</span></span></div>`
    : '<div class="ui">📋</div><p>Click para subir PDF o imagen</p>';
  document.getElementById('inscGpxPrev').innerHTML = ins.gpxURL
    ? `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">📍</span><span style="font-size:12px;color:var(--accent)">GPX ya cargado ✓ <span style="color:var(--muted)">(subí otro para reemplazar)</span></span></div>`
    : '<div class="ui">📍</div><p>Click para subir .gpx</p>';
  document.getElementById('inscRutaImgPrev').innerHTML = ins.rutaImgURL
    ? `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">🗺</span><span style="font-size:12px;color:var(--accent)">Mapa ya cargado ✓ <span style="color:var(--muted)">(subí otro para reemplazar)</span></span></div>`
    : '<div class="ui">🗺</div><p>Click para subir imagen de ruta</p>';
  document.getElementById('inscAltImgPrev').innerHTML = ins.altImgURL
    ? `<div style="display:flex;align-items:center;gap:8px;padding:4px"><span style="font-size:20px">📈</span><span style="font-size:12px;color:var(--accent)">Altitud ya cargada ✓ <span style="color:var(--muted)">(subí otra para reemplazar)</span></span></div>`
    : '<div class="ui">📈</div><p>Click para subir imagen de altitud</p>';

  oo('addInscOv');
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BKFpfYVK7qQ3pcYxVxV9s02se6jV-HV5LxEJj97oTOZmtnXtme99_aZUtCCvCOQGHtLXuNYIljb9Sv1ciIiGeCA';

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function togglePushNotifications() {
  if (!currentUser) { toast('⚠️', 'Iniciá sesión para activar notificaciones'); return; }
  const enabled = localStorage.getItem('push_subscribed') === '1';
  if (enabled) {
    await unsubscribePush();
  } else {
    await subscribePush();
  }
}

async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('❌', 'Tu navegador no soporta notificaciones push'); return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('ℹ️', 'Permiso de notificaciones denegado'); return;
    }
    const reg  = await navigator.serviceWorker.ready;
    const sub  = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    if (FB_READY && currentUser) {
      await setDoc(doc(db, 'push_subscriptions', currentUser.id), {
        subscription: sub.toJSON(),
        email:        currentUser.email,
        updatedAt:    new Date().toISOString(),
      });
    }
    localStorage.setItem('push_subscribed', '1');
    updateNav();
    toast('🔔', 'Notificaciones activadas — te avisamos 7 días antes de cada carrera', 'ok');
  } catch(e) {
    console.error('subscribePush:', e);
    toast('❌', 'No se pudo activar las notificaciones', 'err');
  }
}

async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    if (FB_READY && currentUser) {
      await deleteDoc(doc(db, 'push_subscriptions', currentUser.id));
    }
    localStorage.removeItem('push_subscribed');
    updateNav();
    toast('🔕', 'Notificaciones desactivadas');
  } catch(e) {
    console.error('unsubscribePush:', e);
  }
}

/* ══════════════════════════════════════════
   MAPA DE CARRERAS
══════════════════════════════════════════ */
let raceMapInst    = null;
let raceMapMarkers = [];

function renderMapTab() {
  const mapEl = document.getElementById('raceMapView');
  if (!mapEl) return;

  // Inicializar mapa solo una vez
  if (!raceMapInst) {
    raceMapInst = L.map(mapEl, { attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(raceMapInst);
    raceMapInst.setView([-38.4, -63.6], 4);
  }

  // Forzar recálculo de tamaño al mostrar el tab
  setTimeout(() => raceMapInst.invalidateSize(), 80);

  // Eliminar marcadores anteriores
  raceMapMarkers.forEach(m => raceMapInst.removeLayer(m));
  raceMapMarkers = [];

  const typeColors = { trail:'#6eeaa0', road:'#4fa8e8', ultra:'#c9a0fc', mixed:'#f59e0b', duatlon:'#fb923c', triatlon:'#22d3ee' };
  const withCoords = races.filter(r => r.coords?.lat && r.coords?.lng);
  const noCoords   = races.length - withCoords.length;

  const countEl = document.getElementById('mapRaceCount');
  if (countEl) {
    countEl.textContent = withCoords.length
      ? `${withCoords.length} carrera${withCoords.length !== 1 ? 's' : ''} en el mapa${noCoords > 0 ? ' · ' + noCoords + ' sin coordenadas' : ''}`
      : 'Ninguna carrera tiene coordenadas aún';
  }

  withCoords.forEach(r => {
    const color  = typeColors[r.type] || '#e8ff47';
    const [y, mo, d] = (r.date || '----').split('-');
    const mNames = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    const pc     = currentUser ? ((r.participations || []).some(p => p.userId === currentUser.id) ? 1 : 0) : 0;

    const icon = L.divIcon({
      className: '',
      html: pc > 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer" onmouseover="this.querySelector('.map-dot').style.transform='scale(1.5)'" onmouseout="this.querySelector('.map-dot').style.transform=''">
            <div style="background:#e8ff47;color:#0c0c0a;border-radius:100px;padding:1px 5px;font-size:9px;font-weight:700;font-family:monospace;white-space:nowrap;box-shadow:0 1px 6px rgba(0,0,0,.7);line-height:1.5">⏱ ✓</div>
            <div class="map-dot" style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid rgba(0,0,0,.55);box-shadow:0 2px 10px rgba(0,0,0,.6);transition:transform .15s"></div>
          </div>`
        : `<div class="map-dot" style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid rgba(0,0,0,.55);box-shadow:0 2px 10px rgba(0,0,0,.6);cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='scale(1.6)'" onmouseout="this.style.transform=''"></div>`,
      iconSize:    pc > 0 ? [40, 30] : [16, 16],
      iconAnchor:  pc > 0 ? [20, 28] : [8, 8],
      popupAnchor: [0, pc > 0 ? -32 : -12]
    });

    const distHtml = (r.distances || [])
      .map(x => `<span style="display:inline-block;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);border-radius:100px;padding:2px 8px;font-size:10px;margin:1px 2px;font-family:monospace">${x}</span>`)
      .join('');

    const popupHtml = `
      <div style="font-family:system-ui,sans-serif;padding:2px 0;min-width:200px">
        <div style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;font-weight:700">${TL[r.type] || r.type}</div>
        <div style="font-weight:700;font-size:14px;line-height:1.3;margin-bottom:4px;color:#f2f1ea">${r.name}</div>
        <div style="font-size:11px;color:#a8d8b5;margin-bottom:8px">${parseInt(d)} ${mNames[parseInt(mo)-1]} ${y}${r.provincia ? ' · ' + r.provincia : ''}</div>
        ${distHtml ? `<div style="margin-bottom:8px">${distHtml}</div>` : ''}
        ${pc > 0 ? `<div style="font-size:11px;color:#6eeaa0;margin-bottom:8px">⏱ Mi tiempo registrado</div>` : ''}
        <button onclick="openDetailFromMap('${r.id}')" style="width:100%;background:#e8ff47;color:#0c0c0a;border:none;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;margin-top:2px">Ver detalles →</button>
      </div>`;

    const marker = L.marker([parseFloat(r.coords.lat), parseFloat(r.coords.lng)], { icon })
      .bindPopup(L.popup({ maxWidth: 260 }).setContent(popupHtml))
      .addTo(raceMapInst);
    raceMapMarkers.push(marker);
  });

  // Ajustar vista a todos los marcadores
  if (withCoords.length >= 2) {
    const bounds = withCoords.map(r => [parseFloat(r.coords.lat), parseFloat(r.coords.lng)]);
    try { raceMapInst.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 }); } catch(e) {}
  } else if (withCoords.length === 1) {
    raceMapInst.setView([parseFloat(withCoords[0].coords.lat), parseFloat(withCoords[0].coords.lng)], 10);
  }
}

function openDetailFromMap(id) {
  if (raceMapInst) raceMapInst.closePopup();
  openDetail(id);
}

/* ══════════════════════════════════════════
   COMPARTIR RESULTADO (Canvas share card)
══════════════════════════════════════════ */
let _shareRace = null;
let _sharePart = null;
let _sharePhoto = null; // URL de la foto seleccionada como fondo

function openShareCard(raceId) {
  _shareRace = races.find(r => r.id === raceId);
  if (!_shareRace || !currentUser) return;
  _sharePart  = (_shareRace.participations || []).find(p => p.userId === currentUser.id) || {};
  _sharePhoto = null;
  document.getElementById('shareOvSub').textContent = _shareRace.name;
  document.getElementById('nativeShareBtn').style.display = navigator.share ? 'flex' : 'none';

  // Poblar selector de fotos
  const photos   = _sharePart.photos || [];
  const selWrap  = document.getElementById('sharePhotoSel');
  const thumbCont= document.getElementById('sharePhotoThumbs');
  if (photos.length) {
    selWrap.style.display = 'block';
    // Opción "sin foto" siempre primero
    const noneId = 'spThumbNone';
    thumbCont.innerHTML = `<div class="share-photo-none selected" id="${noneId}" onclick="selectSharePhoto(null)" title="Sin foto">🚫</div>` +
      photos.map((url, i) =>
        `<img class="share-photo-thumb" src="${url}" onclick="selectSharePhoto('${url}')" title="Foto ${i+1}">`
      ).join('');
  } else {
    selWrap.style.display = 'none';
    thumbCont.innerHTML   = '';
  }

  oo('shareOv');
  setTimeout(generateShareCard, 100);
}

function selectSharePhoto(url) {
  _sharePhoto = url;
  // Resaltar miniatura seleccionada
  document.querySelectorAll('.share-photo-thumb').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.share-photo-none').forEach(el => el.classList.remove('selected'));
  if (url) {
    document.querySelectorAll('.share-photo-thumb').forEach(el => {
      if (el.src === url || el.getAttribute('src') === url) el.classList.add('selected');
    });
  } else {
    const none = document.getElementById('spThumbNone');
    if (none) none.classList.add('selected');
  }
  generateShareCard();
}

function generateShareCard() {
  const canvas = document.getElementById('shareCanvas');
  if (!canvas) return;

  if (!_sharePhoto) {
    _drawShareCard(canvas, null);
    return;
  }

  // Intento 1: con crossOrigin (canvas limpio → download funciona)
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => _drawShareCard(canvas, img);
  img.onerror = () => {
    // Intento 2: sin crossOrigin (canvas puede quedar tainted, pero la imagen se VE)
    const img2 = new Image();
    img2.onload  = () => _drawShareCard(canvas, img2);
    img2.onerror = () => _drawShareCard(canvas, null);
    img2.src = _sharePhoto;
  };
  img.src = _sharePhoto;
}

function _drawShareCard(canvas, bgImg) {
  const S = 1080;
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');

  if (bgImg) {
    // Foto de fondo — cubrir canvas manteniendo aspect ratio (object-fit: cover)
    const iw = bgImg.naturalWidth  || bgImg.width;
    const ih = bgImg.naturalHeight || bgImg.height;
    const scale = Math.max(S / iw, S / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (S - dw) / 2,  dy = (S - dh) / 2;
    ctx.drawImage(bgImg, dx, dy, dw, dh);

    // Overlay degradado fuerte para legibilidad
    const ov = ctx.createLinearGradient(0, 0, 0, S);
    ov.addColorStop(0,    'rgba(0,20,8,.72)');
    ov.addColorStop(0.35, 'rgba(0,20,8,.55)');
    ov.addColorStop(0.65, 'rgba(0,20,8,.75)');
    ov.addColorStop(1,    'rgba(0,20,8,.92)');
    ctx.fillStyle = ov;
    ctx.fillRect(0, 0, S, S);
  } else {
    // Fondo degradado sólido
    const bg = ctx.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0,    '#0d8f39');
    bg.addColorStop(0.45, '#074f1f');
    bg.addColorStop(1,    '#031208');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    // Ornamento diagonal sutil
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = '#e8ff47';
    ctx.lineWidth = 200;
    ctx.beginPath();
    ctx.moveTo(-100, S + 100);
    ctx.lineTo(S + 100, -100);
    ctx.stroke();
    ctx.restore();
  }

  // Línea de acento superior
  ctx.fillStyle = '#e8ff47';
  ctx.fillRect(0, 0, S, 10);

  const r  = _shareRace;
  const p  = _sharePart || {};
  const [y, mo, d] = (r.date || '----').split('-');
  const mNames = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const typeColors = { trail:'#6eeaa0', road:'#4fa8e8', ultra:'#c9a0fc', mixed:'#f59e0b', duatlon:'#fb923c', triatlon:'#22d3ee' };
  const typeColor  = typeColors[r.type] || '#e8ff47';

  // ── Logo ──────────────────────────────────────────────
  ctx.font = "700 58px 'Bebas Neue', 'Arial Black', Impact, sans-serif";
  ctx.fillStyle = '#e8ff47';
  ctx.textAlign = 'left';
  ctx.fillText('RUN & TRAIL', 80, 118);
  const logoW = ctx.measureText('RUN & TRAIL ').width;
  ctx.fillStyle = '#f2f1ea';
  ctx.fillText('VM', 80 + logoW, 118);

  // Badge ARG
  ctx.fillStyle = '#e8ff47';
  ctx.fillRect(80, 133, 108, 30);
  ctx.fillStyle = '#0c0c0a';
  ctx.font = "700 13px 'Space Mono', monospace";
  ctx.textAlign = 'left';
  ctx.fillText('ARGENTINA', 92, 153);

  // Badge tipo carrera
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = typeColor;
  ctx.fillRect(S - 220, 72, 148, 34);
  ctx.globalAlpha = 1;
  ctx.fillStyle = typeColor;
  ctx.font = "700 13px 'Space Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText((TL[r.type] || r.type || 'CARRERA').toUpperCase(), S - 220 + 74, 94);

  // Separador
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(80, 198); ctx.lineTo(S - 80, 198); ctx.stroke();

  // ── Nombre de la carrera ──────────────────────────────
  const nameLen = r.name.length;
  const nameSz  = nameLen > 25 ? 68 : nameLen > 18 ? 80 : 96;
  ctx.fillStyle = '#f2f1ea';
  ctx.textAlign = 'center';
  ctx.font = `700 ${nameSz}px 'Bebas Neue', 'Arial Black', Impact, sans-serif`;
  _wrapTextCanvas(ctx, r.name.toUpperCase(), S / 2, 288, S - 160, nameSz * 1.12);

  // Calcular posición vertical de stats según qué datos hay
  const hasDist = p.distance && p.distance !== '—' && p.distance !== '';
  const hasTime = !!(p.time);
  const hasPos  = !!(p.position && parseInt(p.position) > 0);

  // ── Distancia (dato principal) ───────────────────────
  let nextY = 440;
  if (hasDist) {
    ctx.fillStyle = '#e8ff47';
    ctx.font = "700 160px 'Bebas Neue', 'Arial Black', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText(p.distance, S / 2, nextY + 130);
    ctx.fillStyle = 'rgba(232,255,71,0.5)';
    ctx.font = "700 24px 'Space Mono', monospace";
    ctx.fillText('DISTANCIA', S / 2, nextY + 170);
    nextY += 220;
  }

  // ── Tiempo ───────────────────────────────────────────
  if (hasTime) {
    ctx.fillStyle = '#f2f1ea';
    ctx.font = "700 100px 'Bebas Neue', 'Arial Black', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText(p.time, S / 2, nextY + 80);
    ctx.fillStyle = '#a8d8b5';
    ctx.font = "700 22px 'Space Mono', monospace";
    ctx.fillText('TIEMPO FINAL', S / 2, nextY + 114);
    nextY += 148;
  }

  // ── Posición ─────────────────────────────────────────
  if (hasPos) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(S / 2 - 130, nextY + 10, 260, 64);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f2f1ea';
    ctx.font = "700 52px 'Bebas Neue', 'Arial Black', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText(`POS. #${p.position}`, S / 2, nextY + 58);
    nextY += 90;
  }

  // ── Si no hay ningún stat, mostrar emoji motivacional ─
  if (!hasDist && !hasTime && !hasPos) {
    ctx.font = "130px serif";
    ctx.textAlign = 'center';
    ctx.fillText('🏃', S / 2, 680);
  }

  // ── Fecha y provincia ─────────────────────────────────
  const dateStr = `${parseInt(d)} ${mNames[parseInt(mo) - 1]} ${y}${r.provincia ? '  ·  ' + r.provincia.toUpperCase() : ''}`;
  ctx.fillStyle = 'rgba(168,216,181,0.75)';
  ctx.font = "400 26px 'Space Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText(dateStr, S / 2, 930);

  // Línea inferior decorativa
  ctx.strokeStyle = 'rgba(232,255,71,0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(80, 960); ctx.lineTo(S - 80, 960); ctx.stroke();

  // URL de la app
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font = "400 20px 'Space Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText('runandtrailvm.web.app', S / 2, 1005);

  // Escalar visualmente a 360px (canvas interno 1080 para calidad)
  canvas.style.width  = '360px';
  canvas.style.height = '360px';
}

function _wrapTextCanvas(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  words.forEach((word, i) => {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else {
      line = test;
    }
    if (i === words.length - 1) ctx.fillText(line, x, y);
  });
}

function downloadShareCard() {
  const canvas = document.getElementById('shareCanvas');
  if (!canvas) return;
  let dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch(e) {
    // Canvas tainted por CORS — ofrecer guardar por long-press / clic derecho
    toast('ℹ️', 'Mantené presionado la imagen (o clic derecho → Guardar) para guardarla');
    return;
  }
  const a = document.createElement('a');
  a.download = `resultado_${(_shareRace?.name || 'carrera').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')}.png`;
  a.href = dataUrl;
  a.click();
  toast('⬇', 'Imagen descargada', 'ok');
}

function shareToWhatsApp() {
  const r = _shareRace, p = _sharePart || {};
  if (!r) return;
  const [y, mo, d] = (r.date || '----').split('-');
  const lines = [`🏃 *${r.name}*`];
  if (p.distance && p.distance !== '—') lines.push(`📏 ${p.distance}`);
  if (p.time) lines.push(`⏱ ${p.time}`);
  if (p.position) lines.push(`🏅 Posición #${p.position}`);
  lines.push(`📅 ${parseInt(d)}/${mo}/${y}${r.provincia ? ' · ' + r.provincia : ''}`);
  lines.push(`\n_Registrado en RUN & TRAIL VM_`);
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
}

async function nativeShare() {
  const canvas = document.getElementById('shareCanvas');
  if (!canvas || !navigator.share) return;
  try {
    let blob;
    try {
      blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    } catch(e) {
      blob = null;
    }
    const shareData = {
      title: _shareRace?.name || 'Mi resultado',
      text:  `¡Terminé ${_shareRace?.name || 'la carrera'}!${_sharePart?.time ? ' Tiempo: ' + _sharePart.time : ''}`,
    };
    if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'resultado.png', { type: 'image/png' })] })) {
      await navigator.share({ ...shareData, files: [new File([blob], 'resultado.png', { type: 'image/png' })] });
    } else {
      await navigator.share(shareData);
    }
  } catch(e) {
    if (e.name !== 'AbortError') toast('⚠️', 'No se pudo compartir');
  }
}

/* ══════════════════════════════════════════
   TRIATLÓN
══════════════════════════════════════════ */
let triathlons       = [];
let triFilterType    = '';
let editTriId        = null;
let _triListenerActive = false;

function renderTriathlonTab() {
  const lock    = document.getElementById('triLock');
  const content = document.getElementById('triContent');
  if (!currentUser) {
    lock.style.display = 'block'; content.style.display = 'none'; return;
  }
  lock.style.display = 'none'; content.style.display = 'block';
  if (FB_READY && !_triListenerActive) {
    _triListenerActive = true;
    const q = query(collection(db, 'users', currentUser.uid, 'triathlons'), orderBy('date', 'desc'));
    onSnapshot(q, snap => {
      triathlons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTriGrid();
    });
  } else {
    renderTriGrid();
  }
}

function renderTriGrid() {
  const grid = document.getElementById('triGrid');
  const list = triFilterType ? triathlons.filter(t => t.type === triFilterType) : triathlons;

  // summary (siempre total)
  document.getElementById('triSumTotal').textContent = triathlons.length;
  const swimTot = triathlons.reduce((a, t) => a + (parseFloat(t.swimDist) || 0), 0);
  const bikeTot = triathlons.reduce((a, t) => a + (parseFloat(t.bikeDist) || 0), 0);
  const runTot  = triathlons.reduce((a, t) => a + (parseFloat(t.runDist) || 0), 0);
  document.getElementById('triSumSwim').textContent = Math.round(swimTot);
  document.getElementById('triSumBike').textContent = Math.round(bikeTot * 10) / 10;
  document.getElementById('triSumRun').textContent  = Math.round(runTot  * 10) / 10;

  // badge
  const b = document.getElementById('triBadge');
  b.textContent = triathlons.length; b.style.display = triathlons.length ? 'inline' : 'none';
  const bm = document.getElementById('triBadgeMob');
  if (bm) { bm.textContent = triathlons.length; bm.style.display = triathlons.length ? 'inline' : 'none'; }

  if (!list.length) {
    grid.innerHTML = `<div class="tri-empty" style="grid-column:1/-1">
      <div class="ei">🏊‍♂️</div>
      <h3>SIN EVENTOS AÚN</h3>
      <p style="font-size:14px;line-height:1.7;max-width:320px;margin:0 auto">Registrá tu primer triatlón con tiempos de nado, bici y carrera.</p>
    </div>`; return;
  }
  grid.innerHTML = list.map(t => buildTriCard(t)).join('');
}

function buildTriCard(t) {
  const [y, mo, d] = (t.date || '----').split('-');
  const typeLabel = { sprint:'Sprint', olimpico:'Olímpico', media:'70.3', ironman:'Ironman', acuatlon:'Acuatlón', duatlon:'Duatlón', otro:'Otro' }[t.type] || t.type;
  const segs = [];
  if (t.swimDist) segs.push(`<span class="tri-seg swim">🏊 ${t.swimDist}m${t.swimTime ? ' · '+t.swimTime : ''}</span>`);
  if (t.bikeDist) segs.push(`<span class="tri-seg bike">🚴 ${t.bikeDist}km${t.bikeTime ? ' · '+t.bikeTime : ''}</span>`);
  if (t.runDist)  segs.push(`<span class="tri-seg run">🏃 ${t.runDist}km${t.runTime ? ' · '+t.runTime : ''}</span>`);
  const loc = [t.city, t.province].filter(Boolean).join(', ');
  return `<div class="tri-card">
    <div class="tri-card-head">
      <div class="tri-card-name">${t.name || 'Evento'}</div>
      <span class="tri-card-badge">${typeLabel}</span>
    </div>
    <div class="tri-card-meta">
      ${t.date ? `<div class="tri-meta-row">📅 <strong>${d?.padStart(2,'0')} ${MS[parseInt(mo,10)-1]||''} ${y}</strong></div>` : ''}
      ${loc ? `<div class="tri-meta-row">📍 ${loc}</div>` : ''}
      ${t.totalTime ? `<div class="tri-meta-row">⏱ Tiempo total: <strong>${t.totalTime}</strong></div>` : ''}
      ${t.pos ? `<div class="tri-meta-row">🏆 Posición: <strong>#${t.pos}</strong>${t.cat ? ' · '+t.cat : ''}</div>` : ''}
    </div>
    ${segs.length ? `<div class="tri-segments">${segs.join('')}</div>` : ''}
    ${t.notes ? `<div style="padding:0 16px 10px;font-size:12px;color:var(--muted);font-style:italic;line-height:1.5">${t.notes}</div>` : ''}
    <div class="tri-card-foot">
      <button class="tri-btn-pri" onclick="openEditTri('${t.id}')">✏️ Editar</button>
      <button class="tri-btn-del" onclick="deleteTriConfirm('${t.id}')">🗑</button>
    </div>
  </div>`;
}

function filterTri(btn, type) {
  document.querySelectorAll('.tri-type-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  triFilterType = type;
  renderTriGrid();
}

function openAddTri() {
  if (!currentUser) { openLogin(); return; }
  editTriId = null;
  document.getElementById('triModalTitle').textContent = 'NUEVO EVENTO TRIATLÓN';
  ['triName','triSwimDist','triSwimTime','triBikeDist','triBikeTime','triRunDist','triRunTime','triTotalTime','triPos','triCat','triNotes','triCity'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('triDate').value = '';
  document.getElementById('triType').value = 'sprint';
  document.getElementById('triProv').value = '';
  oo('addTriOv');
}

function openEditTri(id) {
  const t = triathlons.find(x => x.id === id);
  if (!t) return;
  editTriId = id;
  document.getElementById('triModalTitle').textContent = 'EDITAR EVENTO';
  document.getElementById('triName').value      = t.name || '';
  document.getElementById('triType').value      = t.type || 'sprint';
  document.getElementById('triDate').value      = t.date || '';
  document.getElementById('triProv').value      = t.province || '';
  document.getElementById('triCity').value      = t.city || '';
  document.getElementById('triSwimDist').value  = t.swimDist || '';
  document.getElementById('triSwimTime').value  = t.swimTime || '';
  document.getElementById('triBikeDist').value  = t.bikeDist || '';
  document.getElementById('triBikeTime').value  = t.bikeTime || '';
  document.getElementById('triRunDist').value   = t.runDist || '';
  document.getElementById('triRunTime').value   = t.runTime || '';
  document.getElementById('triTotalTime').value = t.totalTime || '';
  document.getElementById('triPos').value       = t.pos || '';
  document.getElementById('triCat').value       = t.cat || '';
  document.getElementById('triNotes').value     = t.notes || '';
  oo('addTriOv');
}

async function saveTri() {
  const name = document.getElementById('triName').value.trim();
  const date = document.getElementById('triDate').value;
  if (!name) { toast('⚠️', 'Completá el nombre del evento'); return; }
  if (!date) { toast('⚠️', 'Elegí una fecha'); return; }

  const btn = document.getElementById('triSaveBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const data = {
    name,
    type:      document.getElementById('triType').value,
    date,
    province:  document.getElementById('triProv').value,
    city:      document.getElementById('triCity').value.trim(),
    swimDist:  document.getElementById('triSwimDist').value || '',
    swimTime:  document.getElementById('triSwimTime').value.trim(),
    bikeDist:  document.getElementById('triBikeDist').value || '',
    bikeTime:  document.getElementById('triBikeTime').value.trim(),
    runDist:   document.getElementById('triRunDist').value || '',
    runTime:   document.getElementById('triRunTime').value.trim(),
    totalTime: document.getElementById('triTotalTime').value.trim(),
    pos:       document.getElementById('triPos').value || '',
    cat:       document.getElementById('triCat').value.trim(),
    notes:     document.getElementById('triNotes').value.trim(),
    updatedAt: serverTimestamp(),
  };
  if (!editTriId) data.createdAt = serverTimestamp();

  try {
    const ref = editTriId
      ? doc(db, 'users', currentUser.uid, 'triathlons', editTriId)
      : doc(collection(db, 'users', currentUser.uid, 'triathlons'));
    await setDoc(ref, data, { merge: true });
    cm('addTriOv');
    toast('🏊', editTriId ? 'Evento actualizado' : 'Evento guardado');
  } catch(e) {
    toast('❌', 'Error al guardar: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'GUARDAR EVENTO';
  }
}

async function deleteTriConfirm(id) {
  if (!confirm('¿Eliminás este evento de triatlón?')) return;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'triathlons', id));
    toast('🗑', 'Evento eliminado');
  } catch(e) {
    toast('❌', 'Error: ' + e.message);
  }
}

    toast('❌', 'Error: ' + e.message);
  }
}

/* ══════════════════════════════════════════
   PERFIL PÚBLICO
══════════════════════════════════════════ */
let _userProfile = null;

async function openProfileConfig() {
  if (!currentUser) { openLogin(); return; }
  // Cargar perfil guardado
  if (FB_READY) {
    try {
      const { doc: d2, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const snap = await getDoc(d2(db, 'profiles', currentUser.id));
      if (snap.exists()) _userProfile = snap.data();
    } catch(e) { console.error(e); }
  }
  const p = _userProfile || {};
  document.getElementById('ppDisplayName').value = p.displayName || currentUser.name || '';
  document.getElementById('ppSlug').value        = p.slug        || '';
  document.getElementById('ppBio').value         = p.bio         || '';
  document.getElementById('ppPublic').checked    = !!p.isPublic;
  document.getElementById('ppShowInsc').checked  = p.showInsc  !== false;
  document.getElementById('ppShowTimes').checked = p.showTimes !== false;
  updateProfileLinkPreview();
  oo('profileOv');
}

function updateProfileLinkPreview() {
  const slug = document.getElementById('ppSlug')?.value.trim();
  const wrap = document.getElementById('ppLinkWrap');
  const txt  = document.getElementById('ppLinkText');
  const base = window.location.origin + window.location.pathname;
  if (slug && document.getElementById('ppPublic')?.checked) {
    wrap.style.display = 'block';
    txt.textContent = `${base}?corredor=${slug}`;
  } else {
    wrap.style.display = 'none';
  }
}

async function saveProfile() {
  if (!currentUser) return;
  const slug = document.getElementById('ppSlug').value.trim();
  if (!slug) { toast('⚠️', 'El nombre de usuario es obligatorio'); return; }
  if (!/^[a-z0-9_-]+$/.test(slug)) { toast('⚠️', 'Solo letras minúsculas, números, guiones y guiones bajos'); return; }

  const profile = {
    userId:      currentUser.id,
    displayName: document.getElementById('ppDisplayName').value.trim() || currentUser.name,
    slug,
    bio:         document.getElementById('ppBio').value.trim(),
    isPublic:    document.getElementById('ppPublic').checked,
    showInsc:    document.getElementById('ppShowInsc').checked,
    showTimes:   document.getElementById('ppShowTimes').checked,
    picture:     currentUser.picture || null,
    updatedAt:   new Date().toISOString()
  };

  if (FB_READY) {
    try {
      const { doc: d2, setDoc: sd, collection: col, query: q2, where, getDocs } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      // Verificar que el slug no esté tomado por otro usuario
      const existing = await getDocs(q2(col(db, 'profiles'), where('slug','==', slug)));
      const taken = existing.docs.find(d => d.id !== currentUser.id);
      if (taken) { toast('⚠️', `El usuario "${slug}" ya está en uso`); return; }
      await sd(d2(db, 'profiles', currentUser.id), profile);
    } catch(e) { toast('❌', 'Error al guardar: ' + e.message); return; }
  }
  _userProfile = profile;
  updateProfileLinkPreview();
  toast('👤', '¡Perfil guardado!', 'ok');
  if (profile.isPublic) {
    cm('profileOv');
    const link = `${window.location.origin}${window.location.pathname}?corredor=${slug}`;
    toast('🔗', 'Perfil público activo: ' + link, 'ok');
  } else {
    cm('profileOv');
  }
}

function copyProfileLink() {
  const txt = document.getElementById('ppLinkText')?.textContent;
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(() => toast('📋', '¡Link copiado!', 'ok'));
}

async function checkPublicProfileRoute() {
  const params = new URLSearchParams(window.location.search);
  const slug   = params.get('corredor');
  if (!slug) return;

  // Ocultar app principal, mostrar perfil
  const appEls = ['hero', 'featured-wrap', 'filter-wrap', 'res-bar', 'cards-wrap'];
  document.querySelector('.topbar')?.style.setProperty('display','none');
  document.querySelectorAll('.main-tabs, .tab-dropdown, .tab-panel, .hero, .featured-wrap, .filter-wrap, section, .adm-fab').forEach(el => el.style.display = 'none');

  const pp = document.getElementById('publicProfilePage');
  pp.style.display = 'block';

  const body = document.getElementById('publicProfileBody');
  body.innerHTML = `<div class="pp-body"><div style="text-align:center;padding:60px 0;color:var(--muted)"><div style="font-size:40px;margin-bottom:12px">⏳</div><div>Cargando perfil...</div></div></div>`;

  if (!FB_READY) {
    body.innerHTML = `<div class="pp-not-found"><div class="ei">⚙️</div><h2>FIREBASE NO CONFIGURADO</h2><p>Los perfiles públicos requieren Firebase.</p></div>`;
    return;
  }

  try {
    const { collection: col, query: q2, where, getDocs, doc: d2, getDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    // Buscar perfil por slug
    const snap = await getDocs(q2(col(db, 'profiles'), where('slug','==', slug)));
    if (snap.empty || !snap.docs[0].data().isPublic) {
      body.innerHTML = `<div class="pp-not-found"><div class="ei">👤</div><h2>PERFIL NO ENCONTRADO</h2><p style="color:var(--muted)">El corredor "${slug}" no tiene perfil público activo.</p><a href="./" class="btn btn-accent" style="display:inline-flex;margin-top:20px">Volver al calendario</a></div>`;
      return;
    }

    const profile = snap.docs[0].data();
    const uid     = snap.docs[0].id;

    // Cargar races para mostrar participaciones
    const racesSnap = await getDocs(col(db, 'races'));
    const allRaces  = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtrar carreras donde participó
    const participatedRaces = allRaces
      .filter(r => (r.participations || []).some(p => p.userId === uid))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Cargar inscripciones si showInsc
    let inscList = [];
    if (profile.showInsc) {
      const inscSnap = await getDocs(q2(col(db, 'inscripciones'), where('userId','==', uid)));
      inscList = inscSnap.docs.map(d => d.data())
        .filter(i => i.raceDate >= new Date().toISOString().slice(0,10))
        .sort((a,b) => a.raceDate.localeCompare(b.raceDate));
    }

    renderPublicProfile(profile, participatedRaces, inscList, allRaces);
  } catch(e) {
    console.error(e);
    body.innerHTML = `<div class="pp-not-found"><div class="ei">❌</div><h2>ERROR</h2><p style="color:var(--muted)">${e.message}</p></div>`;
  }
}

function renderPublicProfile(profile, participatedRaces, inscList, allRaces) {
  const body = document.getElementById('publicProfileBody');
  const avHtml = profile.picture
    ? `<div class="pp-avatar"><img src="${profile.picture}" alt="${profile.displayName}"></div>`
    : `<div class="pp-avatar">${(profile.displayName || '?')[0].toUpperCase()}</div>`;

  const totalKm = participatedRaces.reduce((a, r) => {
    const part = (r.participations || []).find(p => p.userId === (profile.userId || ''));
    if (!part) return a;
    const d = part.distancia || (r.distances || [])[0] || '';
    const km = parseFloat(d);
    return isNaN(km) ? a : a + km;
  }, 0);

  const profileUrl = `${window.location.origin}${window.location.pathname}?corredor=${profile.slug}`;

  const statsHtml = `
    <div class="pp-stats">
      <div class="pp-stat"><div class="v">${participatedRaces.length}</div><div class="l">CARRERAS</div></div>
      ${inscList.length ? `<div class="pp-stat"><div class="v">${inscList.length}</div><div class="l">PRÓXIMAS</div></div>` : ''}
      ${totalKm > 0 ? `<div class="pp-stat"><div class="v">${totalKm}</div><div class="l">KM TOTAL</div></div>` : ''}
    </div>`;

  // Historial de carreras
  const historialHtml = participatedRaces.length
    ? participatedRaces.map(r => {
        const part = (r.participations || []).find(p => p.userId === (profile.userId || ''));
        const [y, mo, d] = (r.date || '----').split('-');
        const monStr = MS[parseInt(mo)-1] || '';
        const distStr = part?.distancia || '';
        const tiempoStr = profile.showTimes && part?.tiempo ? ` · ⏱ ${part.tiempo}` : '';
        return `<div class="pp-race-row">
          <div class="pp-race-date">${d}/${monStr}<br>${y}</div>
          <div style="flex:1">
            <div class="pp-race-name">${r.name}</div>
            <div class="pp-race-meta">${r.provincia || ''}${r.city ? ' · ' + r.city : ''}</div>
          </div>
          ${distStr ? `<div class="pp-race-dist">${distStr}${tiempoStr}</div>` : ''}
          <span class="bdg bdg-${r.type}" style="margin-left:8px">${TI[r.type]||'🏃'}</span>
        </div>`;
      }).join('')
    : `<div class="pp-empty"><div class="ei">🏁</div><p>Sin historial de carreras aún</p></div>`;

  // Inscripciones futuras
  const proxHtml = inscList.length
    ? inscList.map(ins => {
        const [y, mo, d] = (ins.raceDate || '----').split('-');
        return `<div class="pp-race-row">
          <div class="pp-race-date">${d}/${MS[parseInt(mo)-1]||''}<br>${y}</div>
          <div style="flex:1">
            <div class="pp-race-name">${ins.raceName || '—'}</div>
            <div class="pp-race-meta">${ins.raceProvince || ''}</div>
          </div>
          ${ins.distancia ? `<div class="pp-race-dist">${ins.distancia}</div>` : ''}
          <span class="bdg bdg-${ins.raceType||'road'}" style="margin-left:8px">${TI[ins.raceType]||'🏃'}</span>
        </div>`;
      }).join('')
    : '';

  body.innerHTML = `
    <div class="pp-hero">
      ${avHtml}
      <div class="pp-info">
        <div class="pp-name">${profile.displayName || 'Corredor'}</div>
        <div class="pp-handle">@${profile.slug}</div>
        ${profile.bio ? `<div class="pp-bio">${profile.bio}</div>` : ''}
        ${statsHtml}
      </div>
      <button class="pp-share-btn" onclick="navigator.share ? navigator.share({title:'${profile.displayName}',url:'${profileUrl}'}) : navigator.clipboard.writeText('${profileUrl}').then(()=>alert('Link copiado!'))">
        📤 Compartir perfil
      </button>
    </div>
    <div class="pp-body">
      ${inscList.length ? `<div class="pp-section-title">📅 PRÓXIMAS CARRERAS</div><div class="pp-race-list">${proxHtml}</div>` : ''}
      <div class="pp-section-title">🏁 HISTORIAL</div>
      <div class="pp-race-list">${historialHtml}</div>
    </div>`;
}

// Exponer funciones al HTML (necesario con type="module")
Object.assign(window, {
  openLogin, logout, loginWithGoogle,
  openAddRace, editRace, delRace, saveRace,
  openDetail, openPart, savePart,
  applyFilters, clearFilters,
  togDist, addCD, searchLocation, selectLocation, clearLocation, fetchW,
  prevRacePhoto, prevPartPhotos,
  selMood, bigImg, coo, cm, oo,
  switchTab, handleGpxUpload, toggleTabDropdown, closeTabDropdown,
  connectStrava, disconnectStrava, syncStrava,
  openWkDetail, openLinkRace, linkWkToRace, deleteWorkout,
  applyWkFilters, clearWkFilters, loadMoreWorkouts,
  openAddInsc, inscRaceChanged, prevInscFile, saveInsc, openInscDetail, deleteInsc, editInsc,
  togglePushNotifications,
  renderMapTab, openDetailFromMap,
  openShareCard, selectSharePhoto, downloadShareCard, shareToWhatsApp, nativeShare,
  openAddTri, openEditTri, saveTri, deleteTriConfirm, filterTri,
  openProfileConfig, saveProfile, copyProfileLink, updateProfileLinkPreview
});

init();
checkPublicProfileRoute();

