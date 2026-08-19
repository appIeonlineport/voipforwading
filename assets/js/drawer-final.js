(()=>{
  if(!/index\.html$|\/$/.test(location.pathname)) return;
  const init=()=>{
    const btn=document.getElementById('nxStaticMenu');
    const sidebar=document.querySelector('.sidebar');
    if(!btn||!sidebar) return;
    let overlay=document.querySelector('.nx-overlay');
    if(!overlay){overlay=document.createElement('div');overlay.className='nx-overlay';document.body.appendChild(overlay)}
    // phase1's legacy drawer used the onclick property. Clear it so this is the
    // single authoritative mobile drawer controller.
    btn.onclick=null;
    const close=()=>{sidebar.classList.remove('nx-open');overlay.classList.remove('nx-open');document.body.classList.remove('nx-menu-open');btn.setAttribute('aria-expanded','false')};
    const toggle=(e)=>{e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();const open=!sidebar.classList.contains('nx-open');sidebar.classList.toggle('nx-open',open);overlay.classList.toggle('nx-open',open);document.body.classList.toggle('nx-menu-open',open);btn.setAttribute('aria-expanded',open?'true':'false')};
    btn.addEventListener('click',toggle,true);
    overlay.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();close()},true);
    document.addEventListener('click',e=>{const nav=e.target.closest('.sidebar .nav-btn[data-page]');if(nav&&innerWidth<=760)setTimeout(close,0)},true);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  import('./customer-cap.js?v=202608190740').catch(error=>console.error('NX customer CC/CAP controls failed',error));
})();
