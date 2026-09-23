import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=resolve(process.argv[2]||'');
if(!basename(base).startsWith('zotero-codex-host-'))throw new Error('Requires isolated fixture');
const fixture=JSON.parse(await readFile(base+'/region-fixtures.json'));
const client=new Client({name:'region-smoke',version:'0.6.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp/server.mjs',import.meta.url)),'--connection-file',base+'/connection.json'],stderr:'pipe'}));
try{
 const result=await client.callTool({name:'zotero_get_selection',arguments:{readerID:fixture.readerID}});
 if(result.isError)throw new Error(result.content[0].text);
 const text=result.content.find(c=>c.type==='text').text,parsed=JSON.parse(text),image=result.content.find(c=>c.type==='image');
 const checks=[{name:'stdio-actual-region-image',pass:Boolean(image&&image.mimeType==='image/png'&&image.data.length>1000)},
 {name:'stdio-region-source',pass:parsed.selection.sourceURI.includes(fixture.annotationKey)&&parsed.selection.position.pageIndex===0},
 {name:'stdio-image-not-duplicated-in-text',pass:!text.includes('data:image/')&&parsed.selection.imageIndex===1}];
 if(image)await writeFile(base+'/region.png',Buffer.from(image.data,'base64'));
 await writeFile(base+'/region-stdio-result.json',JSON.stringify({checks},null,2));
 console.log(JSON.stringify({checks},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await client.close();}
