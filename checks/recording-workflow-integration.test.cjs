const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('recorded melody reuse is initialized in the application and shipped offline',()=>{
 const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 assert.match(script,/import\s*\{\s*initializeMelodyReuse\s*\}\s*from\s*['"]\.\/js\/melodyReuse\.js['"]/);
 assert.match(script,/initializeMelodyReuse\s*\(/);
 assert.match(html,/href=["']melody-reuse\.css["']/);
 for(const asset of ['./js/melodyReuse.js','./melody-reuse.css']){
  assert.ok(sw.includes(`'${asset}'`),'service worker must cache '+asset);
  assert.ok(fs.statSync(path.join(root,asset)).isFile(),'actual asset must exist '+asset);
 }
 assert.notEqual(sw.match(/const CACHE_NAME = '([^']+)'/)[1],'metronominal-v196');
});
test('melody tracks expose reuse in both rendering paths and delegate an explicit local action',()=>{
 const tracks=fs.readFileSync(path.join(root,'js/tracksController.js'),'utf8');
 assert.ok((tracks.match(/class="track-reuse-notes-btn"/g)||[]).length===2);
 assert.match(tracks,/CustomEvent\(['"]melodyreuse['"]/);
});
