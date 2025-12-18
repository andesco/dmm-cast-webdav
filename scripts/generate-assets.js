#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '../public');
const outputFile = join(__dirname, '../src/public-assets.js');

// Recursively get all files in a directory
function getAllFiles(dir, fileList = []) {
    const files = readdirSync(dir);
    
    files.forEach(file => {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        
        if (stat.isDirectory()) {
            getAllFiles(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    });
    
    return fileList;
}

// Get MIME type from extension
function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'css': 'text/css',
        'xml': 'application/xml',
        'txt': 'text/plain',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

console.log('Scanning public directory...');
const allFiles = getAllFiles(publicDir);
console.log(`Found ${allFiles.length} files`);

// Generate the assets object
let output = '// Auto-generated file - do not edit manually\n';
output += '// Run: node scripts/generate-assets.js to regenerate\n\n';
output += 'export const publicAssets = {\n';

const assetMetadata = [];

allFiles.forEach(filePath => {
    const relativePath = relative(publicDir, filePath);

    // Skip .DS_Store files
    if (relativePath.includes('.DS_Store')) {
        return;
    }

    const base64 = readFileSync(filePath).toString('base64');
    const mimeType = getMimeType(relativePath);
    const size = statSync(filePath).size;

    // Use path as key (with forward slashes)
    const key = relativePath.replace(/\\/g, '/');

    output += `    '${key}': '${base64}',\n`;

    assetMetadata.push({ path: key, mimeType, size });
    console.log(`  ${key} (${size} bytes, ${mimeType})`);
});

output += '};\n\n';

// Add metadata for MIME types and file info
output += 'export const assetMetadata = {\n';
assetMetadata.forEach(({ path, mimeType, size }) => {
    output += `    '${path}': { mimeType: '${mimeType}', size: ${size} },\n`;
});
output += '};\n';

writeFileSync(outputFile, output);
console.log(`\nGenerated ${outputFile}`);
console.log(`Total size: ${Math.round(output.length / 1024)}KB`);
