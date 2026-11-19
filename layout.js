/* Shared by the editor and server-side command generator. */
(function (root) {
  function barFrame(layer, value) {
    if (value >= layer.max) return layer.frames.length - 1;
    if (value <= layer.min) return 0;
    if (layer.step === undefined) {
      return Math.floor((value - layer.min) / (layer.max - layer.min) * (layer.frames.length - 1));
    }
    return Math.floor((value - layer.min) * 100 / ((layer.max - layer.min) * layer.step));
  }

  function unicodeLabel(code) {
    return 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
  }

  function activeGlyphs(layer, values) {
    const supplied = Object.hasOwn(values, layer.key) ? values[layer.key] : undefined;
    const value = Number.isSafeInteger(supplied) ? supplied : layer.fallback;
    if (layer.type === 'bar') {
      return layer.frames[barFrame(layer, value)];
    }
    if (layer.type !== 'live') return layer.glyphs;
    const glyphs = Array.from(layer.prefix + value + layer.suffix, c => layer.characters[c]);
    const width = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
    const gap = layer.width - Math.max(0, width - 1);
    const offset = layer.align === 'right' ? gap : layer.align === 'center' ? Math.floor(gap / 2) : 0;
    let x = offset;
    return glyphs.map(glyph => {
      const placed = glyph.tiles.map(tile => ({ ...tile, x: tile.x + x }));
      x += glyph.advance;
      return placed;
    }).flat();
  }

  function place(layout, values = {}) {
    return layout.layers.flatMap(layer => activeGlyphs(layer, values).map(glyph => ({
      ...glyph, x: glyph.x + layer.x
    })));
  }

  function spacerCode(advance) {
    return String.fromCodePoint(0xF000 + (advance < 0 ? 16 : 0) + Math.log2(Math.abs(advance)));
  }

  function spacing(advance) {
    let result = '';
    const direction = Math.sign(advance);
    let remaining = Math.abs(advance);
    while (remaining) {
      const step = Math.min(32768, 2 ** Math.floor(Math.log2(remaining)));
      result += spacerCode(direction * step);
      remaining -= step;
    }
    return result;
  }

  function component(layout, values) {
    let cursor = -Math.floor(layout.advance / 2);
    let text = '';
    for (const glyph of place(layout, values)) {
      text += spacing(glyph.x - cursor) + glyph.char;
      cursor = glyph.x + glyph.advance;
    }
    text += spacing(Math.ceil(layout.advance / 2) - cursor);
    return { text, font: layout.font, shadow_color: 0 };
  }

  function command(layout, values = {}, target = '@s') {
    const encoded = JSON.stringify(component(layout, values)).replace(/[^\x00-\x7f]/gu, char => {
      const code = char.codePointAt(0);
      const hex = code.toString(16).toUpperCase();
      return code <= 0xFFFF ? '\\u' + hex.padStart(4, '0') : '\\U' + hex.padStart(8, '0');
    });
    return '/title ' + target + ' actionbar ' + encoded;
  }

  const api = { place, component, spacerCode, command, barFrame, unicodeLabel };
  if (typeof module === 'object') module.exports = api;
  else root.FontUI = api;
})(globalThis);
