// Google Apps Script API Endpoint
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbywT3ywXN_8AzgDkxu84NmptcParoG5b_8EXNKceCvGWwTSKUJ2YyC4ApCeFkzvGMr3/exec';

var currentSession = null;
var map, drawControl, drawnItems, existingLayerGroup, gpsMarkerGroup;
var markerClusterGroup;
var currentLayer = null;
var currentFeatureData = null;
var allSavedPlots = [];
var currentFilteredPlots = [];
var isTapToPinActive = false;
var showCrosshair = true;
var showAssetLayer = true;
var isFineRotationActive = false;
var isDrawerOpen = false;
var isMeasuring = false;
var measurePoints = [];
var measureLayerGroup;
var systemSettings = { allowRecord: true, closedMessage: '' };
var selectedBase64Image = '';
var selectedBase64Qr = '';
var customAlertCallback = null;
var selectedPinColor = 'green';

var inspectorMarker = null;
var inspectorPathLine = null;
var inspectorAnimationId = null;
var isInspectorActive = false;

// ตัวแปรสำหรับระบบภาพแผนผังซ้อนทับ
var blueprintLayer = null;
var blueprintImageSrc = '';
var blueprintCenter = null;
var blueprintWidthMeters = 120;
var blueprintHeightMeters = 80;

var INITIAL_CENTER = [13.7563, 100.5018];
var INITIAL_ZOOM = 13;

/* ============================================================
   ระบบสร้างไอคอนหมุด 5 สี
   ============================================================ */
function selectPinColor(colorKey) {
  selectedPinColor = colorKey;
  var labels = document.querySelectorAll('.color-opt-label');
  labels.forEach(l => l.classList.remove('selected'));
  var targetLbl = document.getElementById('lblColor' + colorKey.charAt(0).toUpperCase() + colorKey.slice(1));
  if (targetLbl) targetLbl.classList.add('selected');

  if (currentLayer && currentFeatureData && currentFeatureData.type === 'หมุดตำแหน่งครุภัณฑ์') {
    currentLayer.setIcon(createSvgIcon(colorKey, false));
  }
}

function createSvgIcon(colorType, animate) {
  var colorMap = {
    'green':  { main: '#10b981', inner: '#059669' },
    'red':    { main: '#ef4444', inner: '#b91c1c' },
    'blue':   { main: '#0284c7', inner: '#0369a1' },
    'yellow': { main: '#f59e0b', inner: '#d97706' },
    'purple': { main: '#8b5cf6', inner: '#7c3aed' },
    'ปกติ':    { main: '#10b981', inner: '#059669' },
    'ชำรุด':   { main: '#ef4444', inner: '#b91c1c' }
  };

  var selected = colorMap[colorType] || colorMap['green'];
  var mainColor = selected.main;
  var innerCircle = selected.inner;

  var svgHtml = 
    '<div style="width:26px; height:34px;">' +
      '<svg width="26" height="34" viewBox="0 0 38 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M19 0C8.506 0 0 8.506 0 19C0 32.5 19 48 19 48C19 48 38 32.5 38 19C38 8.506 29.494 0 19 0Z" fill="' + mainColor + '" stroke="#ffffff" stroke-width="2.5"/>' +
        '<circle cx="19" cy="18" r="11" fill="' + innerCircle + '"/>' +
        '<path d="M20 9L13 19H19L17 27L25 17H19L20 9Z" fill="#ffffff"/>' +
      '</svg>' +
    '</div>';

  return L.divIcon({
    className: 'custom-svg-pin',
    html: svgHtml,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -34]
  });
}

var greenIcon = createSvgIcon('green', false);
var redIcon = createSvgIcon('red', false);

/* ============================================================
   ระบบแทรกภาพแผนผังซ้อนทับ (Blueprint Image Overlay)
   ============================================================ */
function triggerBlueprintPicker() {
  document.getElementById('blueprintFileInput').click();
}

function handleBlueprintFile(event) {
  var file = event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    blueprintImageSrc = e.target.result;
    blueprintCenter = map.getCenter();
    toggleBlueprintCard(true);
    renderBlueprintOverlay();
    showToast('📐 แทรกภาพแผนผังแล้ว ปรับขนาดและความเอียงตามต้องการ');
  };
  reader.readAsDataURL(file);
}

function toggleBlueprintCard(show) {
  document.getElementById('blueprintControlCard').style.display = show ? 'block' : 'none';
}

function renderBlueprintOverlay() {
  if (!blueprintImageSrc || !blueprintCenter) return;

  if (blueprintLayer) {
    map.removeLayer(blueprintLayer);
  }

  var scale = parseFloat(document.getElementById('bpScaleRange').value) / 100;
  var aspect = parseFloat(document.getElementById('bpAspectRange').value);
  var opacity = parseFloat(document.getElementById('bpOpacityRange').value) / 100;
  var rotate = parseFloat(document.getElementById('bpRotateRange').value);

  var halfW = (blueprintWidthMeters * scale * aspect) / 2;
  var halfH = (blueprintHeightMeters * scale) / 2;

  var centerPt = turf.point([blueprintCenter.lng, blueprintCenter.lat]);
  var nw = turf.destination(turf.destination(centerPt, -halfH / 1000, 0), -halfW / 1000, 90);
  var se = turf.destination(turf.destination(centerPt, halfH / 1000, 0), halfW / 1000, 90);

  var bounds = [
    [nw.geometry.coordinates[1], nw.geometry.coordinates[0]],
    [se.geometry.coordinates[1], se.geometry.coordinates[0]]
  ];

  blueprintLayer = L.imageOverlay(blueprintImageSrc, bounds, {
    opacity: opacity,
    interactive: true,
    zIndex: 400
  }).addTo(map);

  var el = blueprintLayer.getElement();
  if (el) {
    el.style.transformOrigin = 'center center';
    el.style.transform += ' rotate(' + rotate + 'deg)';
  }
}

function updateBlueprintTransform() {
  var opacity = document.getElementById('bpOpacityRange').value;
  var scale = document.getElementById('bpScaleRange').value;
  var rotate = document.getElementById('bpRotateRange').value;
  var aspect = document.getElementById('bpAspectRange').value;

  document.getElementById('bpOpacityVal').innerText = opacity + '%';
  document.getElementById('bpScaleVal').innerText = scale + '%';
  document.getElementById('bpRotateVal').innerText = rotate + '°';
  document.getElementById('bpAspectVal').innerText = aspect;

  renderBlueprintOverlay();
}

function resetBlueprintTransform() {
  document.getElementById('bpOpacityRange').value = 70;
  document.getElementById('bpScaleRange').value = 100;
  document.getElementById('bpRotateRange').value = 0;
  document.getElementById('bpAspectRange').value = 1.0;
  updateBlueprintTransform();
}

function removeBlueprintOverlay() {
  if (blueprintLayer) {
    map.removeLayer(blueprintLayer);
    blueprintLayer = null;
  }
  blueprintImageSrc = '';
  toggleBlueprintCard(false);
  showToast('นำภาพแผนผังออกเรียบร้อย');
}

/* ============================================================
   ฟังก์ชันจัดการรูปภาพ และ กล้องถ่ายภาพ
   ============================================================ */
function showPhotoChoiceModal() {
  document.getElementById('photoChoiceModal').style.display = 'flex';
}

function closePhotoChoiceModal() {
  document.getElementById('photoChoiceModal').style.display = 'none';
}

function triggerNativeCamera() {
  closePhotoChoiceModal();
  document.getElementById('photoCameraInput').click();
}

function triggerFilePicker(type) {
  closePhotoChoiceModal();
  if (type === 'photo') {
    document.getElementById('photoGalleryInput').click();
  } else if (type === 'qr') {
    document.getElementById('qrGalleryInput').click();
  }
}

function handleDirectFileSelect(event, type) {
  var file = event.target.files[0];
  if (!file) return;
  processImageFile(file, type);
}

function processImageFile(file, type) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxW = 900, maxH = 1200;
      var w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        if (w / h > maxW / maxH) {
          h = Math.round(h * maxW / w);
          w = maxW;
        } else {
          w = Math.round(w * maxH / h);
          h = maxH;
        }
      }
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var base64 = canvas.toDataURL('image/jpeg', 0.75);

      if (type === 'photo') {
        selectedBase64Image = base64;
        document.getElementById('photoPreviewImg').src = base64;
        document.getElementById('photoPreviewWrap').style.display = 'block';
        document.getElementById('photoPlaceholderText').style.display = 'none';
        showToast('บันทึกภาพครุภัณฑ์เรียบร้อย');
      } else if (type === 'qr') {
        selectedBase64Qr = base64;
        document.getElementById('qrPreviewImg').src = base64;
        document.getElementById('qrPreviewWrap').style.display = 'block';
        document.getElementById('photoPlaceholderText').style.display = 'none';
        showToast('เลือกภาพ QR Code เรียบร้อย');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   ระบบเชื่อมต่อ API
   ============================================================ */
async function callGasGet(action, params = {}) {
  const url = new URL(GAS_API_URL);
  url.searchParams.append('action', action);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, v);
  }
  const res = await fetch(url.toString());
  return await res.json();
}

async function callGasPost(action, data = {}) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, ...data })
  });
  return await res.json();
}

function showCustomerAlert(title, message, iconType, callback) {
  customAlertCallback = callback || null;
  document.getElementById('customAlertTitle').innerText = title || 'แจ้งเตือนระบบ';
  document.getElementById('customAlertMsg').innerText = message || '';
  
  var icon = '🔔';
  if (iconType === 'success') icon = '✅';
  else if (iconType === 'error') icon = '❌';
  else if (iconType === 'warning') icon = '⚠️';
  else if (iconType === 'info') icon = 'ℹ️';
  else if (iconType === 'confirm') icon = '❓';
  document.getElementById('customAlertIcon').innerText = icon;

  var btnCancel = document.getElementById('btnAlertCancel');
  btnCancel.style.display = (iconType === 'confirm') ? 'block' : 'none';
  document.getElementById('customAlertOverlay').style.display = 'flex';
}

function resolveCustomAlert(result) {
  document.getElementById('customAlertOverlay').style.display = 'none';
  if (customAlertCallback) {
    customAlertCallback(result);
    customAlertCallback = null;
  }
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.className = 'show';
  setTimeout(function() { toast.className = ''; }, 3500);
}

window.onload = function() {
  initMap();
  fetchSystemSettings();
  initKeyboardShortcuts();

  var savedAuth = sessionStorage.getItem('deptAuth');
  if (savedAuth) {
    try {
      currentSession = JSON.parse(savedAuth);
      applyAuthSuccess();
    } catch(e) {
      sessionStorage.removeItem('deptAuth');
      loadSavedData();
    }
  } else {
    loadSavedData();
  }
};

function initKeyboardShortcuts() {
  window.addEventListener('keydown', function(e) {
    if (e.code === 'Space' || e.key === ' ') {
      var activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      var isEditable = document.activeElement ? document.activeElement.isContentEditable : false;
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || isEditable) return;
      e.preventDefault();
      pinMapCenter();
    }
  });
}

async function fetchSystemSettings() {
  try {
    const res = await callGasGet('getSystemSettings');
    if (res) {
      systemSettings = res;
      updateSystemClosedUI();
    }
  } catch(e) {}
}

function updateSystemClosedUI() {
  var banner = document.getElementById('systemClosedBanner');
  var msgText = document.getElementById('systemClosedMsgText');
  var saveBtn = document.getElementById('saveBtn');

  if (!systemSettings.allowRecord) {
    banner.style.display = 'flex';
    msgText.innerText = systemSettings.closedMessage;
    if (!currentSession || !currentSession.isAdmin) {
      saveBtn.disabled = true;
      saveBtn.title = 'ระบบปิดรับการบันทึกข้อมูลชั่วคราว';
    }
  } else {
    banner.style.display = 'none';
    if (currentFeatureData) saveBtn.disabled = false;
  }

  var adminBtn = document.getElementById('btnAdminToggleRecord');
  if (adminBtn) {
    adminBtn.style.background = systemSettings.allowRecord ? '#10b981' : '#ef4444';
    adminBtn.innerHTML = systemSettings.allowRecord ? '🟢 เปิดรับข้อมูลอยู่ (กดเพื่อปิด)' : '🔴 ปิดรับข้อมูลอยู่ (กดเพื่อเปิด)';
  }
}

function toggleAdminRecording() {
  if (!currentSession || !currentSession.isAdmin) return;
  var newStatus = !systemSettings.allowRecord;
  
  showCustomerAlert(
    'ตั้งค่าสถานะระบบ',
    newStatus ? 'คุณต้องการเปิดรับการบันทึกข้อมูลใช่หรือไม่?' : 'คุณต้องการปิดรับการบันทึกข้อมูลชั่วคราวใช่หรือไม่?',
    'confirm',
    async function(confirmed) {
      if (!confirmed) return;
      showToast('กำลังบันทึกการตั้งค่าระบบ...');
      try {
        const res = await callGasPost('toggleSystemRecording', {
          deptCode: currentSession.deptCode,
          allowStatus: newStatus,
          customMsg: systemSettings.closedMessage
        });
        if (res.success) {
          systemSettings.allowRecord = res.allowRecord;
          updateSystemClosedUI();
          showCustomerAlert('สำเร็จ', res.message, 'success');
        } else {
          showCustomerAlert('ผิดพลาด', res.message, 'error');
        }
      } catch(err) {
        showCustomerAlert('เกิดข้อผิดพลาด', err.toString(), 'error');
      }
    }
  );
}

function toggleAssetLayer() {
  showAssetLayer = !showAssetLayer;
  var btn = document.getElementById('toggleAssetBtnInner');
  if (showAssetLayer) {
    map.addLayer(markerClusterGroup);
    map.addLayer(existingLayerGroup);
    if (btn) {
      btn.className = 'leaflet-custom-btn layer-active';
      btn.innerHTML = '📍 หมุดครุภัณฑ์: เปิด';
    }
    showToast('แสดงหมุดครุภัณฑ์บนแผนที่แล้ว');
  } else {
    map.removeLayer(markerClusterGroup);
    map.removeLayer(existingLayerGroup);
    if (btn) {
      btn.className = 'leaflet-custom-btn';
      btn.innerHTML = '📍 หมุดครุภัณฑ์: ปิด';
    }
    showToast('ซ่อนหมุดครุภัณฑ์บนแผนที่แล้ว');
  }
}

function resetMapView() {
  stopInspectorAnimation();
  map.closePopup();
  if (map.setBearing) map.setBearing(0);
  if (markerClusterGroup && markerClusterGroup.getLayers().length > 0) {
    var bounds = markerClusterGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: true, duration: 0.8 });
    } else {
      map.flyTo(INITIAL_CENTER, INITIAL_ZOOM);
    }
  } else {
    map.flyTo(INITIAL_CENTER, INITIAL_ZOOM);
  }
  showToast('🔄 รีเซ็ตมุมมองและทิศเหนือแผนที่แล้ว');
}

function toggleToolsDrawer() {
  isDrawerOpen = !isDrawerOpen;
  var drawer = document.getElementById('toolsDrawerContent');
  var btn = document.getElementById('btnToggleToolsDrawer');
  if (isDrawerOpen) {
    drawer.classList.add('open');
    btn.innerHTML = '✕ ปิดเครื่องมือ';
  } else {
    drawer.classList.remove('open');
    btn.innerHTML = '🛠️ เครื่องมือ';
  }
}

function toggleFineRotation() {
  isFineRotationActive = !isFineRotationActive;
  var btn = document.getElementById('toggleFineBtnInner');
  if (isFineRotationActive) {
    if (btn) {
      btn.className = 'leaflet-custom-btn fine-active';
      btn.innerHTML = '⚙️ ละเอียด 1°: เปิด';
    }
    showToast('เปิดโหมดหมุนละเอียดทีละ 1 องศาแล้ว');
  } else {
    if (btn) {
      btn.className = 'leaflet-custom-btn';
      btn.innerHTML = '⚙️ ละเอียด 1°: ปิด';
    }
    showToast('เปลี่ยนกลับเป็นโหมดหมุนหลักทีละ 15 องศา');
  }
}

function rotateMapLeft() {
  if (!map.getBearing) return;
  var step = isFineRotationActive ? 1 : 15;
  map.setBearing(map.getBearing() - step);
}

function rotateMapRight() {
  if (!map.getBearing) return;
  var step = isFineRotationActive ? 1 : 15;
  map.setBearing(map.getBearing() + step);
}

function resetNorth() {
  if (!map.getBearing) return;
  map.setBearing(0);
  showToast('🧭 หมุนกลับทิศเหนือแล้ว');
}

function toggleMeasureTool() {
  isMeasuring = !isMeasuring;
  var btn = document.getElementById('btnMeasureLeft');
  measurePoints = [];
  measureLayerGroup.clearLayers();
  if (isMeasuring) {
    if (btn) btn.classList.add('active-tool');
    showCustomerAlert('โหมดวัดระยะทาง', 'คลิกจุดบนแผนที่ต่อเนื่องเพื่อคำนวณระยะทางรวม', 'info');
  } else {
    if (btn) btn.classList.remove('active-tool');
    showToast('ปิดโหมดวัดระยะทางแล้ว');
  }
}

function openLoginModal() {
  document.getElementById('loginModal').style.display = 'flex';
  document.getElementById('inputDeptCode').focus();
}

function closeLoginModal() {
  document.getElementById('loginModal').style.display = 'none';
}

function removePhoto(event, type) {
  if (event) event.stopPropagation();
  if (type === 'photo') {
    selectedBase64Image = '';
    document.getElementById('currentExistingImageUrl').value = '';
    document.getElementById('photoCameraInput').value = '';
    document.getElementById('photoGalleryInput').value = '';
    document.getElementById('photoPreviewImg').src = '';
    document.getElementById('photoPreviewWrap').style.display = 'none';
    document.getElementById('photoPlaceholderText').style.display = 'block';
  } else if (type === 'qr') {
    selectedBase64Qr = '';
    document.getElementById('currentExistingQrUrl').value = '';
    document.getElementById('qrGalleryInput').value = '';
    document.getElementById('qrPreviewImg').src = '';
    document.getElementById('qrPreviewWrap').style.display = 'none';
    document.getElementById('qrPlaceholderText').style.display = 'block';
  }
}

function toggleCrosshair() {
  showCrosshair = !showCrosshair;
  var crosshairEl = document.getElementById('centerCrosshair');
  var btnEl = document.getElementById('toggleTargetBtnInner');
  if (showCrosshair) {
    crosshairEl.style.display = 'flex';
    if (btnEl) {
      btnEl.className = 'leaflet-custom-btn active';
      btnEl.innerText = '🎯 เป้าโฟกัส: เปิด';
    }
    showToast('เปิดเป้าเล็งกลางจอแล้ว');
  } else {
    crosshairEl.style.display = 'none';
    if (btnEl) {
      btnEl.className = 'leaflet-custom-btn';
      btnEl.innerText = '🎯 เป้าโฟกัส: ปิด';
    }
  }
}

function toggleMobileSidebar(forceState) {
  var sidebar = document.getElementById('sidebar');
  var icon = document.getElementById('toggleIcon');
  var text = document.getElementById('toggleText');
  
  if (forceState !== undefined) {
    if (forceState) sidebar.classList.add('open');
    else sidebar.classList.remove('open');
  } else {
    sidebar.classList.toggle('open');
  }

  if (sidebar.classList.contains('open')) {
    icon.innerText = '🗺️';
    text.innerText = 'ดูแผนที่';
  } else {
    icon.innerText = '📝';
    text.innerText = 'เปิดฟอร์มบันทึก';
  }
}

function initMap() {
  var esriClean = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 22, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri'
  });
  var googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 22, maxNativeZoom: 21, attribution: '&copy; Google Maps'
  });
  var cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 22, maxNativeZoom: 20, attribution: '&copy; CartoDB'
  });
  var osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap'
  });

  map = L.map('map', {
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    maxZoom: 22,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    layers: [esriClean],
    zoomControl: false,
    rotate: true,
    bearing: 0,
    touchRotate: true,
    shiftKeyRotate: true,
    closePopupOnClick: false
  });

  L.control.zoom({ position: 'topright' }).addTo(map);

  var baseMaps = {
    "🛰️ ดาวเทียมธรรมชาติ (Esri Clean)": esriClean,
    "🛰️ ดาวเทียม + ถนน (Google Hybrid)": googleHybrid,
    "🗺️ แผนที่โทนสว่าง (Clean Light)": cartoLight,
    "🗺️ แผนที่มาตรฐาน (OSM)": osmStandard
  };
  L.control.layers(baseMaps, null, { position: 'topright', collapsed: true }).addTo(map);

  var LeftActionControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function(map) {
      var container = L.DomUtil.create('div', 'leaflet-bar');
      var btnCompass = L.DomUtil.create('a', 'leaflet-left-tool-btn', container);
      btnCompass.id = 'btnCompassLeft';
      btnCompass.innerHTML = '<span id="compassIcon" class="compass-needle-left">🧭</span>';
      btnCompass.href = '#';
      btnCompass.title = 'รีเซ็ตทิศเหนือ (0°)';
      L.DomEvent.disableClickPropagation(btnCompass);
      L.DomEvent.on(btnCompass, 'click', function(e) { L.DomEvent.stop(e); resetNorth(); });

      var btnMeasure = L.DomUtil.create('a', 'leaflet-left-tool-btn', container);
      btnMeasure.id = 'btnMeasureLeft';
      btnMeasure.innerHTML = '📏';
      btnMeasure.href = '#';
      btnMeasure.title = 'เครื่องมือวัดระยะทาง';
      L.DomEvent.disableClickPropagation(btnMeasure);
      L.DomEvent.on(btnMeasure, 'click', function(e) { L.DomEvent.stop(e); toggleMeasureTool(); });

      return container;
    }
  });
  map.addControl(new LeftActionControl());

  var RightActionControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function(map) {
      var container = L.DomUtil.create('div', 'leaflet-control-btn-group');

      var btnMainToggle = L.DomUtil.create('button', 'leaflet-custom-btn btn-toggle-drawer', container);
      btnMainToggle.id = 'btnToggleToolsDrawer';
      btnMainToggle.innerHTML = '🛠️ เครื่องมือ';
      L.DomEvent.disableClickPropagation(btnMainToggle);
      L.DomEvent.on(btnMainToggle, 'click', function(e) { L.DomEvent.stop(e); toggleToolsDrawer(); });

      var drawer = L.DomUtil.create('div', 'tools-drawer-content', container);
      drawer.id = 'toolsDrawerContent';

      var rotateRow = L.DomUtil.create('div', '', drawer);
      rotateRow.style.display = 'flex'; rotateRow.style.gap = '6px';

      var btnRotLeft = L.DomUtil.create('button', 'leaflet-custom-btn', rotateRow);
      btnRotLeft.innerHTML = '↺ หมุนซ้าย'; btnRotLeft.style.flex = '1';
      L.DomEvent.disableClickPropagation(btnRotLeft);
      L.DomEvent.on(btnRotLeft, 'click', function(e) { L.DomEvent.stop(e); rotateMapLeft(); });

      var btnRotRight = L.DomUtil.create('button', 'leaflet-custom-btn', rotateRow);
      btnRotRight.innerHTML = 'หมุนขวา ↻'; btnRotRight.style.flex = '1';
      L.DomEvent.disableClickPropagation(btnRotRight);
      L.DomEvent.on(btnRotRight, 'click', function(e) { L.DomEvent.stop(e); rotateMapRight(); });

      var btnFine = L.DomUtil.create('button', 'leaflet-custom-btn', drawer);
      btnFine.id = 'toggleFineBtnInner';
      btnFine.innerHTML = '⚙️ ละเอียด 1°: ปิด'; btnFine.style.width = '100%';
      L.DomEvent.disableClickPropagation(btnFine);
      L.DomEvent.on(btnFine, 'click', function(e) { L.DomEvent.stop(e); toggleFineRotation(); });

      var btnBlueprint = L.DomUtil.create('button', 'leaflet-custom-btn', drawer);
      btnBlueprint.innerHTML = '📐 แทรกภาพแผนผัง'; btnBlueprint.style.width = '100%';
      L.DomEvent.disableClickPropagation(btnBlueprint);
      L.DomEvent.on(btnBlueprint, 'click', function(e) {
        L.DomEvent.stop(e);
        triggerBlueprintPicker();
      });

      var btnSurveyor = L.DomUtil.create('button', 'leaflet-custom-btn', drawer);
      btnSurveyor.id = 'btnToggleSurveyor';
      btnSurveyor.innerHTML = '👷‍♂️ ช่างเดินสำรวจ: เริ่ม'; btnSurveyor.style.width = '100%';
      L.DomEvent.disableClickPropagation(btnSurveyor);
      L.DomEvent.on(btnSurveyor, 'click', function(e) { L.DomEvent.stop(e); toggleInspectorSurvey(); });

      var btnAsset = L.DomUtil.create('button', 'leaflet-custom-btn layer-active', drawer);
      btnAsset.id = 'toggleAssetBtnInner';
      btnAsset.innerHTML = '📍 หมุดครุภัณฑ์: เปิด'; btnAsset.style.width = '100%';
      L.DomEvent.disableClickPropagation(btnAsset);
      L.DomEvent.on(btnAsset, 'click', function(e) { L.DomEvent.stop(e); toggleAssetLayer(); });

      var btnTarget = L.DomUtil.create('button', 'leaflet-custom-btn active', drawer);
      btnTarget.id = 'toggleTargetBtnInner';
      btnTarget.innerHTML = '🎯 เป้าโฟกัส: เปิด'; btnTarget.style.width = '100%';
      L.DomEvent.disableClickPropagation(btnTarget);
      L.DomEvent.on(btnTarget, 'click', function(e) { L.DomEvent.stop(e); toggleCrosshair(); });

      var btnReset = L.DomUtil.create('button', 'leaflet-custom-btn', drawer);
      btnReset.id = 'resetViewBtnInner';
      btnReset.innerHTML = '🔄 รีเซ็ตมุมมอง'; btnReset.style.width = '100%';
      L.DomEvent.disableClickPropagation(btnReset);
      L.DomEvent.on(btnReset, 'click', function(e) { L.DomEvent.stop(e); resetMapView(); });

      return container;
    }
  });
  map.addControl(new RightActionControl());

  map.on('rotate', function() {
    var bearing = Math.round(map.getBearing ? map.getBearing() : 0);
    if (bearing < 0) bearing += 360;
    var needle = document.getElementById('compassIcon');
    if (needle) needle.style.transform = 'rotate(' + (-bearing) + 'deg)';
  });

  drawnItems = new L.FeatureGroup().addTo(map);
  existingLayerGroup = new L.FeatureGroup().addTo(map);
  gpsMarkerGroup = new L.FeatureGroup().addTo(map);
  measureLayerGroup = new L.FeatureGroup().addTo(map);

  markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 40,
    disableClusteringAtZoom: 18,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true
  }).addTo(map);

  drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: { allowIntersection: false, shapeOptions: { color: '#10b981', weight: 2.5, fillOpacity: 0.3 } },
      rectangle: { shapeOptions: { color: '#10b981', weight: 2.5, fillOpacity: 0.3 } },
      marker: { icon: createSvgIcon('green', true) },
      circle: false, circlemarker: false, polyline: false
    },
    edit: { featureGroup: drawnItems, remove: true }
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, function(e) { handleFeatureCreated(e.layer, e.layerType); });

  map.on('click', function(e) {
    if (isMeasuring) { handleMeasureClick(e.latlng); return; }
    if (isTapToPinActive) {
      isTapToPinActive = false;
      setMarkerAtCoords(e.latlng.lat, e.latlng.lng, 'พิกัดจากการสัมผัสแผนที่', true);
      toggleMobileSidebar(true);
    }
  });
}

function handleMeasureClick(latlng) {
  measurePoints.push(latlng);
  var mIcon = L.divIcon({
    className: 'measure-dot',
    html: '<div style="width:10px;height:10px;background:#f59e0b;border:2px solid white;border-radius:50%;"></div>',
    iconSize: [10, 10], iconAnchor: [5, 5]
  });
  L.marker(latlng, { icon: mIcon }).addTo(measureLayerGroup);

  if (measurePoints.length > 1) {
    var polyline = L.polyline(measurePoints, { color: '#f59e0b', weight: 3, dashArray: '5, 8' }).addTo(measureLayerGroup);
    var totalDist = 0;
    for (var i = 0; i < measurePoints.length - 1; i++) {
      var from = turf.point([measurePoints[i].lng, measurePoints[i].lat]);
      var to = turf.point([measurePoints[i+1].lng, measurePoints[i+1].lat]);
      totalDist += turf.distance(from, to, { units: 'kilometers' });
    }
    var distText = (totalDist < 1) ? (Math.round(totalDist * 1000) + ' เมตร') : (totalDist.toFixed(2) + ' กม.');
    polyline.bindTooltip('ระยะทางรวม: ' + distText, { permanent: true, direction: 'center' }).openTooltip();
    showToast('ระยะทาง: ' + distText);
  }
}

function handleFeatureCreated(layer, layerType) {
  drawnItems.clearLayers();
  currentLayer = layer;
  drawnItems.addLayer(currentLayer);

  var geojson = currentLayer.toGeoJSON();
  var type = (layerType === 'marker') ? 'หมุดตำแหน่งครุภัณฑ์' : 'แปลงพื้นที่';
  var lat = 0, lng = 0, areaSqm = 0, areaThai = '-';

  if (type === 'แปลงพื้นที่') {
    areaSqm = turf.area(geojson);
    areaThai = formatThaiArea(areaSqm);
    var centroid = turf.centroid(geojson);
    lng = centroid.geometry.coordinates[0];
    lat = centroid.geometry.coordinates[1];
    document.getElementById('areaPreviewText').innerText = 'ขนาดพื้นที่: ' + areaSqm.toLocaleString(undefined, {maximumFractionDigits: 2}) + ' ตร.ม. (' + areaThai + ')';
    layer.bindPopup('<b>📐 ผลการคำนวณพื้นที่</b><br>ขนาด: ' + areaSqm.toLocaleString(undefined, {maximumFractionDigits: 2}) + ' ตร.ม.<br>(' + areaThai + ')').openPopup();
  } else {
    lng = geojson.geometry.coordinates[0];
    lat = geojson.geometry.coordinates[1];
    document.getElementById('areaPreviewText').innerText = '';

    if (currentLayer.dragging) {
      currentLayer.dragging.enable();
      currentLayer.on('dragend', function(evt) {
        var pos = evt.target.getLatLng();
        currentFeatureData.lat = pos.lat;
        currentFeatureData.lng = pos.lng;
        document.getElementById('prevLat').innerText = pos.lat.toFixed(6);
        document.getElementById('prevLng').innerText = pos.lng.toFixed(6);
        showToast('อัปเดตพิกัดจากการเลื่อนแล้ว');
      });
    }
  }

  currentFeatureData = {
    type: type, lat: lat, lng: lng,
    boundary: (type === 'แปลงพื้นที่') ? geojson.geometry.coordinates : null,
    areaSqm: areaSqm, areaThai: areaThai
  };

  document.getElementById('prevLat').innerText = lat.toFixed(6);
  document.getElementById('prevLng').innerText = lng.toFixed(6);
  document.getElementById('coordPreviewBox').style.display = 'block';
  document.getElementById('shapeStatus').innerText = 'กำหนดพิกัดแล้ว (' + type + ')';
  
  if (currentSession) {
    document.getElementById('saveBtn').disabled = (!systemSettings.allowRecord && !currentSession.isAdmin);
    if (window.innerWidth <= 768) toggleMobileSidebar(true);
  } else {
    showToast('กำหนดพิกัดเรียบร้อย (เข้าสู่ระบบเพื่อบันทึกข้อมูล)');
  }
}

function setMarkerAtCoords(lat, lng, statusText, animate) {
  drawnItems.clearLayers();
  var animIcon = createSvgIcon(selectedPinColor, animate !== false);
  var marker = L.marker([lat, lng], { icon: animIcon, draggable: true }).addTo(drawnItems);
  currentLayer = marker;

  marker.on('dragend', function(e) {
    var p = e.target.getLatLng();
    currentFeatureData.lat = p.lat; currentFeatureData.lng = p.lng;
    document.getElementById('prevLat').innerText = p.lat.toFixed(6);
    document.getElementById('prevLng').innerText = p.lng.toFixed(6);
  });

  currentFeatureData = {
    type: 'หมุดตำแหน่งครุภัณฑ์', lat: lat, lng: lng,
    boundary: null, areaSqm: 0, areaThai: '-'
  };

  document.getElementById('prevLat').innerText = lat.toFixed(6);
  document.getElementById('prevLng').innerText = lng.toFixed(6);
  document.getElementById('areaPreviewText').innerText = '';
  document.getElementById('coordPreviewBox').style.display = 'block';
  document.getElementById('shapeStatus').innerText = statusText || 'พิกัดหมุด (ลากย้ายได้)';
  
  if (currentSession) {
    document.getElementById('saveBtn').disabled = (!systemSettings.allowRecord && !currentSession.isAdmin);
  }
}

function pinCurrentLocation() {
  if (!navigator.geolocation) {
    showCustomerAlert('ไม่รองรับ GPS', 'อุปกรณ์นี้ไม่รองรับการระบุตำแหน่งผ่าน GPS', 'error');
    return;
  }
  showToast('กำลังรับสัญญาณ GPS...');
  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude; var lng = pos.coords.longitude;
    map.flyTo([lat, lng], 19);
    setMarkerAtCoords(lat, lng, 'พิกัด GPS ปัจจุบัน (ความแม่นยำ ~' + Math.round(pos.coords.accuracy) + ' ม.)', true);
    showToast('ปักหมุด GPS สำเร็จ');
  }, function(err) {
    showCustomerAlert('ระบุพิกัดไม่สำเร็จ', err.message, 'error');
  }, { enableHighAccuracy: true });
}

function pinMapCenter() {
  var center = map.getCenter();
  setMarkerAtCoords(center.lat, center.lng, 'พิกัดตรงจุดเล็งกึ่งกลางหน้าจอ', true);
  showToast('ปักหมุดที่เป้าโฟกัสเรียบร้อย');
  if (window.innerWidth <= 768) toggleMobileSidebar(true);
}

function enableMapTapPin() {
  isTapToPinActive = true;
  toggleMobileSidebar(false);
  showCustomerAlert('แตะบนแผนที่', 'กรุณาสัมผัสจุดบนแผนที่ที่ต้องการกำหนดพิกัด', 'info');
}

function formatThaiArea(sqm) {
  var wah = sqm / 4;
  var rai = Math.floor(wah / 400);
  var ngan = Math.floor((wah % 400) / 100);
  var remainWah = (wah % 100).toFixed(1);
  return rai + ' ไร่ ' + ngan + ' งาน ' + remainWah + ' ตร.ว.';
}

async function handleLogin() {
  var code = document.getElementById('inputDeptCode').value.trim();
  if (!code) {
    showCustomerAlert('กรอกรหัสผ่าน', 'กรุณากรอกรหัสผ่านประจำฝ่าย', 'warning');
    return;
  }
  try {
    const res = await callGasGet('verifyDeptCode', { code: code });
    if (res.success) {
      currentSession = res;
      sessionStorage.setItem('deptAuth', JSON.stringify(res));
      applyAuthSuccess();
    } else {
      showCustomerAlert('เข้าสู่ระบบไม่สำเร็จ', res.message, 'error');
    }
  } catch(err) {
    showCustomerAlert('เกิดข้อผิดพลาด', err.toString(), 'error');
  }
}

function applyAuthSuccess() {
  closeLoginModal();
  document.getElementById('userBadge').innerText = currentSession.deptName;
  document.getElementById('guestBanner').style.display = 'none';
  document.getElementById('formCard').style.display = 'block';
  document.getElementById('adminControlCard').style.display = currentSession.isAdmin ? 'block' : 'none';

  var headerBtn = document.getElementById('headerAuthBtn');
  headerBtn.innerText = 'ออกจากระบบ';
  headerBtn.className = 'btn-header-action logout';
  headerBtn.onclick = handleLogout;

  var selectDept = document.getElementById('plotDept');
  if (!currentSession.isAdmin) {
    selectDept.value = currentSession.deptCode;
    selectDept.disabled = true;
  } else {
    selectDept.disabled = false;
  }

  fetchSystemSettings();
  loadSavedData();
  showCustomerAlert('เข้าสู่ระบบสำเร็จ', 'ยินดีต้อนรับ ' + currentSession.deptName, 'success');
}

function handleLogout() {
  sessionStorage.removeItem('deptAuth');
  currentSession = null;
  cancelEditMode();
  stopInspectorAnimation();
  
  document.getElementById('inputDeptCode').value = '';
  document.getElementById('userBadge').innerText = 'โหมดทั่วไป (ดูข้อมูล)';
  document.getElementById('guestBanner').style.display = 'block';
  document.getElementById('formCard').style.display = 'none';
  document.getElementById('adminControlCard').style.display = 'none';

  var headerBtn = document.getElementById('headerAuthBtn');
  headerBtn.innerText = '🔐 เข้าสู่ระบบ';
  headerBtn.className = 'btn-header-action';
  headerBtn.onclick = openLoginModal;

  fetchSystemSettings();
  loadSavedData();
  showToast('ออกจากระบบเรียบร้อยแล้ว');
}

async function loadSavedData() {
  document.getElementById('recordsList').innerHTML = '<p style="font-size:12px;color:#888;text-align:center;">กำลังโหลดข้อมูล...</p>';
  var code = currentSession ? currentSession.deptCode : '';
  try {
    const data = await callGasGet('getSavedPlots', { deptCode: code });
    allSavedPlots = data || [];
    localStorage.setItem('cached_plots', JSON.stringify(allSavedPlots));
    updateLocationFilterOptions();
    applyDataFilters(false);
  } catch(err) {
    var cached = localStorage.getItem('cached_plots');
    if (cached) {
      allSavedPlots = JSON.parse(cached);
      updateLocationFilterOptions();
      applyDataFilters(false);
      showToast('⚠️ แสดงข้อมูลแคชในโหมดออฟไลน์');
    } else {
      showCustomerAlert('ดึงข้อมูลไม่สำเร็จ', err.toString(), 'error');
    }
  }
}

function onDeptFilterChange() {
  updateLocationFilterOptions();
  applyDataFilters(true);
}

function updateLocationFilterOptions() {
  var selectedDept = document.getElementById('filterDeptSelect').value;
  var locSelect = document.getElementById('filterLocationSelect');
  var previousSelectedLoc = locSelect.value;

  var targetPlots = allSavedPlots;
  if (selectedDept !== 'ALL') {
    targetPlots = allSavedPlots.filter(function(item) {
      return String(item.deptCode).trim() === selectedDept;
    });
  }

  var uniqueLocations = [];
  targetPlots.forEach(function(item) {
    var loc = (item.location || '').trim();
    if (loc && loc !== '-' && !uniqueLocations.includes(loc)) {
      uniqueLocations.push(loc);
    }
  });
  uniqueLocations.sort();

  locSelect.innerHTML = '<option value="ALL">📍 แสดงทุกสถานที่' + (selectedDept !== 'ALL' ? ' ในฝ่ายนี้' : '') + '</option>';
  uniqueLocations.forEach(function(locName) {
    var opt = document.createElement('option');
    opt.value = locName; opt.innerText = '📍 ' + locName;
    locSelect.appendChild(opt);
  });

  locSelect.value = uniqueLocations.includes(previousSelectedLoc) ? previousSelectedLoc : 'ALL';
}

function updateSummaryStats(filteredData) {
  var total = filteredData.length, normalCount = 0, damagedCount = 0;
  filteredData.forEach(function(item) {
    if (item.status === 'ปกติ') normalCount++;
    else if (item.status === 'ชำรุด') damagedCount++;
  });
  document.getElementById('statTotal').innerText = total.toLocaleString();
  document.getElementById('statNormal').innerText = normalCount.toLocaleString();
  document.getElementById('statDamaged').innerText = damagedCount.toLocaleString();
}

function applyDataFilters(shouldZoom) {
  var deptFilter = document.getElementById('filterDeptSelect').value;
  var locFilter = document.getElementById('filterLocationSelect').value;

  var filtered = allSavedPlots.filter(function(item) {
    var matchDept = (deptFilter === 'ALL') || (String(item.deptCode).trim() === deptFilter);
    var matchLoc = (locFilter === 'ALL') || (String(item.location || '').trim() === locFilter);
    return matchDept && matchLoc;
  });

  currentFilteredPlots = filtered;
  updateSummaryStats(filtered);
  renderSavedOnMapAndList(filtered);
  stopInspectorAnimation();

  if (shouldZoom && filtered.length > 0) {
    if (locFilter !== 'ALL') {
      focusOnFilteredFeatures(filtered, function() { startInspectorSurvey(filtered); });
      showToast('โฟกัสไปยัง: ' + locFilter);
    } else if (deptFilter !== 'ALL') {
      focusOnFilteredFeatures(filtered);
    }
  }
}

function toggleInspectorSurvey() {
  if (isInspectorActive) {
    stopInspectorAnimation();
    showToast('หยุดการเดินสำรวจแล้ว');
  } else {
    if (!currentFilteredPlots || currentFilteredPlots.length < 2) {
      showCustomerAlert('เริ่มสำรวจไม่ได้', 'ต้องมีหมุดในสถานที่นี้อย่างน้อย 2 จุดขึ้นไปเพื่อเริ่มเดินสำรวจ', 'warning');
      return;
    }
    startInspectorSurvey(currentFilteredPlots);
    showToast('👷‍♂️ เริ่มการเดินสำรวจครุภัณฑ์');
  }
}

function startInspectorSurvey(plots) {
  stopInspectorAnimation();
  var waypoints = [];
  plots.forEach(function(item) {
    if (item.lat && item.lng) {
      waypoints.push({ id: String(item.id), lat: item.lat, lng: item.lng, name: item.name || 'ครุภัณฑ์', status: item.status || 'ปกติ' });
    }
  });
  if (waypoints.length < 2) return;

  isInspectorActive = true;
  var btn = document.getElementById('btnToggleSurveyor');
  if (btn) { btn.className = 'leaflet-custom-btn active'; btn.innerHTML = '🛑 หยุดการเดินสำรวจ'; }

  var pathCoords = waypoints.map(function(w) { return [w.lat, w.lng]; });
  pathCoords.push(pathCoords[0]);

  inspectorPathLine = L.polyline(pathCoords, { color: '#0284c7', weight: 1.5, opacity: 0, interactive: false }).addTo(map);

  var inspectorIcon = L.divIcon({
    className: 'inspector-div-icon',
    html: '<div class="inspector-marker-wrap"><div class="inspector-radar-pulse"></div><div id="inspectorAvatarEl" class="inspector-avatar">👷‍♂️</div></div>',
    iconSize: [36, 36], iconAnchor: [18, 18]
  });

  inspectorMarker = L.marker(pathCoords[0], { icon: inspectorIcon, zIndexOffset: 3000, interactive: false }).addTo(map);

  var currentIdx = 0, progress = 0, lastTimestamp = null, walkSpeedMetersPerSec = 1.3;
  var isOrbiting = false, orbitAngle = 0, orbitLapsCompleted = 0, currentOrbitTarget = null;
  var orbitRadiusMeters = 3.2, orbitAngularSpeed = 3.8;

  function getQuickDistMeters(lat1, lng1, lat2, lng2) {
    var dy = (lat2 - lat1) * 111320, dx = (lng2 - lng1) * (111320 * 0.97);
    return Math.sqrt(dx * dx + dy * dy);
  }

  var cachedLayers = [];
  var cacheCollector = function(l) {
    if (l.getLatLng && l.options && l.options.featureId) {
      cachedLayers.push({ layer: l, id: String(l.options.featureId), lat: l.getLatLng().lat, lng: l.getLatLng().lng });
    }
  };
  if (markerClusterGroup) markerClusterGroup.eachLayer(cacheCollector);
  if (existingLayerGroup) existingLayerGroup.eachLayer(cacheCollector);

  var lastProximityCheckTime = 0;
  function checkProximityAndHighlight(curLat, curLng, now) {
    if (now - lastProximityCheckTime < 120) return;
    lastProximityCheckTime = now;
    var pinGlowRadius = 2.2;

    for (var i = 0; i < cachedLayers.length; i++) {
      var item = cachedLayers[i];
      var dist = getQuickDistMeters(curLat, curLng, item.lat, item.lng);
      var el = item.layer.getElement ? item.layer.getElement() : null;
      var itemData = waypoints.find(function(w) { return w.id === item.id; });
      var isDamaged = itemData ? (itemData.status === 'ชำรุด') : false;

      if (dist <= pinGlowRadius) {
        if (isDamaged && !isOrbiting && currentOrbitTarget !== itemData) {
          isOrbiting = true; orbitAngle = 0; orbitLapsCompleted = 0; currentOrbitTarget = itemData;
        }
        if (el && !el.classList.contains('pin-highlight-active') && !el.classList.contains('pin-damaged-alert-active')) {
          el.classList.add(isDamaged ? 'pin-damaged-alert-active' : 'pin-highlight-active');
          if (typeof item.layer.openTooltip === 'function') {
            var tooltip = item.layer.getTooltip();
            if (tooltip) {
              item.layer.setTooltipContent(isDamaged ? ('⚠️ ชำรุด: ' + (itemData ? itemData.name : 'ครุภัณฑ์')) : ('<b>' + (itemData ? itemData.name : 'ครุภัณฑ์') + '</b>'));
              item.layer.openTooltip();
              var tEl = tooltip.getElement();
              if (tEl) tEl.classList.add(isDamaged ? 'inspector-tooltip-damaged' : 'inspector-tooltip-highlight');
            }
          }
        }
      } else if (!isOrbiting) {
        if (el && (el.classList.contains('pin-highlight-active') || el.classList.contains('pin-damaged-alert-active'))) {
          el.classList.remove('pin-highlight-active', 'pin-damaged-alert-active');
          var tooltip = item.layer.getTooltip ? item.layer.getTooltip() : null;
          if (tooltip) {
            var tEl = tooltip.getElement ? tooltip.getElement() : null;
            if (tEl) tEl.classList.remove('inspector-tooltip-highlight', 'inspector-tooltip-damaged');
            if (itemData) item.layer.setTooltipContent('<b>' + itemData.name + '</b>');
            if (typeof item.layer.closeTooltip === 'function') item.layer.closeTooltip();
          }
        }
      }
    }
  }

  function animateWalk(timestamp) {
    if (!isInspectorActive) return;
    if (!lastTimestamp) lastTimestamp = timestamp;
    var deltaTimeSec = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    if (deltaTimeSec > 0.08) deltaTimeSec = 0.016;

    var avatarEl = document.getElementById('inspectorAvatarEl');
    var curLat, curLng;

    if (isOrbiting && currentOrbitTarget) {
      if (avatarEl) avatarEl.innerText = '🧐';
      orbitAngle += orbitAngularSpeed * deltaTimeSec;
      if (orbitAngle >= Math.PI * 2) { orbitAngle -= Math.PI * 2; orbitLapsCompleted++; }
      curLat = currentOrbitTarget.lat + (orbitRadiusMeters / 111320) * Math.cos(orbitAngle);
      curLng = currentOrbitTarget.lng + (orbitRadiusMeters / (111320 * Math.cos(currentOrbitTarget.lat * 0.01745))) * Math.sin(orbitAngle);
      if (orbitLapsCompleted >= 2) { isOrbiting = false; if (avatarEl) avatarEl.innerText = '👷‍♂️'; }
    } else {
      if (avatarEl && avatarEl.innerText !== '👷‍♂️') avatarEl.innerText = '👷‍♂️';
      var p1 = pathCoords[currentIdx], p2 = pathCoords[currentIdx + 1];
      var segmentDist = getQuickDistMeters(p1[0], p1[1], p2[0], p2[1]);
      progress += (segmentDist > 0) ? (walkSpeedMetersPerSec * deltaTimeSec) / segmentDist : 0.01;
      if (progress >= 1) {
        progress = 0; currentIdx++;
        if (currentIdx >= pathCoords.length - 1) currentIdx = 0;
        p1 = pathCoords[currentIdx]; p2 = pathCoords[currentIdx + 1];
      }
      if (avatarEl) avatarEl.style.transform = (p2[1] < p1[1]) ? 'scaleX(-1)' : 'scaleX(1)';
      curLat = p1[0] + (p2[0] - p1[0]) * progress;
      curLng = p1[1] + (p2[1] - p1[1]) * progress;
    }

    if (inspectorMarker) inspectorMarker.setLatLng([curLat, curLng]);
    checkProximityAndHighlight(curLat, curLng, timestamp);
    inspectorAnimationId = requestAnimationFrame(animateWalk);
  }

  inspectorAnimationId = requestAnimationFrame(animateWalk);
}

function stopInspectorAnimation() {
  isInspectorActive = false;
  if (inspectorAnimationId) { cancelAnimationFrame(inspectorAnimationId); inspectorAnimationId = null; }
  if (inspectorMarker) { map.removeLayer(inspectorMarker); inspectorMarker = null; }
  if (inspectorPathLine) { map.removeLayer(inspectorPathLine); inspectorPathLine = null; }

  var resetLayer = function(l) {
    var el = l.getElement ? l.getElement() : null;
    if (el) el.classList.remove('pin-highlight-active', 'pin-damaged-alert-active');
    var tooltip = l.getTooltip ? l.getTooltip() : null;
    if (tooltip) {
      var tEl = tooltip.getElement ? tooltip.getElement() : null;
      if (tEl) tEl.classList.remove('inspector-tooltip-highlight', 'inspector-tooltip-damaged');
      if (typeof l.closeTooltip === 'function') l.closeTooltip();
    }
  };
  if (markerClusterGroup) markerClusterGroup.eachLayer(resetLayer);
  if (existingLayerGroup) existingLayerGroup.eachLayer(resetLayer);

  var btn = document.getElementById('btnToggleSurveyor');
  if (btn) { btn.className = 'leaflet-custom-btn'; btn.innerHTML = '👷‍♂️ ช่างเดินสำรวจ: เริ่ม'; }
}

function focusOnFilteredFeatures(items, onCompleteCallback) {
  try {
    var group = new L.FeatureGroup();
    items.forEach(function(item) {
      if (item.type === 'แปลงพื้นที่' && item.boundary) {
        group.addLayer(L.geoJSON({ "type": "Feature", "geometry": { "type": "Polygon", "coordinates": item.boundary } }));
      } else if (item.lat && item.lng) {
        group.addLayer(L.marker([item.lat, item.lng]));
      }
    });

    if (group.getLayers().length > 0) {
      var bounds = group.getBounds();
      if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 19, duration: 1.2 });
        if (onCompleteCallback) setTimeout(onCompleteCallback, 1250);
      }
    }
  } catch(e) {}
}

function clearFilters() {
  stopInspectorAnimation();
  document.getElementById('filterDeptSelect').value = 'ALL';
  updateLocationFilterOptions();
  document.getElementById('filterLocationSelect').value = 'ALL';
  applyDataFilters(false);
  showToast('ล้างตัวกรองทั้งหมดแล้ว');
}

function exportFilteredData(type) {
  if (!currentFilteredPlots || currentFilteredPlots.length === 0) {
    showCustomerAlert('แจ้งเตือน', 'ไม่พบข้อมูลในเงื่อนไขตัวกรองสำหรับส่งออก', 'warning');
    return;
  }

  if (type === 'csv') {
    var csvContent = '\uFEFF';
    csvContent += 'ID,วันที่บันทึก,รหัสหน่วยงาน,ชื่อหน่วยงาน,ชื่อครุภัณฑ์,เลขทะเบียน,สถานที่,สถานะ,สีหมุด,ประเภท,ละติจูด,ลองจิจูด,รูปภาพ,QR Code\n';
    currentFilteredPlots.forEach(function(r) {
      var row = ['"' + (r.id || '') + '"', '"' + (r.timestamp || '') + '"', '"' + (r.deptCode || '') + '"', '"' + (r.deptName || '') + '"', '"' + (r.name || '').replace(/"/g, '""') + '"', '"' + (r.regNo || '').replace(/"/g, '""') + '"', '"' + (r.location || '').replace(/"/g, '""') + '"', '"' + (r.status || '') + '"', '"' + (r.pinColor || 'green') + '"', '"' + (r.type || '') + '"', r.lat || '', r.lng || '', '"' + (r.imageUrl || '') + '"', '"' + (r.qrUrl || '') + '"'];
      csvContent += row.join(',') + '\n';
    });
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'Asset_Records_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    showCustomerAlert('ส่งออกสำเร็จ', 'ดาวน์โหลดไฟล์ Excel (CSV) เรียบร้อยแล้ว', 'success');
  } else if (type === 'geojson') {
    var geojsonFeatures = [];
    currentFilteredPlots.forEach(function(r) {
      var geometry = (r.type === 'แปลงพื้นที่' && r.boundary) ? { type: 'Polygon', coordinates: r.boundary } : (r.lat && r.lng ? { type: 'Point', coordinates: [r.lng, r.lat] } : null);
      if (geometry) {
        geojsonFeatures.push({ type: 'Feature', geometry: geometry, properties: { id: r.id, name: r.name, regNo: r.regNo, location: r.location, deptName: r.deptName, status: r.status, pinColor: r.pinColor, imageUrl: r.imageUrl, qrUrl: r.qrUrl } });
      }
    });
    var blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: geojsonFeatures }, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'Asset_Spatial_' + new Date().toISOString().slice(0, 10) + '.geojson'; a.click();
    showCustomerAlert('ส่งออกสำเร็จ', 'ดาวน์โหลดไฟล์ GeoJSON เรียบร้อยแล้ว', 'success');
  }
}

function renderSavedOnMapAndList(data) {
  existingLayerGroup.clearLayers();
  markerClusterGroup.clearLayers();
  var listContainer = document.getElementById('recordsList');
  listContainer.innerHTML = '';
  document.getElementById('recordCount').innerText = '(พบ ' + data.length + ' รายการ)';

  if (!data || data.length === 0) {
    listContainer.innerHTML = '<p style="font-size:12px;color:#888;text-align:center;margin-top:15px;">ไม่พบรายการที่ตรงกับเงื่อนไขตัวกรอง</p>';
    return;
  }

  data.forEach(function(item) {
    var isNormal = (item.status === 'ปกติ');
    var pinColorKey = item.pinColor || (isNormal ? 'green' : 'red');
    var icon = createSvgIcon(pinColorKey, false);

    try {
      var geoLayer = null;
      if (item.type === 'แปลงพื้นที่' && item.boundary) {
        geoLayer = L.geoJSON({ "type": "Feature", "geometry": { "type": "Polygon", "coordinates": item.boundary } }, { style: { color: '#10b981', weight: 2.5, fillOpacity: 0.35 } });
        geoLayer.bindTooltip('<b>' + (item.name || 'แปลงพื้นที่') + '</b> (' + item.status + ')', { direction: 'center', sticky: true });
      } else if (item.lat && item.lng) {
        geoLayer = L.marker([item.lat, item.lng], { icon: icon });
        geoLayer.bindTooltip('<b>' + (item.name || 'ครุภัณฑ์') + '</b>', { direction: 'top', offset: [0, -36], permanent: false });
      }

      if (geoLayer) {
        var imgTag = item.imageUrl ? '<div class="popup-media-container"><a href="' + item.imageUrl + '" target="_blank"><img src="' + item.imageUrl + '" class="popup-media-img" /></a></div>' : '';
        var qrTag = item.qrUrl ? '<div style="margin-top:6px; font-size:11px; border-top: 1px dashed #e2e8f0; padding-top: 5px;"><b>📱 QR Code รายละเอียด:</b><br><a href="' + item.qrUrl + '" target="_blank"><img src="' + item.qrUrl + '" style="width:70px; height:70px; object-fit:contain; border-radius:6px; border:1px solid #ddd; margin-top:3px;" /></a></div>' : '';
        var navBtn = (item.lat && item.lng) ? '<a href="https://www.google.com/maps/dir/?api=1&destination=' + item.lat + ',' + item.lng + '" target="_blank" class="btn-nav-gmaps">🧭 นำทาง (Google Maps)</a>' : '';

        var actionBtns = '';
        if (currentSession && (currentSession.isAdmin || currentSession.deptCode === item.deptCode)) {
          actionBtns = '<div style="margin-top:8px; display:flex; gap:6px;">' +
            '<button onclick="startEditItem(\'' + item.id + '\')" style="flex:1; padding:6px 8px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">✏️ แก้ไข / เลื่อน</button>' +
            '<button onclick="deleteItemWithAnim(\'' + item.id + '\', this)" style="padding:6px 10px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">🗑️ ลบ</button>' +
          '</div>';
        }

        var popupContent = '<div class="popup-scroll-container" style="font-size:12.5px; line-height:1.5; min-width:210px; max-width:235px;">' +
          imgTag +
          '<b style="font-size:14px; color:#1a73e8;">' + item.name + '</b><br>' +
          '<b>สถานที่:</b> ' + (item.location || '-') + '<br>' +
          '<b>ทะเบียน:</b> ' + item.regNo + '<br>' +
          '<b>หน่วยงาน:</b> ' + item.deptName + '<br>' +
          '<b>พิกัด:</b> ' + (item.lat ? item.lat.toFixed(5) : '-') + ', ' + (item.lng ? item.lng.toFixed(5) : '-') + '<br>' +
          '<b>สถานะ:</b> <span style="font-weight:bold;">' + item.status + '</span><br>' +
          (item.type === 'แปลงพื้นที่' ? ('<b>พื้นที่:</b> ' + item.areaThai + '<br>') : '') +
          qrTag + navBtn + actionBtns + '</div>';

        geoLayer.bindPopup(popupContent, { autoClose: true, closeOnClick: false, autoPan: false });
        geoLayer.on('click', function(e) {
          if (e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
          var pos = (item.type === 'แปลงพื้นที่' && item.boundary) ? (function() { var c = turf.centroid({ "type": "Feature", "geometry": { "type": "Polygon", "coordinates": item.boundary } }); return L.latLng(c.geometry.coordinates[1], c.geometry.coordinates[0]); })() : (item.lat && item.lng ? L.latLng(item.lat, item.lng) : null);
          if (pos) {
            var p = map.latLngToContainerPoint(pos);
            map.panTo(map.containerPointToLatLng(L.point(p.x, p.y - 180)), { animate: true, duration: 0.35 });
          }
          map.closePopup();
          setTimeout(function() { geoLayer.openPopup(); }, 40);
        });

        geoLayer.options.featureId = item.id;
        if (item.type === 'แปลงพื้นที่') existingLayerGroup.addLayer(geoLayer);
        else markerClusterGroup.addLayer(geoLayer);
      }
    } catch(e) {}

    var thumbImg = item.imageUrl 
      ? '<img src="' + item.imageUrl + '" class="plot-thumb-3-4" onerror="this.src=\'data:image/svg+xml;utf8,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' width=\\\'54\\\' height=\\\'72\\\' fill=\\\'%23cbd5e1\\\' viewBox=\\\'0 0 24 24\\\'><path d=\\\'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z\\\'/></svg>\';" />' 
      : '<div class="plot-thumb-3-4" style="display:flex;align-items:center;justify-content:center;font-size:18px;color:#94a3b8;">📍</div>';

    var div = document.createElement('div');
    div.className = 'plot-item' + (isNormal ? '' : ' damaged');
    div.innerHTML = thumbImg + 
      '<div class="plot-info-wrap">' +
        '<div class="plot-name">' + item.name + ' <span style="font-size:11px; float:right;">● ' + item.status + '</span></div>' +
        '<div class="plot-sub">สถานที่: ' + item.location + ' | ทะเบียน: ' + item.regNo + '</div>' +
        '<div class="plot-sub">พิกัด: ' + (item.lat ? item.lat.toFixed(4) : '-') + ', ' + (item.lng ? item.lng.toFixed(4) : '-') + (item.type === 'แปลงพื้นที่' ? (' (' + item.areaThai + ')') : '') + '</div>' +
      '</div>';
    
    div.onclick = function() {
      if (window.innerWidth <= 768) toggleMobileSidebar(false);
      var targetLayer = null;
      markerClusterGroup.eachLayer(function(l) { if (l.options && String(l.options.featureId) === String(item.id)) targetLayer = l; });
      if (!targetLayer) existingLayerGroup.eachLayer(function(l) { if (l.options && String(l.options.featureId) === String(item.id)) targetLayer = l; });

      if (targetLayer) {
        map.closePopup();
        if (markerClusterGroup.hasLayer(targetLayer)) {
          markerClusterGroup.zoomToShowLayer(targetLayer, function() {
            var p = map.latLngToContainerPoint(targetLayer.getLatLng());
            map.panTo(map.containerPointToLatLng(L.point(p.x, p.y - 180)), { animate: true, duration: 0.35 });
            targetLayer.openPopup();
          });
        } else {
          var pos = targetLayer.getLatLng ? targetLayer.getLatLng() : targetLayer.getBounds().getCenter();
          map.setView(pos, 19);
          var p = map.latLngToContainerPoint(pos);
          map.panTo(map.containerPointToLatLng(L.point(p.x, p.y - 180)), { animate: true, duration: 0.35 });
          targetLayer.openPopup();
        }
      }
    };
    listContainer.appendChild(div);
  });
}

async function saveCurrentData() {
  if (!currentSession) {
    showCustomerAlert('แจ้งเตือน', 'กรุณาเข้าสู่ระบบก่อนบันทึกข้อมูล', 'warning', function() { openLoginModal(); });
    return;
  }
  if (!systemSettings.allowRecord && !currentSession.isAdmin) {
    showCustomerAlert('ระบบปิดรับข้อมูล', systemSettings.closedMessage, 'warning');
    return;
  }

  var name = document.getElementById('plotName').value.trim();
  if (!name) {
    showCustomerAlert('ข้อมูลไม่ครบถ้วน', 'กรุณากรอกชื่อครุภัณฑ์ / ทรัพย์สิน', 'warning');
    return;
  }
  if (!currentFeatureData) {
    showCustomerAlert('ยังไม่ได้ระบุพิกัด', 'กรุณากำหนดพิกัดบนแผนที่ก่อนบันทึก', 'warning');
    return;
  }

  var saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true; saveBtn.innerText = 'กำลังอัปโหลดและบันทึก...';

  var payload = {
    id: document.getElementById('editId').value || null,
    isEdit: Boolean(document.getElementById('editId').value),
    deptCode: document.getElementById('plotDept').value,
    name: name,
    pinColor: selectedPinColor,
    regNo: document.getElementById('plotRegNo').value.trim(),
    location: document.getElementById('plotLocation').value.trim(),
    imageBase64: selectedBase64Image,
    imageUrl: document.getElementById('currentExistingImageUrl').value,
    oldImageUrl: (selectedBase64Image && document.getElementById('currentExistingImageUrl').value) ? document.getElementById('currentExistingImageUrl').value : '',
    qrBase64: selectedBase64Qr,
    qrUrl: document.getElementById('currentExistingQrUrl').value,
    oldQrUrl: (selectedBase64Qr && document.getElementById('currentExistingQrUrl').value) ? document.getElementById('currentExistingQrUrl').value : '',
    status: document.querySelector('input[name="plotStatus"]:checked').value,
    type: currentFeatureData.type,
    lat: currentFeatureData.lat,
    lng: currentFeatureData.lng,
    boundary: currentFeatureData.boundary,
    areaSqm: currentFeatureData.areaSqm,
    areaThai: currentFeatureData.areaThai
  };

  try {
    const res = await callGasPost('savePlotData', { data: payload });
    showCustomerAlert('ผลการบันทึก', res.message, res.success ? 'success' : 'error');
    saveBtn.innerText = 'บันทึกข้อมูลลง Google Sheet';
    cancelEditMode();
    loadSavedData();
  } catch (err) {
    showCustomerAlert('บันทึกไม่สำเร็จ', err.toString(), 'error');
    saveBtn.disabled = false;
    saveBtn.innerText = 'บันทึกข้อมูลลง Google Sheet';
  }
}

function startEditItem(id) {
  map.closePopup();
  var item = allSavedPlots.find(function(x) { return String(x.id) === String(id); });
  if (!item) return;

  document.getElementById('editId').value = item.id;
  document.getElementById('formTitle').innerText = 'แก้ไข: ' + item.name;
  document.getElementById('plotName').value = item.name;
  document.getElementById('plotRegNo').value = item.regNo;
  document.getElementById('plotLocation').value = item.location;
  document.getElementById('plotDept').value = item.deptCode;
  
  selectPinColor(item.pinColor || 'green');

  document.getElementById('currentExistingImageUrl').value = item.imageUrl || '';
  if (item.imageUrl) {
    document.getElementById('photoPreviewImg').src = item.imageUrl;
    document.getElementById('photoPreviewWrap').style.display = 'block';
    document.getElementById('photoPlaceholderText').style.display = 'none';
  } else { removePhoto(null, 'photo'); }

  document.getElementById('currentExistingQrUrl').value = item.qrUrl || '';
  if (item.qrUrl) {
    document.getElementById('qrPreviewImg').src = item.qrUrl;
    document.getElementById('qrPreviewWrap').style.display = 'block';
    document.getElementById('photoPlaceholderText').style.display = 'none';
  } else { removePhoto(null, 'qr'); }

  var radios = document.getElementsByName('plotStatus');
  for (var i = 0; i < radios.length; i++) {
    if (radios[i].value === item.status) radios[i].checked = true;
  }

  currentFeatureData = { type: item.type, lat: item.lat, lng: item.lng, boundary: item.boundary, areaSqm: item.areaSqm, areaThai: item.areaThai };
  document.getElementById('prevLat').innerText = item.lat ? item.lat.toFixed(6) : '-';
  document.getElementById('prevLng').innerText = item.lng ? item.lng.toFixed(6) : '-';
  document.getElementById('coordPreviewBox').style.display = 'block';
  document.getElementById('areaPreviewText').innerText = (item.type === 'แปลงพื้นที่') ? ('ขนาดพื้นที่: ' + item.areaThai) : '';

  drawnItems.clearLayers();
  if (item.type === 'หมุดตำแหน่งครุภัณฑ์' && item.lat && item.lng) {
    var marker = L.marker([item.lat, item.lng], { icon: createSvgIcon(item.pinColor || 'green', true), draggable: true }).addTo(drawnItems);
    marker.on('dragend', function(e) {
      var pos = e.target.getLatLng();
      currentFeatureData.lat = pos.lat; currentFeatureData.lng = pos.lng;
      document.getElementById('prevLat').innerText = pos.lat.toFixed(6);
      document.getElementById('prevLng').innerText = pos.lng.toFixed(6);
      showToast('เลื่อนตำแหน่งไปยังพิกัดใหม่แล้ว');
    });
    map.flyTo([item.lat, item.lng], 20);
    document.getElementById('shapeStatus').innerText = 'สามารถคลิกลากย้ายหมุดได้';
  } else if (item.type === 'แปลงพื้นที่' && item.boundary) {
    var poly = L.geoJSON({ "type": "Feature", "geometry": { "type": "Polygon", "coordinates": item.boundary } }, { style: { color: '#f59e0b', weight: 3, fillOpacity: 0.4 } });
    poly.eachLayer(function(l) { drawnItems.addLayer(l); });
    map.fitBounds(poly.getBounds(), { padding: [50, 50], maxZoom: 20 });
    document.getElementById('shapeStatus').innerText = 'สามารถแก้ไขขอบเขตแปลงได้';
  }

  document.getElementById('saveBtn').disabled = (!systemSettings.allowRecord && !currentSession.isAdmin);
  document.getElementById('cancelEditBtn').style.display = 'block';
  toggleMobileSidebar(true);
  showToast('เปิดโหมดแก้ไขแล้ว');
}

function cancelEditMode() {
  document.getElementById('editId').value = '';
  document.getElementById('formTitle').innerText = 'ข้อมูลรายการใหม่';
  document.getElementById('plotName').value = '';
  document.getElementById('plotRegNo').value = '';
  document.getElementById('plotLocation').value = '';
  selectPinColor('green');
  document.getElementById('shapeStatus').innerText = 'ยังไม่ได้กำหนดพิกัด';
  document.getElementById('coordPreviewBox').style.display = 'none';
  document.getElementById('saveBtn').disabled = true;
  document.getElementById('cancelEditBtn').style.display = 'none';
  removePhoto(null, 'photo'); removePhoto(null, 'qr');
  drawnItems.clearLayers();
  currentFeatureData = null;
}

function deleteItemWithAnim(id, btnElement) {
  showCustomerAlert('ยืนยันการลบรายการ', 'ระบบจะลบข้อมูลออกจาก Google Sheet และลบรูปภาพใน Drive อย่างถาวร ยืนยันใช่หรือไม่?', 'confirm', async function(confirmed) {
    if (!confirmed) return;
    map.closePopup();
    showToast('กำลังถอนหมุดและลบข้อมูล...');
    try {
      const res = await callGasPost('deletePlotData', { id: id });
      showCustomerAlert('ลบสำเร็จ', res.message, 'success');
      cancelEditMode();
      loadSavedData();
    } catch (err) {
      showCustomerAlert('เกิดข้อผิดพลาด', err.toString(), 'error');
    }
  });
}

function searchLocation() {
  var query = document.getElementById('searchInput').value.trim();
  if (!query) return;
  document.getElementById('plotLocation').value = query;
  var url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query);
  fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(results) {
      if (results && results.length > 0) {
        var lat = parseFloat(results[0].lat), lon = parseFloat(results[0].lon);
        map.flyTo([lat, lon], 18);
        if (window.innerWidth <= 768) toggleMobileSidebar(false);
        showToast('📍 ระบุสถานที่: ' + query);
      } else {
        showToast('ระบุสถานที่: ' + query + ' (ไม่พบพิกัดบนแผนที่)');
      }
    }).catch(function() { showToast('ระบุสถานที่: ' + query); });
}

function locateUser(fly) {
  if (!navigator.geolocation) {
    showCustomerAlert('ไม่รองรับ GPS', 'อุปกรณ์ไม่รองรับ Location Service', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    gpsMarkerGroup.clearLayers();
    var mark = L.marker([lat, lng], { icon: createSvgIcon('blue', false) }).addTo(gpsMarkerGroup);
    mark.bindPopup('ตำแหน่ง GPS ปัจจุบันของคุณ').openPopup();
    if (fly) {
      map.flyTo([lat, lng], 19);
      if (window.innerWidth <= 768) toggleMobileSidebar(false);
    }
  }, function(err) {
    showCustomerAlert('ระบุตำแหน่งไม่สำเร็จ', 'กรุณาเปิด Location Service ในอุปกรณ์', 'error');
  }, { enableHighAccuracy: true });
}
