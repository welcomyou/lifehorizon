'use strict';
/* Kiểm tra cú pháp mọi file JS của ứng dụng: các file harness nạp + mọi khối <script> (src và inline)
   liệt kê trong index.html. */
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {html,root}=require('./harness');
const list=[];
[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{
  const src=m[1].match(/src="([^"]+)"/);
  if(src)list.push([src[1],fs.readFileSync(path.join(root,src[1].split(/[?#]/,1)[0]),'utf8')]);
  else if(m[2].trim())list.push(['index.html#inline'+(i+1),m[2]]);
});
for(const [name,src] of list)new vm.Script(src,{filename:name});
console.log('Syntax OK: '+list.map(x=>x[0]).join(', '));
