const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, '..', 'server', 'models');

function removeCommentsFromFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  // Remove lines that contain comment: '...' or comment: "..."
  // Handle trailing commas and preserve valid JS syntax
  const before = content;
  content = content.replace(/\n\s*comment:\s*'[^']*',?/g, '\n');
  content = content.replace(/\n\s*comment:\s*"[^\"]*",?/g, '\n');
  if (content !== before) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

function walkDir(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const p = path.join(dir, item);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walkDir(p);
    else if (stat.isFile() && p.endsWith('.js')) {
      try {
        if (removeCommentsFromFile(p)) console.log('Edited:', p);
      } catch (err) {
        console.error('Error editing', p, err.message);
      }
    }
  }
}

walkDir(modelsDir);
console.log('Done');
