'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('compact track icons are loaded and cached as actual assets',()=>{
 const html=fs.readFileSync('index.html','utf8'), sw=fs.readFileSync('sw.js','utf8');
 assert.match(html,/href=["']compact-track-icons\.css["']/);
 assert.ok(sw.includes("'./compact-track-icons.css'"));
 assert.ok(fs.statSync('compact-track-icons.css').isFile());
 assert.match(html,/href=["']track-compaction\.css["']/);
 assert.ok(sw.includes("'./track-compaction.css'"));
 assert.ok(fs.statSync('track-compaction.css').isFile());
});
