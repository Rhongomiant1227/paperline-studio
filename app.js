(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'paperline-studio-v1';
  const PRESETS = {
    a4: { name: 'A4', width: 210, height: 297, unit: 'mm' },
    a5: { name: 'A5', width: 148, height: 210, unit: 'mm' },
    a3: { name: 'A3', width: 297, height: 420, unit: 'mm' },
    letter: { name: 'US Letter', width: 8.5, height: 11, unit: 'in' },
    legal: { name: 'US Legal', width: 8.5, height: 14, unit: 'in' }
  };
  const UNIT_TO_PT = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1 };
  const DASH_MAP = { solid: [], dash: [3, 2], longdash: [7, 3], dot: [0.5, 1.8], dashdot: [5, 2, 0.5, 2] };
  const $ = (id) => document.getElementById(id);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fmt = (n, digits = 2) => Number(n.toFixed(digits)).toString();
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function defaultState() {
    return {
      version: 1,
      name: '未命名纸张',
      preset: 'a4', unit: 'mm', widthPt: 210 * UNIT_TO_PT.mm, heightPt: 297 * UNIT_TO_PT.mm,
      settings: { pattern: 'blank', spacingPt: 8 * UNIT_TO_PT.mm, majorEvery: 5, color: '#71846D', widthPt: 0.25 * UNIT_TO_PT.mm, opacity: 34, dash: 'solid', dashLengthPt: 3 * UNIT_TO_PT.mm, dashGapPt: 2 * UNIT_TO_PT.mm, paper: '#FFFFFF', marginPt: 0, cueWidth: 25, summaryHeight: 20 },
      pages: Array.from({ length: 3 }, () => ({ id: id(), elements: [] })), activePage: 0
    };
  }

  function normalizeState(s) {
    if (!s || !Array.isArray(s.pages) || !s.settings || !Number.isFinite(s.widthPt) || !Number.isFinite(s.heightPt)) throw new Error('项目文件格式不正确。');
    s.pages = s.pages.slice(0, 100).map((p) => ({ id: p.id || id(), elements: Array.isArray(p.elements) ? p.elements.filter((e) => ['line', 'table'].includes(e.type) && Number.isFinite(e.x1 ?? e.x)).map((e) => ({ ...e, id: e.id || id() })) : [] }));
    if (!s.pages.length) s.pages = [{ id: id(), elements: [] }];
    s.activePage = clamp(Number(s.activePage) || 0, 0, s.pages.length - 1);
    s.name = typeof s.name === 'string' ? s.name.slice(0, 64) : '未命名纸张';
    s.unit = UNIT_TO_PT[s.unit] ? s.unit : 'mm';
    s.preset = PRESETS[s.preset] ? s.preset : 'custom';
    const d = defaultState().settings;
    s.settings = { ...d, ...s.settings };
    s.settings.pattern = ['blank', 'ruled', 'graph', 'dots', 'iso', 'hex', 'isodots', 'cornell', 'music'].includes(s.settings.pattern) ? s.settings.pattern : 'blank';
    s.settings.dash = DASH_MAP[s.settings.dash] ? s.settings.dash : 'solid';
    s.settings.color = /^#[0-9a-f]{6}$/i.test(s.settings.color) ? s.settings.color : '#71846D';
    s.settings.paper = /^#[0-9a-f]{6}$/i.test(s.settings.paper) ? s.settings.paper : '#FFFFFF';
    s.settings.opacity = clamp(Number(s.settings.opacity) || 34, 5, 100);
    s.settings.marginPt = clamp(Number(s.settings.marginPt) || 0, 0, 40 * UNIT_TO_PT.mm);
    s.settings.cueWidth = clamp(Number(s.settings.cueWidth) || 25, 15, 40);
    s.settings.summaryHeight = clamp(Number(s.settings.summaryHeight) || 20, 10, 35);
    return s;
  }

  let state;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    state = saved ? normalizeState(JSON.parse(saved)) : defaultState();
  } catch { state = defaultState(); }
  let selectedId = null;
  let tool = 'select';
  let zoom = 1;
  let history = [];
  let redoHistory = [];
  let saveTimer;
  let toastTimer;
  let pointerAction = null;
  let cachedFit = 1;

  const stage = $('stage');
  const svg = $('paperSvg');
  const pageWrap = $('pageWrap');
  const activePage = () => state.pages[state.activePage];
  const currentUnitFactor = () => UNIT_TO_PT[state.unit] || UNIT_TO_PT.mm;

  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
  }

  function persist() {
    $('saveState').innerHTML = '<span class="save-dot"></span>保存中';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); $('saveState').innerHTML = '<span class="save-dot"></span>已自动保存'; }
      catch { $('saveState').innerHTML = '<span class="save-dot"></span>仅本次会话'; }
    }, 180);
  }

  function snapshot() { return JSON.stringify({ pages: state.pages, activePage: state.activePage }); }
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 50) history.shift();
    redoHistory = [];
    updateUndoButtons();
  }
  function applyHistory(snapshotValue) {
    const data = JSON.parse(snapshotValue);
    state.pages = data.pages;
    state.activePage = clamp(data.activePage, 0, state.pages.length - 1);
    selectedId = null;
    persist();
    renderAll();
  }
  function undo() {
    if (!history.length) return;
    redoHistory.push(snapshot());
    applyHistory(history.pop());
  }
  function redo() {
    if (!redoHistory.length) return;
    history.push(snapshot());
    applyHistory(redoHistory.pop());
  }
  function updateUndoButtons() {
    $('undoBtn').disabled = history.length === 0;
    $('undoTopBtn').disabled = history.length === 0;
    $('redoBtn').disabled = redoHistory.length === 0;
    $('deleteBtn').disabled = !selectedId;
  }

  function escapeXML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]); }
  function svgNode(name, attrs = {}) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    return node;
  }
  function colorHex(hex) { return hex.slice(1).match(/.{2}/g).map(v => parseInt(v, 16) / 255); }
  function dashArray(s) {
    if (s.dash === 'solid') return '';
    const a = s.dashLengthPt, b = s.dashGapPt;
    if (s.dash === 'dash') return `${fmt(a)} ${fmt(b)}`;
    if (s.dash === 'longdash') return `${fmt(a * 2.4)} ${fmt(b)}`;
    if (s.dash === 'dot') return `${fmt(Math.max(0.45, s.widthPt * 0.65))} ${fmt(b)}`;
    return `${fmt(a * 1.8)} ${fmt(b)} ${fmt(Math.max(0.45, s.widthPt * 0.65))} ${fmt(b)}`;
  }
  function unitToPoints(n) { return Number(n) * currentUnitFactor(); }
  function pointsToUnit(n, unit = state.unit) { return n / (UNIT_TO_PT[unit] || UNIT_TO_PT.mm); }

  function getPatternPrimitives(w, h, s) {
    const lines = [], dots = [];
    if (s.pattern === 'blank') return { lines, dots };
    const step = Math.max(2, s.spacingPt);
    const majorEvery = Number(s.majorEvery) || 0;
    const addLine = (x1, y1, x2, y2, major = false) => { if (lines.length < 4200) lines.push({ x1, y1, x2, y2, major }); };
    const isMajor = (n) => majorEvery > 0 && n > 0 && n % majorEvery === 0;
    if (s.pattern === 'ruled' || s.pattern === 'graph') {
      const horizontal = Math.ceil(h / step) + 1;
      for (let i = 0; i <= horizontal && i < 4201; i++) addLine(0, i * step, w, i * step, isMajor(i));
      if (s.pattern === 'graph') {
        const vertical = Math.ceil(w / step) + 1;
        for (let i = 0; i <= vertical && i < 4201; i++) addLine(i * step, 0, i * step, h, isMajor(i));
      }
    } else if (s.pattern === 'dots') {
      const nx = Math.floor(w / step), ny = Math.floor(h / step);
      const cols = Math.min(nx, 300), rows = Math.min(ny, 300);
      const xOffset = Math.max(0, (w - cols * step) / 2), yOffset = Math.max(0, (h - rows * step) / 2);
      for (let r = 1; r < rows && dots.length < 8000; r++) for (let c = 1; c < cols && dots.length < 8000; c++) dots.push({ x: xOffset + c * step, y: yOffset + r * step, major: isMajor(c) && isMajor(r) });
    } else if (s.pattern === 'isodots') {
      const rowStep = step * Math.sqrt(3) / 2;
      const cols = Math.min(Math.floor(w / step), 300), rows = Math.min(Math.floor(h / rowStep), 300);
      const xOffset = Math.max(0, (w - cols * step) / 2), yOffset = Math.max(0, (h - rows * rowStep) / 2);
      for (let r = 0; r < rows && dots.length < 8000; r++) {
        const stagger = r % 2 ? step / 2 : 0;
        for (let c = 0; c < cols && dots.length < 8000; c++) dots.push({ x: xOffset + c * step + stagger, y: yOffset + r * rowStep, major: isMajor(c) && isMajor(r) });
      }
    } else if (s.pattern === 'iso') {
      for (const deg of [0, 60, 120]) {
        const t = deg * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t), nx = -dy, ny = dx;
        const reach = w * Math.abs(nx) + h * Math.abs(ny);
        const count = Math.ceil(reach / (step * Math.sqrt(3) / 2));
        for (let i = -count; i <= count && lines.length < 4200; i++) {
          const clipped = clipInfiniteLine(nx * i * step * Math.sqrt(3) / 2, 0, dx, dy, w, h);
          if (clipped) addLine(...clipped, isMajor(Math.abs(i)));
        }
      }
    } else if (s.pattern === 'hex') {
      const side = step * 0.62, rowStep = Math.sqrt(3) * side, colStep = 1.5 * side;
      const cols = Math.ceil(w / colStep) + 3, rows = Math.ceil(h / rowStep) + 3;
      const edgeSet = new Set();
      for (let c = -1; c < cols && lines.length < 4200; c++) for (let r = -1; r < rows && lines.length < 4200; r++) {
        const cx = c * colStep, cy = r * rowStep + (c & 1 ? rowStep / 2 : 0);
        const pts = Array.from({ length: 6 }, (_, k) => [cx + side * Math.cos(k * Math.PI / 3), cy + side * Math.sin(k * Math.PI / 3)]);
        for (let k = 0; k < 6 && lines.length < 4200; k++) {
          const a = pts[k], b = pts[(k + 1) % 6];
          const key = [a[0], a[1], b[0], b[1]].map(n => Math.round(n * 100) / 100).join(',');
          const rev = [b[0], b[1], a[0], a[1]].map(n => Math.round(n * 100) / 100).join(',');
          if (edgeSet.has(key) || edgeSet.has(rev)) continue;
          edgeSet.add(key);
          addLine(a[0], a[1], b[0], b[1], majorEvery > 0 && Math.abs(c) % majorEvery === 0);
        }
      }
    } else if (s.pattern === 'cornell') {
      const cueX = w * s.cueWidth / 100, summaryY = h * (1 - s.summaryHeight / 100);
      const count = Math.ceil(summaryY / step);
      for (let i = 1; i <= count && lines.length < 4200; i++) {
        const y = i * step;
        if (y < summaryY) addLine(0, y, w, y, isMajor(i));
      }
      addLine(cueX, 0, cueX, summaryY, true);
      addLine(0, summaryY, w, summaryY, true);
    } else if (s.pattern === 'music') {
      const staffStep = step * 8, groups = Math.ceil(h / staffStep);
      for (let group = 0; group < groups && lines.length < 4200; group++) {
        for (let line = 0; line < 5 && lines.length < 4200; line++) {
          const y = group * staffStep + line * step;
          if (y <= h) addLine(0, y, w, y, line === 4);
        }
      }
    }
    return { lines, dots };
  }

  function clipInfiniteLine(cx, cy, dx, dy, w, h) {
    const pts = [];
    const add = (x, y) => {
      if (x >= -0.01 && x <= w + 0.01 && y >= -0.01 && y <= h + 0.01 && !pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 0.05)) pts.push([clamp(x, 0, w), clamp(y, 0, h)]);
    };
    if (Math.abs(dx) > 1e-8) { let t = (0 - cx) / dx; add(0, cy + t * dy); t = (w - cx) / dx; add(w, cy + t * dy); }
    if (Math.abs(dy) > 1e-8) { let t = (0 - cy) / dy; add(cx + t * dx, 0); t = (h - cy) / dy; add(cx + t * dx, h); }
    return pts.length > 1 ? [...pts[0], ...pts[1]] : null;
  }

  function objectStrokeAttrs(s, multiplier = 1) {
    const d = dashArray(s);
    return { fill: 'none', stroke: s.color, 'stroke-width': fmt(s.widthPt * multiplier), 'stroke-opacity': fmt(s.opacity / 100, 3), 'stroke-dasharray': d || null, 'stroke-linecap': s.dash === 'dot' ? 'round' : 'butt', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
  }

  function renderPageSvg(targetSvg, page, small = false) {
    const w = state.widthPt, h = state.heightPt, s = state.settings;
    const clipId = `pattern-clip-${id()}`;
    targetSvg.setAttribute('viewBox', `0 0 ${fmt(w)} ${fmt(h)}`);
    targetSvg.setAttribute('preserveAspectRatio', 'none');
    if (!small) { targetSvg.setAttribute('width', fmt(w)); targetSvg.setAttribute('height', fmt(h)); }
    targetSvg.replaceChildren();
    targetSvg.appendChild(svgNode('rect', { x: 0, y: 0, width: w, height: h, fill: s.paper }));
    const miniSettings = small ? { ...s, spacingPt: s.spacingPt * 8, widthPt: 1.1, opacity: Math.max(35, s.opacity), dash: 'solid' } : s;
    const inset = clamp(miniSettings.marginPt || 0, 0, Math.max(0, Math.min(w, h) / 2 - 1));
    const innerW = Math.max(1, w - inset * 2), innerH = Math.max(1, h - inset * 2);
    const { lines, dots } = getPatternPrimitives(innerW, innerH, miniSettings);
    const patternGroup = svgNode('g', { 'clip-path': `url(#${clipId})`, transform: `translate(${fmt(inset)} ${fmt(inset)})` });
    const defs = svgNode('defs');
    const clip = svgNode('clipPath', { id: clipId });
    clip.appendChild(svgNode('rect', { x: 0, y: 0, width: innerW, height: innerH }));
    defs.appendChild(clip); targetSvg.appendChild(defs);
    for (const l of lines) patternGroup.appendChild(svgNode('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, ...objectStrokeAttrs(miniSettings, l.major ? 1.75 : 1) }));
    for (const d of dots) patternGroup.appendChild(svgNode('circle', { cx: d.x, cy: d.y, r: d.major ? Math.max(1, miniSettings.widthPt * 2) : Math.max(0.65, miniSettings.widthPt * 1.1), fill: s.color, 'fill-opacity': fmt(miniSettings.opacity / 100, 3) }));
    targetSvg.appendChild(patternGroup);

    for (const el of page.elements) {
      const group = svgNode('g', { 'data-element': 'true', 'data-id': el.id, class: selectedId === el.id && !small ? 'selected-element' : null });
      if (el.type === 'line') {
        group.appendChild(svgNode('line', { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, ...objectStrokeAttrs(s) }));
      } else if (el.type === 'table') {
        const rowH = el.h / el.rows, colW = el.w / el.cols;
        group.appendChild(svgNode('rect', { x: el.x, y: el.y, width: el.w, height: el.h, fill: 'transparent', 'pointer-events': 'all', ...objectStrokeAttrs(s) }));
        for (let r = 1; r < el.rows; r++) group.appendChild(svgNode('line', { x1: el.x, y1: el.y + r * rowH, x2: el.x + el.w, y2: el.y + r * rowH, ...objectStrokeAttrs(s) }));
        for (let c = 1; c < el.cols; c++) group.appendChild(svgNode('line', { x1: el.x + c * colW, y1: el.y, x2: el.x + c * colW, y2: el.y + el.h, ...objectStrokeAttrs(s) }));
        if (selectedId === el.id && !small) group.appendChild(svgNode('rect', { x: el.x - 3, y: el.y - 3, width: el.w + 6, height: el.h + 6, fill: 'none', stroke: '#617b60', 'stroke-width': 1.2, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
      }
      targetSvg.appendChild(group);
    }
    if (pointerAction?.type === 'line' && !small) targetSvg.appendChild(svgNode('line', { class: 'draw-preview', x1: pointerAction.start.x, y1: pointerAction.start.y, x2: pointerAction.end.x, y2: pointerAction.end.y, ...objectStrokeAttrs(s), opacity: '.65', 'pointer-events': 'none' }));
  }

  function updateFit() {
    const w = state.widthPt, h = state.heightPt;
    const usableW = Math.max(120, stage.clientWidth - (innerWidth <= 760 ? 42 : 112));
    const usableH = Math.max(120, stage.clientHeight - (innerWidth <= 760 ? 100 : 120));
    cachedFit = Math.min(usableW / w, usableH / h, 1.6);
    const displayWidth = Math.max(35, w * cachedFit * zoom);
    pageWrap.style.width = `${displayWidth}px`;
    pageWrap.style.aspectRatio = `${w} / ${h}`;
    pageWrap.style.backgroundColor = state.settings.paper;
    $('zoomFitBtn').textContent = `${Math.round(zoom * 100)}%`;
  }

  function renderThumbnails() {
    const strip = $('pageThumbnails');
    strip.replaceChildren();
    state.pages.forEach((page, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `thumbnail${index === state.activePage ? ' active' : ''}`;
      button.setAttribute('aria-label', `第 ${index + 1} 页${index === state.activePage ? '，当前页' : ''}`);
      button.setAttribute('aria-current', index === state.activePage ? 'page' : 'false');
      const mini = svgNode('svg');
      renderPageSvg(mini, page, true);
      button.appendChild(mini);
      const number = document.createElement('span'); number.className = 'thumbnail-number'; number.textContent = String(index + 1).padStart(2, '0'); button.appendChild(number);
      button.addEventListener('click', () => { state.activePage = index; selectedId = null; renderAll(); persist(); });
      strip.appendChild(button);
    });
    const active = strip.querySelector('.thumbnail.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderAll(options = {}) {
    renderPageSvg(svg, activePage());
    updateFit();
    renderThumbnails();
    $('pageCounter').innerHTML = `${String(state.activePage + 1).padStart(2, '0')} <i>/</i> ${String(state.pages.length).padStart(2, '0')}`;
    $('pageCount').value = state.pages.length;
    $('docName').value = state.name;
    updateLabels(options.preserveDimension);
    updateUndoButtons();
    updateToolUI();
  }

  function updateLabels(preserveDimension = null) {
    const u = state.unit, factor = currentUnitFactor();
    $('unit').value = u;
    if (preserveDimension !== 'pageWidth') $('pageWidth').value = fmt(state.widthPt / factor, u === 'pt' ? 0 : 1);
    if (preserveDimension !== 'pageHeight') $('pageHeight').value = fmt(state.heightPt / factor, u === 'pt' ? 0 : 1);
    $('spacing').value = fmt(state.settings.spacingPt / factor, 1);
    $('spacingUnit').textContent = u;
    $('lineWidth').value = fmt(state.settings.widthPt / UNIT_TO_PT.mm, 2);
    $('lineWidthValue').textContent = `${fmt(state.settings.widthPt / UNIT_TO_PT.mm, 2)} mm`;
    $('opacity').value = state.settings.opacity;
    $('opacityValue').textContent = `${state.settings.opacity}%`;
    $('lineColor').value = state.settings.color;
    $('lineColorValue').textContent = state.settings.color.toUpperCase();
    $('paperColor').value = state.settings.paper;
    $('paperColorValue').textContent = state.settings.paper.toUpperCase();
    $('dashStyle').value = state.settings.dash;
    const dashDigits = { mm: 1, cm: 2, in: 3, pt: 1 }[u];
    const dashLength = fmt(state.settings.dashLengthPt / factor, dashDigits);
    const dashGap = fmt(state.settings.dashGapPt / factor, dashDigits);
    $('dashLength').value = fmt(state.settings.dashLengthPt / UNIT_TO_PT.mm, 1);
    $('dashGap').value = fmt(state.settings.dashGapPt / UNIT_TO_PT.mm, 1);
    $('dashLengthValue').textContent = `${dashLength} ${u}`;
    $('dashGapValue').textContent = `${dashGap} ${u}`;
    $('dashLength').setAttribute('aria-valuetext', `${dashLength} ${u}`);
    $('dashGap').setAttribute('aria-valuetext', `${dashGap} ${u}`);
    $('majorEvery').value = String(state.settings.majorEvery);
    $('margin').value = String(Math.round(state.settings.marginPt / UNIT_TO_PT.mm));
    $('marginValue').textContent = `${Math.round(state.settings.marginPt / UNIT_TO_PT.mm)} mm`;
    $('cueWidth').value = state.settings.cueWidth;
    $('cueWidthValue').textContent = `${state.settings.cueWidth}%`;
    $('summaryHeight').value = state.settings.summaryHeight;
    $('summaryHeightValue').textContent = `${state.settings.summaryHeight}%`;
    $('cornellSettings').hidden = state.settings.pattern !== 'cornell';
    $('spacingRow').hidden = state.settings.pattern === 'blank';
    $('majorRow').hidden = state.settings.pattern === 'blank' || state.settings.pattern === 'music';
    $('spacingLabel').textContent = state.settings.pattern === 'music' ? '五线间距' : '网格间距';
    const descriptions = {
      blank: '干净留白，适合自由书写或后续绘图。',
      ruled: '常规横线纸；可调整行距与强调线周期。',
      graph: '方格纸；适合坐标、草图与精确记录。',
      dots: '点阵笔记纸；低干扰地辅助对齐与排版。',
      iso: '三向等距网格；适合立体草图与空间绘制。',
      hex: '蜂窝六边形网格；适合结构和分区草图。',
      isodots: '三角排列点阵；保留等距绘图的定位辅助。',
      cornell: '康奈尔笔记版式；可调提示栏和底部总结区。',
      music: '每组五条谱线；用“五线间距”调整谱线密度。'
    };
    $('patternDescription').textContent = descriptions[state.settings.pattern] || '';
    const presetLabel = state.preset === 'custom' ? '自定义' : PRESETS[state.preset].name;
    $('pageSizeLabel').textContent = `${presetLabel} · ${fmt(state.widthPt / factor, 1)} × ${fmt(state.heightPt / factor, 1)} ${u}`;
    $('preset').value = state.preset;
    $('portraitBtn').classList.toggle('active', state.heightPt >= state.widthPt);
    $('portraitBtn').setAttribute('aria-pressed', String(state.heightPt >= state.widthPt));
    $('landscapeBtn').classList.toggle('active', state.widthPt > state.heightPt);
    $('landscapeBtn').setAttribute('aria-pressed', String(state.widthPt > state.heightPt));
    document.querySelectorAll('.pattern-card').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pattern === state.settings.pattern)));
  }

  function updateToolUI() {
    document.querySelectorAll('.tool-button').forEach(b => { const active = b.dataset.tool === tool; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    $('tableSettings').hidden = tool !== 'table';
    const needsHint = tool === 'line' || tool === 'table';
    $('stageHint').hidden = !needsHint;
    $('stageHintText').textContent = tool === 'line' ? '按住并拖动绘制线条' : '点击画布放置表格';
    stage.style.cursor = tool === 'line' ? 'crosshair' : tool === 'table' ? 'copy' : 'default';
    updateUndoButtons();
  }

  function setTool(next) { tool = next; updateToolUI(); }
  function fitUnitsToInputs() {
    $('pageWidth').value = fmt(pointsToUnit(state.widthPt), 1);
    $('pageHeight').value = fmt(pointsToUnit(state.heightPt), 1);
  }
  function setPreset(key) {
    const preset = PRESETS[key]; if (!preset) return;
    state.preset = key; state.unit = preset.unit;
    state.widthPt = preset.width * UNIT_TO_PT[preset.unit]; state.heightPt = preset.height * UNIT_TO_PT[preset.unit];
    if (state.widthPt > state.heightPt) [state.widthPt, state.heightPt] = [state.heightPt, state.widthPt];
    $('unit').value = state.unit;
    renderAll(); persist();
  }
  function changeCustomDimensions(event) {
    const w = Number($('pageWidth').value), h = Number($('pageHeight').value);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    state.preset = 'custom';
    const factor = currentUnitFactor();
    const min = event?.type === 'input' ? 1 : 25;
    state.widthPt = clamp(w, min, 1600) * factor;
    state.heightPt = clamp(h, min, 1600) * factor;
    renderAll({ preserveDimension: event?.type === 'input' ? event.target.id : null });
    persist();
  }
  function setOrientation(landscape) {
    const currently = state.widthPt > state.heightPt;
    if (currently !== landscape) [state.widthPt, state.heightPt] = [state.heightPt, state.widthPt];
    if (state.preset !== 'custom') {
      const p = PRESETS[state.preset];
      const normalW = p.width * UNIT_TO_PT[p.unit]; const normalH = p.height * UNIT_TO_PT[p.unit];
      const wantsLandscape = landscape;
      const w = Math.min(normalW, normalH), h = Math.max(normalW, normalH);
      state.widthPt = wantsLandscape ? h : w; state.heightPt = wantsLandscape ? w : h;
    }
    renderAll(); persist();
  }

  function setPageCount(count) {
    const n = clamp(Math.round(Number(count) || 1), 1, 100);
    if (n === state.pages.length) { $('pageCount').value = n; return; }
    pushHistory();
    if (n < state.pages.length) state.pages = state.pages.slice(0, n);
    while (state.pages.length < n) state.pages.push({ id: id(), elements: [] });
    state.activePage = clamp(state.activePage, 0, n - 1); selectedId = null;
    renderAll(); persist();
  }

  function svgPoint(event) {
    const rect = svg.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width * state.widthPt, 0, state.widthPt), y: clamp((event.clientY - rect.top) / rect.height * state.heightPt, 0, state.heightPt) };
  }

  function objectById(objectId) { return activePage().elements.find(e => e.id === objectId); }
  function deleteSelected() {
    if (!selectedId) return;
    const page = activePage();
    if (!page.elements.some(e => e.id === selectedId)) return;
    pushHistory(); page.elements = page.elements.filter(e => e.id !== selectedId); selectedId = null;
    renderAll(); persist(); showToast('已删除选中元素');
  }

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const objNode = event.target.closest('[data-element="true"]');
    const point = svgPoint(event);
    if (tool === 'line') {
      event.preventDefault(); svg.setPointerCapture(event.pointerId);
      pointerAction = { type: 'line', pointerId: event.pointerId, start: point, end: point };
      renderPageSvg(svg, activePage()); return;
    }
    if (tool === 'table') {
      if (objNode) return;
      const cols = clamp(Math.round(Number($('tableCols').value) || 1), 1, 20);
      const rows = clamp(Math.round(Number($('tableRows').value) || 1), 1, 40);
      const width = (Number($('tableWidth').value) || 120) * UNIT_TO_PT.mm;
      const rowHeight = 12 * UNIT_TO_PT.mm;
      const w = Math.min(width, state.widthPt - 4), h = Math.min(rows * rowHeight, state.heightPt - 4);
      const x = clamp(point.x - w / 2, 2, Math.max(2, state.widthPt - w - 2));
      const y = clamp(point.y - h / 2, 2, Math.max(2, state.heightPt - h - 2));
      pushHistory();
      const table = { id: id(), type: 'table', x, y, w, h, rows, cols };
      activePage().elements.push(table); selectedId = table.id; setTool('select'); renderAll(); persist(); showToast('表格已放置，可拖动调整位置'); return;
    }
    if (objNode) {
      const objectId = objNode.getAttribute('data-id');
      const object = objectById(objectId);
      selectedId = objectId;
      if (object?.type === 'table') {
        pointerAction = { type: 'move', pointerId: event.pointerId, id: objectId, start: point, originX: object.x, originY: object.y, changed: false };
        svg.setPointerCapture(event.pointerId);
      } else pointerAction = { type: 'select', pointerId: event.pointerId };
      event.preventDefault(); return;
    }
    selectedId = null;
    renderAll();
  });

  svg.addEventListener('pointermove', (event) => {
    if (!pointerAction || pointerAction.pointerId !== event.pointerId) return;
    const point = svgPoint(event);
    if (pointerAction.type === 'line') {
      pointerAction.end = point;
      const preview = svg.querySelector('.draw-preview');
      if (preview) { preview.setAttribute('x2', point.x); preview.setAttribute('y2', point.y); }
      else renderPageSvg(svg, activePage());
    } else if (pointerAction.type === 'move') {
      const el = objectById(pointerAction.id); if (!el) return;
      const dx = point.x - pointerAction.start.x, dy = point.y - pointerAction.start.y;
      if (!pointerAction.changed && Math.hypot(dx, dy) > 0.8) { pushHistory(); pointerAction.changed = true; }
      el.x = clamp(pointerAction.originX + dx, 0, Math.max(0, state.widthPt - el.w));
      el.y = clamp(pointerAction.originY + dy, 0, Math.max(0, state.heightPt - el.h));
      renderPageSvg(svg, activePage());
    }
  });

  function finishPointer(event) {
    if (!pointerAction || pointerAction.pointerId !== event.pointerId) return;
    const action = pointerAction; pointerAction = null;
    if (action.type === 'line') {
      const end = svgPoint(event);
      if (Math.hypot(end.x - action.start.x, end.y - action.start.y) >= 2) {
        pushHistory(); activePage().elements.push({ id: id(), type: 'line', x1: action.start.x, y1: action.start.y, x2: end.x, y2: end.y });
        selectedId = activePage().elements.at(-1).id; persist(); showToast('线条已添加');
      }
    }
    if (action.type === 'move' && action.changed) { persist(); showToast('位置已更新'); }
    renderAll();
  }
  svg.addEventListener('pointerup', finishPointer);
  svg.addEventListener('pointercancel', finishPointer);

  function updateSettingsFromControls() {
    const s = state.settings, f = currentUnitFactor();
    s.spacingPt = clamp(Number($('spacing').value) || 8, 0.5, 1000) * f;
    s.majorEvery = Number($('majorEvery').value);
    s.color = $('lineColor').value.toUpperCase();
    s.widthPt = clamp(Number($('lineWidth').value) || 0.25, 0.05, 2) * UNIT_TO_PT.mm;
    s.opacity = Number($('opacity').value);
    s.dash = $('dashStyle').value;
    s.dashLengthPt = clamp(Number($('dashLength').value) || 3, 0.2, 50) * UNIT_TO_PT.mm;
    s.dashGapPt = clamp(Number($('dashGap').value) || 2, 0.2, 50) * UNIT_TO_PT.mm;
    s.paper = $('paperColor').value.toUpperCase();
    s.marginPt = clamp(Number($('margin').value) || 0, 0, 40) * UNIT_TO_PT.mm;
    s.cueWidth = clamp(Number($('cueWidth').value) || 25, 15, 40);
    s.summaryHeight = clamp(Number($('summaryHeight').value) || 20, 10, 35);
    updateLabels(); renderPageSvg(svg, activePage()); renderThumbnails(); updateFit(); persist();
  }

  function applyRecipe(recipe) {
    const recipes = {
      journal: { pattern: 'dots', spacingMm: 5, color: '#879784', widthMm: 0.18, opacity: 30, dash: 'solid' },
      draft: { pattern: 'graph', spacingMm: 5, color: '#7386A1', widthMm: 0.2, opacity: 36, dash: 'solid' },
      study: { pattern: 'cornell', spacingMm: 7, color: '#748675', widthMm: 0.22, opacity: 42, dash: 'solid', cueWidth: 25, summaryHeight: 20 },
      score: { pattern: 'music', spacingMm: 2, color: '#697D70', widthMm: 0.2, opacity: 62, dash: 'solid' }
    };
    const recipeSettings = recipes[recipe];
    if (!recipeSettings) return;
    Object.assign(state.settings, recipeSettings, {
      spacingPt: recipeSettings.spacingMm * UNIT_TO_PT.mm,
      widthPt: recipeSettings.widthMm * UNIT_TO_PT.mm
    });
    delete state.settings.spacingMm;
    delete state.settings.widthMm;
    renderAll(); persist();
    showToast('纸张配方已应用');
  }

  function pdfNum(n) { return fmt(n, 3); }
  function pdfStrokeColor(hex) { const [r, g, b] = colorHex(hex); return `${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)} RG`; }
  function pdfFillColor(hex) { const [r, g, b] = colorHex(hex); return `${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)} rg`; }
  function pdfLine(x1, y1, x2, y2, h, width, dash, dashPhase = 0) {
    return `${pdfNum(width)} w\n${dash.length ? `[${dash.map(pdfNum).join(' ')}] ${pdfNum(dashPhase)} d` : '[] 0 d'}\n${pdfNum(x1)} ${pdfNum(h - y1)} m ${pdfNum(x2)} ${pdfNum(h - y2)} l S\n`;
  }
  function pdfCircle(x, y, r, h) {
    const cy = h - y, k = r * 0.5522847498;
    return `${pdfNum(x + r)} ${pdfNum(cy)} m ${pdfNum(x + r)} ${pdfNum(cy + k)} ${pdfNum(x + k)} ${pdfNum(cy + r)} ${pdfNum(x)} ${pdfNum(cy + r)} c ${pdfNum(x - k)} ${pdfNum(cy + r)} ${pdfNum(x - r)} ${pdfNum(cy + k)} ${pdfNum(x - r)} ${pdfNum(cy)} c ${pdfNum(x - r)} ${pdfNum(cy - k)} ${pdfNum(x - k)} ${pdfNum(cy - r)} ${pdfNum(x)} ${pdfNum(cy - r)} c ${pdfNum(x + k)} ${pdfNum(cy - r)} ${pdfNum(x + r)} ${pdfNum(cy - k)} ${pdfNum(x + r)} ${pdfNum(cy)} c f\n`;
  }
  function pdfPageContent(page, w, h, gsName) {
    const s = state.settings, inset = clamp(s.marginPt || 0, 0, Math.max(0, Math.min(w, h) / 2 - 1)), innerW = Math.max(1, w - inset * 2), innerH = Math.max(1, h - inset * 2), { lines, dots } = getPatternPrimitives(innerW, innerH, s), out = ['q', `0 0 ${pdfNum(w)} ${pdfNum(h)} re W n`, pdfFillColor(s.paper), `0 0 ${pdfNum(w)} ${pdfNum(h)} re f`, pdfStrokeColor(s.color), `${gsName ? `/${gsName} gs` : ''}`, '1 J 1 j'];
    const dash = s.dash === 'solid' ? [] : s.dash === 'dot' ? [Math.max(0.45, s.widthPt * .65), s.dashGapPt] : s.dash === 'longdash' ? [s.dashLengthPt * 2.4, s.dashGapPt] : s.dash === 'dashdot' ? [s.dashLengthPt * 1.8, s.dashGapPt, Math.max(0.45, s.widthPt * .65), s.dashGapPt] : [s.dashLengthPt, s.dashGapPt];
    for (const l of lines) out.push(pdfLine(l.x1 + inset, l.y1 + inset, l.x2 + inset, l.y2 + inset, h, s.widthPt * (l.major ? 1.75 : 1), dash));
    if (dots.length) { out.push(pdfFillColor(s.color)); for (const d of dots) out.push(pdfCircle(d.x + inset, d.y + inset, d.major ? Math.max(1, s.widthPt * 2) : Math.max(.65, s.widthPt * 1.1), h)); }
    for (const el of page.elements) {
      if (el.type === 'line') out.push(pdfLine(el.x1, el.y1, el.x2, el.y2, h, s.widthPt, dash));
      else if (el.type === 'table') {
        const rh = el.h / el.rows, cw = el.w / el.cols;
        out.push(`${pdfNum(s.widthPt)} w\n${dash.length ? `[${dash.map(pdfNum).join(' ')}] 0 d\n` : '[] 0 d\n'}`);
        out.push(`${pdfNum(el.x)} ${pdfNum(h - el.y - el.h)} ${pdfNum(el.w)} ${pdfNum(el.h)} re S\n`);
        for (let r = 1; r < el.rows; r++) out.push(pdfLine(el.x, el.y + r * rh, el.x + el.w, el.y + r * rh, h, s.widthPt, dash));
        for (let c = 1; c < el.cols; c++) out.push(pdfLine(el.x + c * cw, el.y, el.x + c * cw, el.y + el.h, h, s.widthPt, dash));
      }
    }
    out.push('Q'); return out.join('\n');
  }
  function buildPdf() {
    const pages = state.pages, alpha = state.settings.opacity / 100;
    const pageStart = 3, pageObjectIds = pages.map((_, i) => pageStart + i * 2), gsId = alpha < 0.999 ? pageStart + pages.length * 2 : null;
    const objects = [];
    const put = (num, body) => { objects[num] = `${num} 0 obj\n${body}\nendobj\n`; };
    put(1, '<< /Type /Catalog /Pages 2 0 R >>');
    put(2, `<< /Type /Pages /Kids [${pageObjectIds.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    pages.forEach((page, i) => {
      const pId = pageObjectIds[i], cId = pId + 1, content = pdfPageContent(page, state.widthPt, state.heightPt, gsId ? 'GS0' : '');
      const resources = gsId ? `/Resources << /ExtGState << /GS0 ${gsId} 0 R >> >>` : '/Resources << >>';
      put(pId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(state.widthPt)} ${pdfNum(state.heightPt)}] ${resources} /Contents ${cId} 0 R >>`);
      put(cId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    if (gsId) put(gsId, `<< /Type /ExtGState /CA ${pdfNum(alpha)} /ca ${pdfNum(alpha)} >>`);
    const maxId = objects.length - 1;
    let pdf = '%PDF-1.4\n%Paperline Vector Document\n';
    const offsets = [0];
    for (let i = 1; i <= maxId; i++) { offsets[i] = pdf.length; pdf += objects[i]; }
    const xrefAt = pdf.length;
    pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= maxId; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
    return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' });
  }

  function safeFilename(name) { return (name || 'paperline').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 64) || 'paperline'; }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportPdf() {
    $('exportPdfBtn').disabled = true; $('exportPdfBtn').innerHTML = '<span class="export-spinner"></span><span>正在生成</span>';
    setTimeout(() => {
      try { const blob = buildPdf(); downloadBlob(blob, `${safeFilename(state.name)}.pdf`); showToast(`已导出 ${state.pages.length} 页矢量 PDF`); }
      catch (error) { console.error(error); showToast('PDF 生成失败，请检查纸张设置'); }
      finally { $('exportPdfBtn').disabled = false; $('exportPdfBtn').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4"/></svg><span>导出 PDF</span>'; }
    }, 20);
  }

  function saveProject() {
    const payload = { app: 'Paperline Studio', version: 1, savedAt: new Date().toISOString(), document: state };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeFilename(state.name)}.paperline.json`);
    showToast('项目文件已保存');
  }
  function openProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state = normalizeState(parsed.document || parsed);
        history = []; redoHistory = []; selectedId = null; zoom = 1;
        renderAll(); persist(); showToast('项目已打开');
      } catch (error) { showToast(error.message || '无法打开此项目文件'); }
      $('projectFileInput').value = '';
    };
    reader.onerror = () => showToast('读取项目文件失败');
    reader.readAsText(file);
  }

  $('preset').addEventListener('change', e => e.target.value === 'custom' ? (state.preset = 'custom', persist(), updateLabels()) : setPreset(e.target.value));
  $('unit').addEventListener('change', e => { state.unit = e.target.value; updateLabels(); persist(); });
  $('pageWidth').addEventListener('input', changeCustomDimensions); $('pageHeight').addEventListener('input', changeCustomDimensions);
  $('pageWidth').addEventListener('change', changeCustomDimensions); $('pageHeight').addEventListener('change', changeCustomDimensions);
  $('pageWidth').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); }); $('pageHeight').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('portraitBtn').addEventListener('click', () => setOrientation(false)); $('landscapeBtn').addEventListener('click', () => setOrientation(true));
  $('pageCount').addEventListener('change', e => setPageCount(e.target.value));
  $('pageCountMinus').addEventListener('click', () => setPageCount(state.pages.length - 1)); $('pageCountPlus').addEventListener('click', () => setPageCount(state.pages.length + 1));
  $('patternGrid').addEventListener('click', e => { const btn = e.target.closest('[data-pattern]'); if (!btn) return; state.settings.pattern = btn.dataset.pattern; renderAll(); persist(); });
  ['spacing', 'majorEvery', 'lineColor', 'lineWidth', 'opacity', 'dashStyle', 'dashLength', 'dashGap', 'paperColor', 'margin', 'cueWidth', 'summaryHeight'].forEach(key => { $(key).addEventListener('input', updateSettingsFromControls); $(key).addEventListener('change', updateSettingsFromControls); });
  document.querySelectorAll('[data-recipe]').forEach(btn => btn.addEventListener('click', () => applyRecipe(btn.dataset.recipe)));
  document.querySelectorAll('.tool-button').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
  $('insertTableBtn').addEventListener('click', () => { setTool('table'); stage.focus({ preventScroll: true }); });
  $('cancelToolBtn').addEventListener('click', () => setTool('select'));
  $('undoBtn').addEventListener('click', undo); $('undoTopBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo); $('deleteBtn').addEventListener('click', deleteSelected);
  $('zoomOutBtn').addEventListener('click', () => { zoom = clamp(zoom - .1, .5, 2); updateFit(); });
  $('zoomInBtn').addEventListener('click', () => { zoom = clamp(zoom + .1, .5, 2); updateFit(); });
  $('zoomFitBtn').addEventListener('click', () => { zoom = 1; updateFit(); });
  $('addPageBtn').addEventListener('click', () => { if (state.pages.length >= 100) return showToast('最多支持 100 页'); pushHistory(); state.pages.splice(state.activePage + 1, 0, { id: id(), elements: [] }); state.activePage++; selectedId = null; renderAll(); persist(); });
  $('duplicatePageBtn').addEventListener('click', () => { if (state.pages.length >= 100) return showToast('最多支持 100 页'); pushHistory(); const duplicate = clone(activePage()); duplicate.id = id(); duplicate.elements.forEach(e => e.id = id()); state.pages.splice(state.activePage + 1, 0, duplicate); state.activePage++; selectedId = null; renderAll(); persist(); });
  $('exportPdfBtn').addEventListener('click', exportPdf);
  $('projectMenuBtn').addEventListener('click', () => $('projectDialog').showModal());
  $('closeProjectDialog').addEventListener('click', () => $('projectDialog').close());
  $('saveProjectBtn').addEventListener('click', () => { saveProject(); $('projectDialog').close(); });
  $('openProjectBtn').addEventListener('click', () => { $('projectDialog').close(); $('projectFileInput').click(); });
  $('projectFileInput').addEventListener('change', e => openProjectFile(e.target.files[0]));
  $('docName').addEventListener('input', e => { state.name = e.target.value.slice(0, 64); persist(); });
  $('mobileSettingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('open'));

  document.addEventListener('keydown', e => {
    const tag = e.target?.tagName;
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.target?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteSelected(); }
    if (e.key === 'Escape' && tool !== 'select') { pointerAction = null; setTool('select'); renderPageSvg(svg, activePage()); }
  });
  window.addEventListener('resize', updateFit);
  if ('ResizeObserver' in window) new ResizeObserver(updateFit).observe(stage);

  // Paint controls from persisted document state before the first responsive fit.
  $('docName').value = state.name;
  $('lineWidth').value = fmt(pointsToUnit(state.settings.widthPt, 'mm'), 2);
  $('opacity').value = state.settings.opacity;
  $('spacing').value = fmt(pointsToUnit(state.settings.spacingPt), 1);
  $('dashLength').value = fmt(state.settings.dashLengthPt / UNIT_TO_PT.mm, 1);
  $('dashGap').value = fmt(state.settings.dashGapPt / UNIT_TO_PT.mm, 1);
  renderAll();
  persist();
})();
