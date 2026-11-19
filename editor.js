'use strict';

const $ = id => document.getElementById(id);
const names = { image: 'Image', text: 'Static text', live: 'Live text', bar: 'Fill bar' };
const codeColors = { image: '#ffb573', text: '#c8a8ff', live: '#79caff', bar: '#a4e78e' };
const extraCodeColors = ['#ff97b7', '#65e3d0', '#f6dc78', '#b3baff'];
const anchors = ['Action bar', 'Top left', 'Top center', 'Top right', 'Center left', 'Center',
  'Center right', 'Bottom left', 'Bottom center', 'Bottom right'];
const scales = Array.from({ length: 16 }, (_, index) => (index + 1) * 25 + '%');
const common = [
  ['name', 'Name'], ['anchor', 'Anchor', anchors], ['x', 'X offset', -8192, 8192],
  ['y', 'Y offset', -8192, 8192], ['scale', 'Scale', scales], ['visible', 'Visible', 'check']
];
const font = [
  ['font', 'Font', ['monospace', 'sans-serif', 'serif']],
  ['size', 'Font size', 6, 256], ['color', 'Text color', 'color']
];
const binding = [
  ['key', 'Value key'], ['preview', 'Preview value', -999999999, 999999999],
  ['fallback', 'Fallback value', -999999999, 999999999]
];
const fields = {
  image: [['source', 'PNG source', 'file'], ['width', 'Width', 1, 2048],
    ['height', 'Height', 1, 2048], ['multiplyColor', 'Multiply color', 'color'],
    ['locked', 'Lock aspect ratio', 'check']],
  text: [['text', 'Text'], ...font],
  live: [...binding, ['prefix', 'Prefix'], ['suffix', 'Suffix'], ...font,
    ['width', 'Layout width', 1, 4096], ['align', 'Alignment', ['left', 'center', 'right']]],
  bar: [...binding, ['min', 'Minimum', -999999999, 999999999],
    ['max', 'Maximum', -999999999, 999999999], ['width', 'Width', 1, 2048],
    ['height', 'Height', 1, 512], ['step', 'Fill step (%)', 1, 100],
    ['empty', 'Empty color', 'color'], ['filled', 'Filled color', 'color'],
    ['emptyImage', 'Empty PNG', 'file'], ['fillImage', 'Filled PNG', 'file']]
};

function newId() {
  return crypto.randomUUID?.() ?? String(Date.now() + Math.random());
}

function makeLayer(type, overrides = {}) {
  return {
    id: newId(), type,
    name: names[type], anchor: 'Action bar', x: -60, y: -16, scale: '100%', visible: true, codeColor: codeColors[type],
    ...({
      image: { source: '', width: 32, height: 32, multiplyColor: '#ffffff', locked: true, ratio: 1 },
      text: { text: 'HUD label', font: 'monospace', size: 30, scale: '50%', color: '#f3f6e9' },
      live: { key: 'health', preview: 72, fallback: 0, prefix: '', suffix: ' / 100',
        font: 'monospace', size: 24, scale: '50%', color: '#f3f6e9', width: 160, align: 'right' },
      bar: { key: 'health', preview: 72, fallback: 0, min: 0, max: 100,
        width: 120, height: 6, step: 5, empty: '#34423a', filled: '#a4e78e',
        emptyImage: '', fillImage: '' }
    })[type],
    ...overrides
  };
}

let project = {
  version: 1, minecraft: '26.3', namespace: 'fontui', width: 1920, height: 1080, guiScale: 4, zoom: 2,
  layers: [
    makeLayer('text', { name: 'Health label', text: 'HEALTH', y: -25 }),
    makeLayer('live', { name: 'Health value', x: -20, y: -24 }),
    makeLayer('bar', { name: 'Health bar', y: -8 })
  ]
};
let selected = project.layers[0].id;
const additionalSelection = new Set();
let renderSequence = 0;
let hitboxes = [];
const layerCodeLabels = new Map();
const images = new Map();
let movingLayer;
let copiedLayer;
let lastPastedId;
let fitCanvas = true;
let showGuides = true;
let showHotbar = true;
const undoStack = [];
const redoStack = [];
let savedProjectText = null;
function snapshot() { return JSON.stringify({ project, selected }); }
let current = snapshot();

function refreshHistory() {
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
}

function refreshSaveStatus() {
  const saved = JSON.stringify(project) === savedProjectText;
  const status = $('save-status');
  status.textContent = saved ? 'Saved in browser' : 'Unsaved changes';
  status.dataset.state = saved ? 'saved' : 'unsaved';
}

function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  current = from.pop();
  ({ project, selected } = JSON.parse(current));
  additionalSelection.clear();
  update();
}

function selectLayer(id) {
  selected = id;
  additionalSelection.clear();
}

function selectedLayers() {
  return project.layers.filter(layer => layer.id === selected || additionalSelection.has(layer.id));
}

function groupMembers(layer) {
  return layer.groupId ? project.layers.filter(item => item.groupId === layer.groupId) : [layer];
}

function selectionBounds(boxes, members) {
  const ids = new Set(members.map(layer => layer.id));
  const included = boxes.filter(box => ids.has(box.id));
  if (!included.length) return null;
  return {
    x: Math.min(...included.map(box => box.x)), y: Math.min(...included.map(box => box.y)),
    right: Math.max(...included.map(box => box.right)), bottom: Math.max(...included.map(box => box.bottom))
  };
}

function guiSize({ width, height, guiScale }) {
  const scale = Math.min(guiScale, Math.max(1, Math.min(Math.floor(width / 320), Math.floor(height / 240))));
  return { width: Math.ceil(width / scale), height: Math.ceil(height / scale), scale };
}

function anchorOffset(anchor, width, height) {
  if (anchor === 'Action bar') return { x: 0, y: 0 };
  const centerX = Math.floor(width / 2);
  const x = anchor.endsWith('left') ? -centerX : anchor.endsWith('right') ? width - centerX : 0;
  const screenY = anchor.startsWith('Top') ? 0 : anchor.startsWith('Bottom') ? height : Math.floor(height / 2);
  return { x, y: screenY - height + 72 };
}

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function canvas(width, height) {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function context(surface) {
  const result = surface.getContext('2d', { willReadFrequently: true });
  result.imageSmoothingEnabled = false;
  return result;
}

function loadImage(source) {
  if (!images.has(source)) {
    images.set(source, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read the PNG image.'));
      image.src = source;
    }));
  }
  return images.get(source);
}

function textSurface(text, layer) {
  const measuring = context(canvas(1, 1));
  const style = layer.size + 'px ' + layer.font;
  measuring.font = style;
  const metrics = measuring.measureText(text);
  const left = Math.max(0, Math.ceil(metrics.actualBoundingBoxLeft));
  const right = Math.max(0, Math.ceil(metrics.actualBoundingBoxRight));
  const baseline = Math.ceil(metrics.fontBoundingBoxAscent);
  const height = baseline + Math.ceil(metrics.fontBoundingBoxDescent);
  const surface = canvas(Math.max(1, left + right), Math.max(1, height));
  const ctx = context(surface);
  ctx.font = style;
  ctx.fillStyle = layer.color;
  ctx.fillText(text, left, baseline);
  return surface;
}

async function layerSurface(layer, fraction = 0) {
  if (layer.type === 'text') return textSurface(layer.text, layer);
  const surface = canvas(layer.width, layer.height);
  const ctx = context(surface);
  if (layer.type === 'image') {
    if (!layer.source) return surface;
    ctx.drawImage(await loadImage(layer.source), 0, 0, layer.width, layer.height);
    if (layer.multiplyColor.toLowerCase() !== '#ffffff') {
      const pixels = ctx.getImageData(0, 0, surface.width, surface.height);
      const [red, green, blue] = [1, 3, 5].map(offset =>
        parseInt(layer.multiplyColor.slice(offset, offset + 2), 16) / 255);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i] *= red;
        pixels.data[i + 1] *= green;
        pixels.data[i + 2] *= blue;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    return surface;
  }
  async function paint(source, color) {
    if (source) ctx.drawImage(await loadImage(source), 0, 0, layer.width, layer.height);
    else {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, layer.width, layer.height);
    }
  }
  await paint(layer.emptyImage, layer.empty);
  const fillWidth = Math.round(layer.width * fraction);
  if (fillWidth) {
    ctx.beginPath();
    ctx.rect(0, 0, fillWidth, layer.height);
    ctx.clip();
    await paint(layer.fillImage, layer.filled);
  }
  return surface;
}

function alphaBounds(surface) {
  const { width, height } = surface;
  const data = context(surface).getImageData(0, 0, width, height).data;
  let left = width, right = 0, top = height, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right ? { left, right, top, bottom } : null;
}

function layerScale(layer) {
  return parseInt(layer.scale, 10) / 100;
}

async function compile(buildPack, project) {
  if (!/^[a-z0-9_-]+$/.test(project.namespace)) {
    throw new Error('Use lowercase letters, numbers, hyphens, or underscores for the namespace.');
  }
  const fontId = project.namespace + ':hud';
  const gui = guiSize(project);
  const layout = { version: 1, minecraft: '26.3', font: fontId, advance: 2, layers: [] };
  const values = Object.create(null);
  const providers = [{ type: 'space', advances: {} }];
  const textures = new Map();
  const artwork = new Map();
  let nextCode = 0xF0000;
  let lastCode = 0xFFFFD;
  for (const layer of project.layers) {
    if (layer.visible && (layer.type === 'bar' || layer.type === 'live')) values[layer.key] = layer.preview;
  }
  for (let bit = 0; bit < 16; bit++) {
    for (const sign of [-1, 1]) {
      const advance = sign * 2 ** bit;
      providers[0].advances[FontUI.spacerCode(advance)] = advance;
    }
  }

  function reserveCodes(count, fromEnd = false) {
    if (nextCode + count - 1 > lastCode) throw new Error('The design exceeds the glyph limit.');
    if (fromEnd) {
      lastCode -= count;
      return lastCode + 1;
    }
    const first = nextCode;
    nextCode += count;
    return first;
  }

  function tiles(surface, layer, firstCode) {
    const scale = layerScale(layer);
    // Minecraft's provider height is integral. Pad the texture to preserve the exact ratio.
    const textureHeightUnit = Number.isInteger(scale) ? 1 : Number.isInteger(scale * 2) ? 2 : 4;
    const bounds = alphaBounds(surface);
    const result = [];
    if (!bounds) return result;
    for (let y = bounds.top; y < bounds.bottom; y += 256) {
      for (let x = bounds.left; x < bounds.right; x += 256) {
        const tile = canvas(Math.min(256, bounds.right - x), Math.min(256, bounds.bottom - y));
        context(tile).drawImage(surface, -x, -y);
        const ink = alphaBounds(tile);
        if (!ink) continue;
        const top = layer.y + Math.round((y + ink.top) * scale);
        const width = ink.right - ink.left;
        const height = ink.bottom - ink.top;
        const ascent = 7 - top;
        if (buildPack && ascent > 256) {
          throw new Error('Artwork is too far above the action bar. Move it down or reduce the preview height.');
        }
        const logicalWidth = width * scale;
        const logicalHeight = height * scale;
        const paddedHeight = Math.ceil(Math.max(height, ascent / scale) / textureHeightUnit) * textureHeightUnit;
        const cell = canvas(width, buildPack ? paddedHeight : height);
        context(cell).drawImage(tile, -ink.left, -ink.top);
        const char = String.fromCodePoint(firstCode === undefined ? reserveCodes(1) : firstCode + result.length);
        const glyph = { char, x: Math.round((x + ink.left) * scale), y: top,
          width: logicalWidth, height: logicalHeight, advance: Math.round(logicalWidth) + 1 };
        result.push(glyph);
        artwork.set(char, cell);
        if (buildPack) {
          const path = 'font/' + char.codePointAt(0).toString(16) + '.png';
          providers.push({ type: 'bitmap', file: project.namespace + ':' + path,
            height: paddedHeight * scale, ascent, chars: [char] });
          textures.set('assets/' + project.namespace + '/textures/' + path, cell);
        }
      }
    }
    return result;
  }

  for (const sourceLayer of project.layers) {
    const offset = anchorOffset(sourceLayer.anchor, gui.width, gui.height);
    const layer = { ...sourceLayer, x: sourceLayer.x + offset.x, y: sourceLayer.y + offset.y };
    if (!layer.visible) continue;
    const entry = { type: layer.type, id: layer.id, name: layer.name, x: layer.x, y: layer.y,
      placement: { anchor: sourceLayer.anchor, x: sourceLayer.x, y: sourceLayer.y } };
    if (layer.type === 'bar' || layer.type === 'live') {
      if (!layer.key.trim()) throw new Error(layer.name + ' needs a value key.');
      Object.assign(entry, { key: layer.key, fallback: layer.fallback });
    }
    const first = nextCode;
    if (layer.type === 'bar') {
      if (layer.max <= layer.min) throw new Error(layer.name + ' needs a maximum greater than its minimum.');
      const count = Math.ceil(100 / layer.step);
      const slots = Math.ceil(layer.width / 256) * Math.ceil(layer.height / 256);
      reserveCodes(count * slots);
      const emptyCode = reserveCodes(slots, true);
      Object.assign(entry, { min: layer.min, max: layer.max, step: layer.step, frames: new Array(count + 1),
        emptyUnicode: { first: emptyCode, last: emptyCode + slots - 1 } });
      async function buildFrame(index) {
        const fraction = Math.min(100, index * layer.step) / 100;
        const code = index === 0 ? emptyCode : first + (index - 1) * slots;
        entry.frames[index] = tiles(await layerSurface(layer, fraction), layer, code);
      }
      if (buildPack) {
        for (let index = 0; index <= count; index++) await buildFrame(index);
      } else {
        await buildFrame(FontUI.barFrame(entry, values[layer.key]));
      }
    } else if (layer.type === 'live') {
      const scale = layerScale(layer);
      Object.assign(entry, { width: Math.max(1, Math.round(layer.width * scale)), align: layer.align, prefix: layer.prefix,
        suffix: layer.suffix, characters: Object.create(null) });
      for (const char of new Set('0123456789-' + layer.prefix + layer.suffix)) {
        const surface = textSurface(char, layer);
        const bounds = alphaBounds(surface);
        entry.characters[char] = {
          advance: bounds ? Math.round(bounds.right * scale) + 1
            : Math.max(1, Math.round(layer.size * scale / 2)),
          tiles: tiles(surface, layer)
        };
      }
    } else {
      const surface = await layerSurface(layer);
      entry.glyphs = tiles(surface, layer);
    }
    if (nextCode > first) entry.unicode = { first, last: nextCode - 1 };
    layout.layers.push(entry);
  }
  return { layout, values, artwork, textures, providers };
}

function unicodeRange(range) {
  const first = FontUI.unicodeLabel(range.first);
  return range.first === range.last ? first : first + '\u2013' + FontUI.unicodeLabel(range.last);
}

function background(ctx, width, height) {
  ctx.fillStyle = '#242332';
  ctx.fillRect(0, 0, width, height);
  const center = Math.floor(width / 2);
  if (showGuides) {
    ctx.strokeStyle = '#343247';
    ctx.beginPath();
    for (let x = center % 16; x < width; x += 16) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = (height - 72) % 16; y < height; y += 16) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = '#71678c';
    ctx.beginPath();
    ctx.moveTo(center + 0.5, 0);
    ctx.lineTo(center + 0.5, height);
    ctx.moveTo(0, height - 71.5);
    ctx.lineTo(width, height - 71.5);
    ctx.stroke();
  }
  if (!showHotbar) return;
  ctx.fillStyle = '#171720';
  ctx.fillRect(center - 91, height - 22, 182, 22);
  ctx.strokeStyle = '#696477';
  for (let slot = 0; slot < 9; slot++) ctx.strokeRect(center - 89.5 + slot * 20, height - 19.5, 18, 18);
}

async function render() {
  const sequence = ++renderSequence;
  $('copy-quick').disabled = true;
  $('quick-preview').replaceChildren();
  if ($('quick-command').open) $('quick-status').textContent = 'Reopen Minecraft command to refresh.';
  try {
    const { layout, values, artwork } = await compile(false, structuredClone(project));
    if (sequence !== renderSequence) return;
    const surface = $('canvas');
    const { width, height, scale } = guiSize(project);
    surface.width = width;
    surface.height = height;
    sizeCanvas();
    const ctx = context(surface);
    background(ctx, width, height);
    hitboxes = [];
    for (const layer of layout.layers) {
      const label = layerCodeLabels.get(layer.id);
      if (label) {
        label.textContent = layer.unicode ? unicodeRange(layer.unicode) : 'No glyphs';
        if (layer.emptyUnicode) label.textContent += '\n0% ' + unicodeRange(layer.emptyUnicode);
      }
      const glyphs = FontUI.place({ layers: [layer] }, values);
      if (!glyphs.length) continue;
      for (const glyph of glyphs) {
        const image = artwork.get(glyph.char);
        ctx.imageSmoothingEnabled = image.width !== glyph.width || image.height !== glyph.height;
        ctx.drawImage(image, Math.floor(width / 2) + glyph.x, height - 72 + glyph.y, glyph.width, glyph.height);
      }
      const x = Math.min(...glyphs.map(g => g.x));
      const y = Math.min(...glyphs.map(g => g.y));
      const right = Math.max(...glyphs.map(g => g.x + g.width));
      const bottom = Math.max(...glyphs.map(g => g.y + g.height));
      hitboxes.push({ id: layer.id, x, y, right, bottom });
    }
    const box = selectionBounds(hitboxes, [...new Set(selectedLayers().flatMap(groupMembers))]);
    if (box && showGuides) {
      ctx.strokeStyle = '#bfadff';
      ctx.strokeRect(Math.floor(width / 2) + box.x - 0.5, height - 72 + box.y - 0.5,
        box.right - box.x + 1, box.bottom - box.y + 1);
    }
    if (showGuides && drag) {
      ctx.fillStyle = '#a4e78e';
      if (drag.guideX !== undefined) {
        ctx.fillRect(Math.floor(width / 2) + drag.guideX, 0, 1, height);
      }
      if (drag.guideY !== undefined) {
        ctx.fillRect(0, height - 72 + drag.guideY, width, 1);
      }
    }
    status(project.width + ' × ' + project.height + ' screen · ' + width + ' × ' + height + ' GUI · Scale ' + scale);
  } catch (error) {
    if (sequence === renderSequence) status(error.message, true);
  }
}

function sizeCanvas() {
  const { width, height } = guiSize(project);
  const viewport = document.querySelector('.viewport');
  const fitted = Math.min((viewport.clientWidth - 48) / width, (viewport.clientHeight - 48) / height, 3);
  const scale = fitCanvas ? Math.max(0.1, fitted >= 1 ? Math.floor(fitted) : fitted) : project.zoom;
  $('canvas').style.setProperty('--canvas-width', Math.floor(width * scale) + 'px');
}

function field(definition, target, change) {
  const [key, label, kind, max] = definition;
  const wrapper = document.createElement('label');
  wrapper.textContent = label;
  const input = document.createElement(Array.isArray(kind) ? 'select' : 'input');
  if (Array.isArray(kind)) {
    for (const value of kind) input.add(new Option(value, value));
  } else {
    input.type = typeof kind === 'number' ? 'number' : ({ check: 'checkbox' })[kind] || kind || 'text';
    if (input.type === 'number') { input.min = kind; input.max = max; }
  }
  if (kind === 'check') input.checked = target[key];
  else if (kind === 'file') input.accept = 'image/png';
  else input.value = target[key];
  input.addEventListener('change', async () => {
    try {
      if (kind === 'file') {
        const [file] = input.files;
        if (!file) return;
        const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        if (String(bytes) !== '137,80,78,71,13,10,26,10') throw new Error('Choose a PNG image.');
        const source = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const image = await loadImage(source);
        target[key] = source;
        if (key === 'source') {
          target.ratio = image.width / image.height;
          const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
          target.width = Math.max(1, Math.round(image.width * scale));
          target.height = Math.max(1, Math.round(image.height * scale));
        }
      } else if (kind === 'check') target[key] = input.checked;
      else if (typeof kind === 'number') {
        target[key] = Math.max(kind, Math.min(max, Math.round(input.valueAsNumber || 0)));
        if (target.type === 'image' && target.locked) {
          if (key === 'width') target.height = Math.max(1, Math.min(2048, Math.round(target.width / target.ratio)));
          if (key === 'height') target.width = Math.max(1, Math.min(2048, Math.round(target.height * target.ratio)));
        }
      } else target[key] = input.value;
      change(key);
    } catch (error) { status(error.message, true); }
  });
  wrapper.append(input);
  if (kind === 'file' && target[key]) {
    const clear = document.createElement('button');
    clear.textContent = 'Remove PNG';
    clear.addEventListener('click', () => { target[key] = ''; change(key); });
    wrapper.append(clear);
  }
  return wrapper;
}

function updatePanels() {
  layerCodeLabels.clear();
  $('layer-count').textContent = project.layers.length;
  $('zoom').value = project.zoom;
  $('settings').replaceChildren(...[
    ['namespace', 'Pack namespace'], ['width', 'Screen width', 180, 1920],
    ['height', 'Screen height', 100, 1080], ['guiScale', 'Minecraft GUI scale', 1, 6]
  ].map(item => field(item, project, update)));
  const groupIds = [...new Set(project.layers.map(layer => layer.groupId).filter(Boolean))];
  const selection = selectedLayers();
  const highlighted = new Set(selection.flatMap(groupMembers));
  $('group-layers').disabled = selection.length < 2
    || selection.every(layer => layer.groupId && layer.groupId === selection[0].groupId);
  $('ungroup-layers').disabled = !selection.some(layer => layer.groupId);
  const buttons = [...project.layers].reverse().map(layer => {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.selected = String(highlighted.has(layer));
    row.dataset.primary = String(layer.id === selected);
    const handle = document.createElement('span');
    handle.className = 'layer-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-hidden', 'true');
    handle.draggable = true;
    handle.addEventListener('dragstart', event => {
      movingLayer = layer.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', layer.id);
    });
    handle.addEventListener('dragend', () => {
      movingLayer = null;
      $('layers').querySelector('.drop-target')?.classList.remove('drop-target');
    });
    row.addEventListener('dragover', event => {
      if (!movingLayer || movingLayer === layer.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      $('layers').querySelector('.drop-target')?.classList.remove('drop-target');
      row.classList.add('drop-target');
    });
    row.addEventListener('drop', event => {
      if (!movingLayer || movingLayer === layer.id) return;
      event.preventDefault();
      const from = project.layers.findIndex(item => item.id === movingLayer);
      const to = project.layers.indexOf(layer);
      if (from < 0 || to < 0) return;
      const [moved] = project.layers.splice(from, 1);
      project.layers.splice(to, 0, moved);
      movingLayer = null;
      selectLayer(moved.id);
      update();
    });
    const button = document.createElement('button');
    button.className = 'layer-select';
    button.textContent = layer.name;
    const subtitle = document.createElement('span');
    subtitle.className = 'layer-subtitle';
    subtitle.textContent = names[layer.type];
    if (layer.groupId) subtitle.textContent += ' · Group ' + (groupIds.indexOf(layer.groupId) + 1);
    const codes = document.createElement('span');
    codes.className = 'layer-codes';
    codes.style.setProperty('--code-color', layer.codeColor);
    codes.textContent = layer.visible ? '' : 'Hidden';
    layerCodeLabels.set(layer.id, codes);
    button.append(subtitle, codes);
    button.setAttribute('aria-pressed', String(highlighted.has(layer)));
    button.addEventListener('click', event => {
      if (!event.shiftKey || !selected) {
        selectLayer(layer.id);
      } else if (additionalSelection.has(layer.id)) {
        additionalSelection.delete(layer.id);
      } else if (layer.id !== selected) {
        additionalSelection.add(layer.id);
      }
      update();
      [...$('layers').children].find(item => item.dataset.layerId === layer.id)
        ?.querySelector('.layer-select').focus();
    });
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'layer-color';
    color.value = layer.codeColor;
    color.title = 'Unicode highlight color';
    color.setAttribute('aria-label', 'Unicode highlight color for ' + layer.name);
    color.addEventListener('change', () => {
      layer.codeColor = color.value;
      update();
      [...$('layers').children].find(item => item.dataset.layerId === layer.id)
        ?.querySelector('.layer-color').focus();
    });
    const visibility = document.createElement('button');
    visibility.className = 'layer-visibility';
    visibility.textContent = layer.visible ? '●' : '○';
    visibility.title = 'Toggle visibility';
    visibility.setAttribute('aria-label', 'Visible: ' + layer.name);
    visibility.setAttribute('aria-pressed', String(layer.visible));
    visibility.onclick = () => {
      layer.visible = !layer.visible;
      update();
      [...$('layers').children].find(item => item.dataset.layerId === layer.id)
        ?.querySelector('.layer-visibility').focus();
    };
    row.dataset.layerId = layer.id;
    row.append(handle, button, color, visibility);
    return row;
  });
  $('layers').replaceChildren(...buttons);
  const layer = project.layers.find(item => item.id === selected);
  $('properties').replaceChildren();
  if (!layer) { $('properties').textContent = 'Select or add a layer.'; return; }
  const index = project.layers.indexOf(layer);
  function change(key) {
    if (key === 'preview' || key === 'key') {
      for (const peer of project.layers) if (peer.key === layer.key) peer.preview = layer.preview;
    }
    update();
  }
  const bindingKeys = new Set(binding.map(([key]) => key));
  function group(title, definitions) {
    if (!definitions.length) return;
    const section = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    section.append(legend);
    for (const definition of definitions) {
      const control = field(definition, layer, change);
      if (typeof definition[2] !== 'number') control.classList.add('wide');
      section.append(control);
    }
    $('properties').append(section);
  }
  group('Placement', common.filter(([key]) => key !== 'visible'));
  group('Appearance', fields[layer.type].filter(([key]) => !bindingKeys.has(key)));
  group('Value binding', fields[layer.type].filter(([key]) => bindingKeys.has(key)));
  const actions = document.createElement('div');
  actions.className = 'layer-actions';
  function action(label, disabled, perform) {
    const button = document.createElement('button');
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', () => { perform(); update(); });
    actions.append(button);
  }
  function move(delta) {
    project.layers.splice(index, 1);
    project.layers.splice(index + delta, 0, layer);
  }
  action('Forward', index === project.layers.length - 1, () => move(1));
  action('Backward', index === 0, () => move(-1));
  action('Delete', false, removeSelected);
  $('properties').append(actions);
}

function update() {
  if (JSON.stringify(project) !== JSON.stringify(JSON.parse(current).project)) {
    undoStack.push(current);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  current = snapshot();
  refreshHistory();
  refreshSaveStatus();
  updatePanels();
  $('copy-layer').disabled = !project.layers.some(layer => layer.id === selected);
  return render();
}

function removeSelected() {
  const index = project.layers.findIndex(layer => layer.id === selected);
  if (index < 0) return;
  const [removed] = project.layers.splice(index, 1);
  const remaining = groupMembers(removed);
  if (remaining.length === 1) delete remaining[0].groupId;
  selectLayer(project.layers[Math.min(index, project.layers.length - 1)]?.id);
}

$('group-layers').onclick = () => {
  if ($('group-layers').disabled) return;
  const id = newId();
  for (const layer of new Set(selectedLayers().flatMap(groupMembers))) layer.groupId = id;
  additionalSelection.clear();
  update();
};
$('ungroup-layers').onclick = () => {
  if ($('ungroup-layers').disabled) return;
  for (const layer of new Set(selectedLayers().flatMap(groupMembers))) delete layer.groupId;
  additionalSelection.clear();
  update();
};

$('copy-layer').onclick = () => {
  const layer = project.layers.find(item => item.id === selected);
  if (!layer) return;
  copiedLayer = structuredClone(layer);
  delete copiedLayer.id;
  delete copiedLayer.groupId;
  lastPastedId = undefined;
  $('paste-layer').disabled = false;
  status('Layer copied.');
};
$('paste-layer').onclick = () => {
  if (!copiedLayer) return;
  const previous = project.layers.find(layer => layer.id === lastPastedId && layer.anchor === copiedLayer.anchor);
  const position = previous ?? copiedLayer;
  const layer = makeLayer(copiedLayer.type, {
    ...copiedLayer, name: copiedLayer.name + ' copy',
    x: Math.min(8192, position.x + 8), y: Math.min(8192, position.y + 8)
  });
  const binding = [...project.layers].reverse().find(item => layer.key && item.key === layer.key && item.visible);
  if (binding) layer.preview = binding.preview;
  project.layers.push(layer);
  lastPastedId = layer.id;
  selectLayer(layer.id);
  update();
};

$('undo').onclick = () => restore(undoStack, redoStack);
$('redo').onclick = () => restore(redoStack, undoStack);
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!event.repeat) {
      if (document.activeElement?.matches('input, select')) document.activeElement.blur();
      $('save').click();
    }
    return;
  }
  if ($('command').open || $('quick-command').open
    || event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!event.repeat) {
      removeSelected();
      update();
    }
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if ((key === 'c' || key === 'v') && !event.shiftKey) {
    if (key === 'c' && window.getSelection()?.toString()) return;
    const button = $(key === 'c' ? 'copy-layer' : 'paste-layer');
    if (button.disabled) return;
    event.preventDefault();
    if (!event.repeat) button.click();
  } else if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    $('undo').click();
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault();
    $('redo').click();
  }
});

$('fit').onclick = () => {
  fitCanvas = !fitCanvas;
  $('fit').setAttribute('aria-pressed', String(fitCanvas));
  sizeCanvas();
};
$('zoom').onchange = () => {
  project.zoom = Number($('zoom').value);
  fitCanvas = false;
  $('fit').setAttribute('aria-pressed', 'false');
  update();
};
document.querySelector('.viewport').addEventListener('wheel', event => {
  if (!event.deltaY || event.ctrlKey || event.metaKey) return;
  const layer = project.layers.find(item => item.id === selected && item.visible);
  if (!layer) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const next = scales[scales.indexOf(layer.scale) + direction];
  if (next === undefined) return;
  layer.scale = next;
  update();
}, { passive: false });
$('guides').onclick = () => {
  showGuides = !showGuides;
  $('guides').setAttribute('aria-pressed', String(showGuides));
  render();
};
$('hotbar').onclick = () => {
  showHotbar = !showHotbar;
  $('hotbar').setAttribute('aria-pressed', String(showHotbar));
  render();
};
new ResizeObserver(() => {
  if (fitCanvas) sizeCanvas();
}).observe(document.querySelector('.viewport'));

$('canvas').addEventListener('keydown', event => {
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  const layer = project.layers.find(item => item.id === selected);
  if (!direction || !layer?.visible) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const movement = groupMovement(layer);
  applyMovement(movement, clampDelta(direction[0] * step, movement.x), clampDelta(direction[1] * step, movement.y));
  update();
});

$('add').addEventListener('click', event => {
  const type = event.target.closest('button[data-type]')?.dataset.type;
  if (!type) return;
  const layer = makeLayer(type);
  const usedColors = new Set(project.layers.map(item => item.codeColor.toLowerCase()));
  if (usedColors.has(layer.codeColor)) {
    layer.codeColor = [...Object.values(codeColors), ...extraCodeColors]
      .find(color => !usedColors.has(color)) ?? layer.codeColor;
  }
  const binding = project.layers.find(item => layer.key && item.key === layer.key);
  if (binding) layer.preview = binding.preview;
  project.layers.push(layer);
  selectLayer(layer.id);
  update();
});

function point(event) {
  const surface = $('canvas');
  const rect = surface.getBoundingClientRect();
  const { width, height } = surface;
  return {
    x: Math.floor((event.clientX - rect.left) * width / rect.width) - Math.floor(width / 2),
    y: Math.floor((event.clientY - rect.top) * height / rect.height) - height + 72
  };
}
let drag;
function groupMovement(layer) {
  const members = groupMembers(layer).map(item => ({ layer: item, x: item.x, y: item.y }));
  const limits = axis => ({
    min: Math.max(...members.map(item => -8192 - item[axis])),
    max: Math.min(...members.map(item => 8192 - item[axis]))
  });
  return { members, x: limits('x'), y: limits('y') };
}

function clampDelta(delta, { min, max }) {
  return Math.max(min, Math.min(max, delta));
}

function applyMovement(movement, dx, dy) {
  for (const item of movement.members) {
    item.layer.x = item.x + dx;
    item.layer.y = item.y + dy;
  }
}

function alignmentSnap(start, end, offset, targets, minOffset, maxOffset) {
  const edges = [start, end];
  const center = (start + end) / 2;
  let bestDistance = 4;
  let result = { offset };
  function consider(source, target) {
    const snapped = Math.round(target - source);
    const distance = Math.abs(target - source - offset);
    if (distance > bestDistance || snapped < minOffset || snapped > maxOffset) return;
    if (result.guide !== undefined && distance === bestDistance) return;
    bestDistance = distance;
    result = { offset: snapped, guide: Math.round(target) };
  }
  for (const [near, far] of targets) {
    for (const edge of edges) {
      consider(edge, near);
      consider(edge, far);
    }
    consider(center, (near + far) / 2);
  }
  return result;
}

$('canvas').addEventListener('pointerdown', event => {
  if (event.button !== 0 || drag) return;
  const p = point(event);
  const box = [...hitboxes].reverse().find(b => p.x >= b.x && p.x < b.right && p.y >= b.y && p.y < b.bottom);
  if (!box) return;
  const layer = project.layers.find(item => item.id === box.id);
  if (!layer?.visible) return;
  const movement = groupMovement(layer);
  const members = movement.members.map(item => item.layer);
  const ids = new Set(members.map(item => item.id));
  const targets = hitboxes.filter(entry => !ids.has(entry.id));
  selectLayer(box.id);
  drag = {
    pointerId: event.pointerId, movement, box: selectionBounds(hitboxes, members), origin: p,
    horizontal: targets.map(({ x, right }) => [x, right]),
    vertical: targets.map(({ y, bottom }) => [y, bottom])
  };
  $('canvas').setPointerCapture(event.pointerId);
  update();
});
$('canvas').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const p = point(event);
  const { movement, box, origin, horizontal, vertical } = drag;
  const dx = clampDelta(p.x - origin.x, movement.x);
  const dy = clampDelta(p.y - origin.y, movement.y);
  const canSnap = !event.shiftKey && (p.x !== origin.x || p.y !== origin.y);
  const snappedX = canSnap ? alignmentSnap(box.x, box.right, dx, horizontal, movement.x.min, movement.x.max) : { offset: dx };
  const snappedY = canSnap ? alignmentSnap(box.y, box.bottom, dy, vertical, movement.y.min, movement.y.max) : { offset: dy };
  drag.guideX = snappedX.guide;
  drag.guideY = snappedY.guide;
  applyMovement(movement, snappedX.offset, snappedY.offset);
  render();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  $('canvas').addEventListener(type, event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    update();
  });
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const savedProjectKey = 'fontui.saved-project.v1';
$('save').onclick = () => {
  try {
    const text = JSON.stringify(project);
    localStorage.setItem(savedProjectKey, text);
    savedProjectText = text;
    refreshSaveStatus();
  } catch (error) {
    $('save-status').textContent = 'Save failed';
    $('save-status').dataset.state = 'error';
    status(error.name === 'QuotaExceededError'
      ? 'Browser storage is full. Use Download project to keep a copy.'
      : 'Browser storage is unavailable. Use Download project to keep a copy.', true);
  }
};
$('download-project').onclick = () =>
  download('fontui.project.json', JSON.stringify(project, null, 2), 'application/json');
$('open').onclick = () => $('project-file').click();
$('project-file').onchange = async event => {
  try {
    const [file] = event.target.files;
    if (!file) return;
    loadProject(await file.text());
    update();
  } catch (error) { status(error.message, true); }
  finally { event.target.value = ''; }
};

function loadProject(text) {
  const data = JSON.parse(text);
  if (data?.version !== 1 || data.minecraft !== '26.3' || !Array.isArray(data.layers)
    || !/^[a-z0-9_-]+$/.test(data.namespace)) throw new Error('Choose a FontUI 26.3 project.');
  if (!Object.hasOwn(data, 'guiScale')) data.guiScale = 1;
  for (const layer of data.layers) {
    if (!layer || typeof layer !== 'object') continue;
    if (layer.type === 'image' && !Object.hasOwn(layer, 'multiplyColor')) layer.multiplyColor = '#ffffff';
    if (!Object.hasOwn(layer, 'scale')) {
      const wasHalfScale = (layer.type === 'text' || layer.type === 'live') && layer.textScale === '50%';
      layer.scale = wasHalfScale ? '50%' : '100%';
      if (wasHalfScale && layer.type === 'live' && Number.isInteger(layer.width)) layer.width *= 2;
    }
    delete layer.textScale;
    if (layer && !Object.hasOwn(layer, 'anchor')) layer.anchor = 'Action bar';
    if (layer && !Object.hasOwn(layer, 'codeColor')) {
      layer.codeColor = typeof layer.tint === 'string' && /^#[a-f0-9]{6}$/i.test(layer.tint)
        && layer.tint.toLowerCase() !== '#ffffff' ? layer.tint : codeColors[layer.type];
    }
    if (layer && Object.hasOwn(layer, 'tint')) delete layer.tint;
    if (layer?.type === 'bar' && layer.step === undefined
      && Number.isInteger(layer.steps) && layer.steps >= 1 && layer.steps <= 64) {
      layer.step = Math.round(100 / layer.steps);
      delete layer.steps;
    }
  }
  function validFields(entry, definitions) {
    return definitions.every(([key, , kind, max]) => {
      const value = entry[key];
      if (typeof kind === 'number') return Number.isInteger(value) && value >= kind && value <= max;
      if (kind === 'check') return typeof value === 'boolean';
      if (Array.isArray(kind)) return kind.includes(value);
      if (kind === 'file') return value === '' || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
      if (kind === 'color') return /^#[0-9a-f]{6}$/i.test(value);
      return typeof value === 'string';
    });
  }
  if (!validFields(data, [['width', '', 180, 1920], ['height', '', 100, 1080],
    ['guiScale', '', 1, 6], ['zoom', '', 1, 6]])
    || data.layers.some(layer => !layer || !Object.hasOwn(fields, layer.type) || typeof layer.id !== 'string'
      || (layer.groupId !== undefined && (typeof layer.groupId !== 'string' || !layer.groupId))
      || !validFields(layer, [...common, ['codeColor', '', 'color'], ...fields[layer.type]])
      || (layer.type === 'image' && (!Number.isFinite(layer.ratio) || layer.ratio <= 0)))
    || new Set(data.layers.map(layer => layer.id)).size !== data.layers.length) {
    throw new Error('The project contains invalid layer or preview properties.');
  }
  project = data;
  selectLayer(project.layers.at(-1)?.id);
  undoStack.length = 0;
  redoStack.length = 0;
  current = snapshot();
}

// Store small resource packs directly as ZIP files without network dependencies.
function zip(files) {
  const local = [], directory = [];
  let offset = 0, directoryLength = 0;
  function header(length, pairs) {
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    for (const [at, size, value] of pairs) {
      if (size === 4) view.setUint32(at, value, true);
      else view.setUint16(at, value, true);
    }
    return bytes;
  }
  for (const [name, bytes] of files) {
    const path = new TextEncoder().encode(name);
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc ^= -1;
    const length = bytes.length;
    local.push(header(30, [[0,4,0x04034b50],[4,2,20],[12,2,33],[14,4,crc],
      [18,4,length],[22,4,length],[26,2,path.length]]), path, bytes);
    directory.push(header(46, [[0,4,0x02014b50],[4,2,20],[6,2,20],[14,2,33],[16,4,crc],
      [20,4,length],[24,4,length],[28,2,path.length],[42,4,offset]]), path);
    offset += 30 + path.length + length;
    directoryLength += 46 + path.length;
  }
  if (files.size > 65535 || offset + directoryLength >= 2 ** 32) throw new Error('The ZIP exceeds the export size limit.');
  return new Blob([...local, ...directory, header(22, [[0,4,0x06054b50],[8,2,files.size],
    [10,2,files.size],[12,4,directoryLength],[16,4,offset]])], { type: 'application/zip' });
}

$('export').onclick = async () => {
  $('export').disabled = true;
  status('Building resource pack…');
  try {
    const snapshot = structuredClone(project);
    const namespace = snapshot.namespace;
    const { layout, values, textures, providers } = await compile(true, snapshot);
    const command = FontUI.command(layout, values);
    const files = new Map();
    function write(path, data) { files.set(path, new TextEncoder().encode(data)); }
    write('pack.mcmeta', JSON.stringify({ pack: { description: 'FontUI HUD', min_format: [97, 1], max_format: [97, 1] } }));
    write('assets/' + namespace + '/font/hud.json', JSON.stringify({ providers }));
    write('fontui-preview.txt', command + '\n');
    write('fontui-layout.json', JSON.stringify(layout, null, 2));
    for (const [path, surface] of textures) {
      const encoded = surface.toDataURL('image/png').split(',')[1];
      if (!encoded) throw new Error('Could not encode a glyph texture.');
      files.set(path, Uint8Array.from(atob(encoded), character => character.charCodeAt(0)));
    }
    download(namespace + '-hud.zip', zip(files), 'application/zip');
    showCommandPreview($('export-preview'), command, layout, snapshot.layers);
    const anchorNote = $('anchor-note');
    anchorNote.hidden = !layout.layers.some(layer => layer.placement.anchor !== 'Action bar');
    const gui = guiSize(snapshot);
    anchorNote.textContent = 'Screen anchors were resolved at ' + gui.width + ' × ' + gui.height
      + ' GUI pixels. Positions relative to screen edges can change at other resolutions or GUI scales.';
    $('copy-status').textContent = '';
    $('command').showModal();
    status('Exported ' + namespace + '-hud.zip');
  } catch (error) { status(error.message, true); }
  finally { $('export').disabled = false; }
};

function badgeTextColor(hex) {
  const [red, green, blue] = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.179 ? '#000000' : '#ffffff';
}

function showCommandPreview(preview, command, layout, sourceLayers) {
  const byId = new Map(sourceLayers.map(layer => [layer.id, layer]));
  const ranges = layout.layers.flatMap(layer => [layer.unicode, layer.emptyUnicode]
    .filter(Boolean).map(range => ({ ...range, layer: byId.get(layer.id) })));
  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const match of command.matchAll(/\\(?:U([\dA-F]{8})|u([\dA-F]{4}))/g)) {
    const code = parseInt(match[1] ?? match[2], 16);
    const entry = ranges.find(range => code >= range.first && code <= range.last);
    if (!entry) continue;
    fragment.append(command.slice(end, match.index));
    const glyph = document.createElement('span');
    glyph.className = 'unicode-badge';
    glyph.textContent = match[0];
    glyph.style.setProperty('--code-color', entry.layer.codeColor);
    glyph.style.setProperty('--badge-text', badgeTextColor(entry.layer.codeColor));
    glyph.title = entry.layer.name + ' (' + FontUI.unicodeLabel(code) + ')';
    fragment.append(glyph);
    end = match.index + match[0].length;
  }
  fragment.append(command.slice(end));
  preview.replaceChildren(fragment);
}

async function copyCommand(preview, feedback) {
  try { await navigator.clipboard.writeText(preview.textContent); feedback.textContent = 'Copied'; }
  catch {
    preview.focus();
    const range = document.createRange();
    range.selectNodeContents(preview);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    feedback.textContent = 'Press Ctrl+C to copy';
  }
}

$('copy').onclick = () => copyCommand($('export-preview'), $('copy-status'));
$('copy-quick').onclick = () => copyCommand($('quick-preview'), $('quick-status'));
$('show-command').onclick = async () => {
  const sequence = renderSequence;
  $('quick-command').showModal();
  $('copy-quick').disabled = true;
  $('quick-status').textContent = 'Preparing command…';
  try {
    const snapshot = structuredClone(project);
    const { layout, values } = await compile(true, snapshot);
    if (sequence !== renderSequence) return;
    showCommandPreview($('quick-preview'), FontUI.command(layout, values), layout, snapshot.layers);
    $('copy-quick').disabled = false;
    $('quick-status').textContent = 'Use with the resource pack exported from this layout.';
  } catch (error) {
    if (sequence === renderSequence) $('quick-status').textContent = error.message;
  }
};

let restoreError;
try {
  const saved = localStorage.getItem(savedProjectKey);
  if (saved !== null) {
    loadProject(saved);
    savedProjectText = JSON.stringify(project);
  }
} catch (error) {
  if (error.name !== 'SecurityError') restoreError = 'Could not reopen the browser save. ' + error.message;
}
update().then(() => {
  if (restoreError) status(restoreError, true);
});
