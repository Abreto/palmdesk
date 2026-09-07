const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Upstream's build suppresses tsc failures. Transpile explicitly, failing on syntax errors.
const config = ts.readConfigFile('tsconfig.prod.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: process.cwd,
  getNewLine: () => '\n',
}));
fs.rmSync('dist', { recursive: true, force: true });
for (const file of parsed.fileNames) {
  if (file.endsWith('.d.ts')) continue;
  const relative = path.relative(path.resolve('src'), file);
  if (relative.startsWith('..')) throw new Error(`Unexpected source: ${file}`);
  const destination = path.join('dist', relative.replace(/\.tsx?$/, '.js'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!/\.tsx?$/.test(file)) {
    fs.copyFileSync(file, destination);
    continue;
  }
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: parsed.options,
    fileName: file,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(`${file}: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n')}`);
  fs.writeFileSync(destination, result.outputText);
}
console.log('Backend JavaScript compiled (transpile only; no upstream typecheck).');
