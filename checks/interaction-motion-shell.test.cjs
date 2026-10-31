'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('motion startup and offline assets reference real implementation files',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),script=fs.readFileSync(path.join(root,'script.js'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 for(const file of ['interaction-motion.css','js/interactionMotion.js']){assert(fs.statSync(path.join(root,file)).isFile());assert(sw.includes(`'./${file}'`),`${file} must be cached for the real offline app`);}
 assert(html.includes('href="interaction-motion.css"'));assert(script.includes('initializeInteractionMotion(document)'));
});
