import fs from 'node:fs';
const html=fs.readFileSync('ui/index.html','utf8');const ui=html.split('<body>')[1].split('<script src="/app.js">')[0].replace(/<\/body>[\s\S]*/, '');
fs.writeFileSync('ui/generated.ts','export const ui = '+JSON.stringify(ui)+';\n');
