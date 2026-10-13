import test from 'node:test';
import assert from 'node:assert/strict';
import {portableArticle} from '../server/article-export.js';
import {ruleVariant,stamp,uid,validateVariant} from '../server/domain.js';
import {platformById} from '../server/catalog.js';
import type {Content,Media} from '../server/types.js';

test('portable article retains inline positions, embeds each local image and adds remaining attachments once',async()=>{
 const media:Media[]=[{id:uid(),name:'inline.png',url:'/uploads/inline.png',mime:'image/png',size:3},{id:uid(),name:'gallery <img onerror=x>.png',url:'/uploads/gallery.png',mime:'image/png',size:3}];
 const content:Content={id:uid(),title:'Title <script>alert(1)</script>',source:'Before\n\n![Screenshot](/uploads/inline.png)\n\nAfter\n\n<script>alert(1)</script>',media,createdAt:stamp(),updatedAt:stamp()};
 const variant=ruleVariant(content,platformById('wechat'));let reads=0;
 const html=await portableArticle(variant,content,async()=>{reads++;return new Uint8Array([1,2,3]);});
 assert.equal(reads,2);assert.equal((html.match(/<img /g)||[]).length,2);assert.equal((html.match(/src="data:image\/png;base64,AQID"/g)||[]).length,2);
 assert.ok(html.indexOf('Before')<html.indexOf('<img'));assert.ok(html.indexOf('<img')<html.indexOf('After'));
 assert.ok(!html.includes('src="/uploads/'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror=x>'));
 const broken={...variant,body:'![Missing](/uploads/missing.png)'};
 assert.ok(validateVariant(broken,platformById('wechat'),content).some(i=>i.severity==='error'&&i.message.includes('未关联')));
 await assert.rejects(portableArticle(broken,content,async()=>new Uint8Array()),/未关联/);
});

test('XHS validation includes hashtag length and catches excess attached images',()=>{
 const p=platformById('xiaohongshu');const content:Content={id:uid(),title:'Title',source:'Short',media:Array.from({length:19},(_,i)=>({id:uid(),name:`${i}.png`,url:`/uploads/${i}.png`,mime:'image/png',size:1})),createdAt:stamp(),updatedAt:stamp()};
 const v={...ruleVariant(content,p),body:'a'.repeat(p.bodyLimit-1),tags:['tool']};
 const errors=validateVariant(v,p,content).filter(i=>i.severity==='error');assert.ok(errors.some(i=>i.message.includes('18')));assert.ok(errors.some(i=>i.message.includes('话题标签合计')));
});
