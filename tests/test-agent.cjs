'use strict';
const assert=require('node:assert');const {runElAgent}=require('../payload/backend/src/services/elAgent.cjs');
let round=0;const fake=async(payload)=>{round++;if(round===1)return{id:'1',output:[{type:'function_call',name:'get_business_snapshot',call_id:'c1',arguments:'{"focus":"прибыль"}'}]};return{id:'2',output_text:'Прибыль проверена.',output:[{type:'message',content:[{type:'output_text',text:'Прибыль проверена.',annotations:[]}]}]};};
const store={addMemory:async()=>({}),forgetByText:async()=>[]};
runElAgent({message:'Проверь',history:[],context:{profit:10},memories:[],identity:{userId:'u',cabinetId:'c',cabinetName:'C'},allowWeb:false,memoryStore:store,requestResponses:fake}).then((r)=>{assert.equal(r.text,'Прибыль проверена.');assert.equal(round,2);console.log('agent ok');}).catch((e)=>{console.error(e);process.exit(1);});
