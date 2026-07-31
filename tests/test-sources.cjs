'use strict';
const assert=require('node:assert');const {uniqueSources,outputText}=require('../payload/backend/src/services/elSources.cjs');
const response={output:[{type:'message',content:[{type:'output_text',text:'Готово',annotations:[{type:'url_citation',url:'https://example.com/a',title:'A'}]}]},{type:'web_search_call',action:{sources:[{url:'https://example.com/a',title:'A'},{url:'https://example.com/b',title:'B'}]}}]};
assert.equal(outputText(response),'Готово');assert.equal(uniqueSources(response).length,2);console.log('sources ok');
