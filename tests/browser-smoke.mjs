import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
 await page.locator('#roomTitle').waitFor({state:'visible'});
 assert.equal(await page.locator('#rooms button').count(),4);
 await page.locator('#messageInput').fill('Test automatique WarLike');
 await page.locator('#send').click();
 await page.getByText('Test automatique WarLike',{exact:true}).waitFor();
 await page.reload();
 await page.getByText('Test automatique WarLike',{exact:true}).waitFor();
 await page.locator('#searchToggle').click();
 await page.locator('#search').fill('inexistant-qa');
 await page.getByText('Aucun résultat').waitFor();
 await page.locator('#closeSearch').click();
 await page.locator('#addRoom').click();
 await page.locator('#newRoomName').fill('Studio QA');
 await page.locator('#createRoom').click();
 assert.equal(await page.locator('#roomTitle').innerText(),'# Studio QA');
 assert.equal(await page.locator('#rooms button').count(),5);
 assert.deepEqual(errors,[]);
 console.log('PASS: Chat messages, persistence, search and room creation');
}finally{await browser.close();}
