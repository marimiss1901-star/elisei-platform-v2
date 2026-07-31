(function () {
  'use strict';
  if (window.__ELISEI_EL_5319__) return;
  window.__ELISEI_EL_5319__ = true;

  var VERSION = '5.3.19';
  var HISTORY_KEY = 'elisei.el.history.v1';
  var CONVERSATION_KEY = 'elisei.el.conversation.v1';
  var SETTINGS_KEY = 'elisei.el.settings.v1';
  var MAX_LOCAL_MESSAGES = 40;
  var state = { open:false, busy:false, messages:loadHistory(), conversationId:localStorage.getItem(CONVERSATION_KEY) || randomId(), settings:loadSettings() };
  localStorage.setItem(CONVERSATION_KEY, state.conversationId);

  function randomId(){ return 'el_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10); }
  function loadHistory(){ try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').slice(-MAX_LOCAL_MESSAGES); } catch(e){ return []; } }
  function loadSettings(){ try { return Object.assign({allowWeb:true,humor:true}, JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')); } catch(e){ return {allowWeb:true,humor:true}; } }
  function save(){ localStorage.setItem(HISTORY_KEY, JSON.stringify(state.messages.slice(-MAX_LOCAL_MESSAGES))); localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }
  function escapeHtml(value){ return String(value||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function formatText(value){ return escapeHtml(value).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }

  function detectApiBase(){
    var explicit = window.__ELISEI_API_BASE__ || window.ELISEI_API_BASE || localStorage.getItem('ELISEI_API_BASE') || localStorage.getItem('elisei.apiBase');
    if (explicit) return String(explicit).replace(/\/$/,'').replace(/\/api$/,'');
    var entries = (performance.getEntriesByType && performance.getEntriesByType('resource')) || [];
    for (var i=entries.length-1;i>=0;i--){
      var name=String(entries[i].name||'');
      if (/\/api\//i.test(name)) { try { return new URL(name).origin; } catch(e){} }
    }
    return location.origin;
  }

  function cabinet(){
    var keys=['elisei.selectedCabinet','ELISEI_SELECTED_CABINET','selectedCabinet','wbCabinet'];
    for(var i=0;i<keys.length;i++){
      try { var raw=localStorage.getItem(keys[i]); if(!raw)continue; var obj=JSON.parse(raw); return {id:obj.id||obj.cabinetId||obj.value||raw,name:obj.name||obj.cabinetName||obj.label||'Основной кабинет'}; } catch(e){ if(localStorage.getItem(keys[i])) return {id:localStorage.getItem(keys[i]),name:'Основной кабинет'}; }
    }
    return {id:'main',name:'Основной кабинет'};
  }

  function period(){
    if(window.__ELISEI_PERIOD__) return window.__ELISEI_PERIOD__;
    var keys=['elisei.globalPeriod.v3','elisei.globalPeriod'];
    for(var i=0;i<keys.length;i++){ try { var raw=localStorage.getItem(keys[i]); if(raw)return JSON.parse(raw); } catch(e){} }
    return null;
  }

  function currentPage(){
    var heading=document.querySelector('main h1,main h2,[role="main"] h1,[role="main"] h2,h1');
    return {url:location.href,path:location.pathname,title:(heading&&heading.textContent||document.title||'').trim().slice(0,180)};
  }

  function screenContext(){
    var selectors=['main','[role="main"]','.dashboard-content','.content','.app-content'];
    var root=null; for(var i=0;i<selectors.length;i++){root=document.querySelector(selectors[i]);if(root)break;}
    root=root||document.body;
    var text=String(root.innerText||'').replace(/\s+/g,' ').trim();
    return {visibleText:text.slice(0,6500),section:sessionStorage.getItem('elisei.currentSection')||currentPage().title,period:period()};
  }

  function build(){
    var launcher=document.createElement('button'); launcher.id='elisei-el-launcher'; launcher.type='button'; launcher.innerHTML='<span class="el-avatar">◉</span><span>Спросить Эла</span>';
    var root=document.createElement('div'); root.id='elisei-el-root';
    root.innerHTML='<div class="el-backdrop" data-close></div><aside class="el-drawer" aria-label="Чат с Элом"><header class="el-head"><div class="el-head-avatar">◉</div><div class="el-head-copy"><strong>Эл</strong><small>Думаю, ищу, анализирую · v'+VERSION+'</small></div><button class="el-icon-btn" data-new title="Новый диалог">＋</button><button class="el-icon-btn" data-close title="Закрыть">×</button></header><div class="el-messages"></div><div class="el-quick"><button class="el-chip">Что важно сегодня?</button><button class="el-chip">Разбери рекламу за выбранный период</button><button class="el-chip">Поищи свежие тренды в интернете</button></div><div class="el-controls"><label class="el-toggle"><input type="checkbox" data-web> Интернет</label><label class="el-toggle"><input type="checkbox" data-humor> Можно с юмором</label><span style="margin-left:auto">Действия — только с подтверждением</span></div><div class="el-composer"><textarea rows="1" placeholder="Напиши Элу..."></textarea><button class="el-send" title="Отправить">➤</button></div></aside>';
    document.body.appendChild(launcher); document.body.appendChild(root);
    launcher.onclick=open; root.querySelectorAll('[data-close]').forEach(function(x){x.onclick=close;});
    root.querySelector('[data-new]').onclick=newConversation;
    root.querySelector('[data-web]').checked=state.settings.allowWeb; root.querySelector('[data-humor]').checked=state.settings.humor;
    root.querySelector('[data-web]').onchange=function(e){state.settings.allowWeb=e.target.checked;save();};
    root.querySelector('[data-humor]').onchange=function(e){state.settings.humor=e.target.checked;save();};
    root.querySelectorAll('.el-chip').forEach(function(x){x.onclick=function(){send(x.textContent);};});
    var textarea=root.querySelector('textarea'); textarea.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
    textarea.oninput=function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,150)+'px';};
    root.querySelector('.el-send').onclick=function(){send();};
    attachExistingButtons(); render();
  }

  function attachExistingButtons(){
    document.addEventListener('click',function(e){
      var button=e.target.closest&&e.target.closest('button,a,[role="button"]'); if(!button)return;
      var text=String(button.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
      if(text.indexOf('спросить эла')>=0&&button.id!=='elisei-el-launcher'){e.preventDefault();open();}
    },true);
  }
  function open(){state.open=true;document.getElementById('elisei-el-root').classList.add('el-open');render();setTimeout(function(){document.querySelector('#elisei-el-root textarea').focus();},180);}
  function close(){state.open=false;document.getElementById('elisei-el-root').classList.remove('el-open');}
  function newConversation(){ if(state.busy)return; state.conversationId=randomId();localStorage.setItem(CONVERSATION_KEY,state.conversationId);state.messages=[];save();render(); }

  function render(){
    var box=document.querySelector('#elisei-el-root .el-messages'); if(!box)return;
    var items=state.messages.slice();
    if(!items.length) items=[{role:'assistant',content:'Привет! Я Эл. Могу посмотреть текущий экран и выбранный период, разобраться с цифрами, поискать свежую информацию в интернете или просто обсудить, что происходит.'}];
    box.innerHTML=items.map(function(m){
      var sources=(m.sources||[]).map(function(s){return '<a class="el-source" target="_blank" rel="noopener noreferrer" href="'+escapeHtml(s.url)+'">'+escapeHtml(s.title||s.url)+'</a>';}).join('');
      var setup=m.setupRequired?'<div class="el-setup">На backend Render добавь секрет <b>OPENAI_API_KEY</b>, затем перезапусти сервис.</div>':'';
      return '<div class="el-message '+(m.role==='user'?'user':'assistant')+'"><div class="bubble">'+(m.role==='assistant'?'<span class="name">Эл</span>':'')+formatText(m.content)+setup+(sources?'<div class="el-sources">'+sources+'</div>':'')+'</div></div>';
    }).join('')+(state.busy?'<div class="el-thinking"><span class="el-dots"><i></i><i></i><i></i></span><span>'+(state.settings.allowWeb?'Эл думает и при необходимости ищет в интернете…':'Эл анализирует данные…')+'</span></div>':'');
    box.scrollTop=box.scrollHeight;
    var sendBtn=document.querySelector('#elisei-el-root .el-send'); if(sendBtn)sendBtn.disabled=state.busy;
  }

  async function postChat(payload){
    var base=detectApiBase(); var urls=[base+'/api/el/chat']; if(base!==location.origin)urls.push('/api/el/chat');
    var lastError;
    for(var i=0;i<urls.length;i++){
      try{
        var response=await fetch(urls[i],{method:'POST',headers:{'Content-Type':'application/json','X-Cabinet-Id':payload.cabinetId,'X-Cabinet-Name':encodeURIComponent(payload.cabinetName)},body:JSON.stringify(payload)});
        var data=await response.json().catch(function(){return {};});
        if(!response.ok) throw Object.assign(new Error(data.error||('HTTP '+response.status)),{data:data,status:response.status});
        localStorage.setItem('elisei.apiBase',new URL(urls[i],location.origin).origin); return data;
      }catch(error){lastError=error;}
    }
    throw lastError||new Error('Не удалось связаться с backend Эла.');
  }

  async function send(forced){
    if(state.busy)return; var textarea=document.querySelector('#elisei-el-root textarea'); var text=String(forced||textarea.value||'').trim(); if(!text)return;
    if(textarea){textarea.value='';textarea.style.height='auto';}
    state.messages.push({role:'user',content:text}); state.busy=true;save();render();
    var cab=cabinet();
    try{
      var data=await postChat({message:text,conversationId:state.conversationId,history:state.messages.slice(0,-1).slice(-18),allowWeb:state.settings.allowWeb,tone:state.settings.humor?'adaptive_playful':'professional',cabinetId:cab.id,cabinetName:cab.name,period:period(),page:currentPage(),screenContext:screenContext()});
      state.conversationId=data.conversationId||state.conversationId;localStorage.setItem(CONVERSATION_KEY,state.conversationId);
      state.messages.push({role:'assistant',content:data.answer||'Ответ не получен.',sources:data.sources||[]});
    }catch(error){
      var d=error.data||{}; state.messages.push({role:'assistant',content:d.error||error.message||'Не удалось получить ответ.',setupRequired:!!d.setupRequired});
    }finally{state.busy=false;save();render();}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
  window.ELISEI_EL={open:open,close:close,send:send,newConversation:newConversation,version:VERSION};
}());
