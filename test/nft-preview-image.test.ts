import {test} from 'node:test';import assert from 'node:assert/strict';import {PNG} from 'pngjs';import {nftPreviewResponse} from '../lib/nft-preview';import {nftSvg,nftMetadata} from '../lib/nft-art';
test('PNG previews preserve all five original background palettes and leave SVG metadata unchanged',async()=>{
 const backgrounds=[[44,34,57],[224,232,196],[17,23,16],[67,47,32],[16,44,52]];
 for(let id=1;id<=5;id++){
  const original=nftSvg(id),response=nftPreviewResponse(id+'.png');assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Set-Cookie'),null);assert.match(response.headers.get('Cache-Control')!,/immutable/);
  const bytes=Buffer.from(await response.arrayBuffer()),png=PNG.sync.read(bytes);assert.equal(png.width,560);assert.equal(png.height,560);const offset=(8*png.width+8)*4;assert.deepEqual([...png.data.subarray(offset,offset+4)],[...backgrounds[id-1],255]);let labelPixels=0;for(let y=499;y<521;y++)for(let x=226;x<339;x++){const at=(y*png.width+x)*4;if(png.data[at]!==16||png.data[at+1]!==23||png.data[at+2]!==15)labelPixels++;}assert.ok(labelPixels>20,'Serial label is rendered with the bundled font');assert.deepEqual(Buffer.from(await nftPreviewResponse(id+'.png').arrayBuffer()),bytes,'Cached image stays identical');assert.equal(nftSvg(id),original);assert.equal(decodeURIComponent(nftMetadata(id).image.split(',')[1]),original);
 }
 assert.equal(nftPreviewResponse('10000.png').status,200);
 for(const bad of ['0.png','10001.png','-1.png','1.svg','01.png','../1.png','1.png?invert=1'])assert.equal(nftPreviewResponse(bad).status,404,bad);
});
