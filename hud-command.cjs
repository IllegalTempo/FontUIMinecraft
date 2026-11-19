const { readFileSync } = require('node:fs');
const { component, command } = require('./layout.js');

if (require.main === module) {
  try {
    const [, , path, json = '{}', target] = process.argv;
    if (!path) throw new Error('Usage: node hud-command.cjs fontui-layout.json "{\"health\":72}" [target]');
    const layout = JSON.parse(readFileSync(path, 'utf8'));
    const values = JSON.parse(json);
    if (layout.version !== 1 || layout.minecraft !== '26.3' || !Array.isArray(layout.layers)) {
      throw new Error('Expected a FontUI 26.3 layout manifest.');
    }
    if (!values || Array.isArray(values) || typeof values !== 'object') {
      throw new Error('Expected a JSON object of integer values.');
    }
    console.log(command(layout, values, target));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { command, component };
