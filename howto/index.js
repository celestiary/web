let contentElt;


function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.substring(1);
}


export function checkHash() {
  if (location.hash) {
    const hash = location.hash.substr(1);
    if (hash) {
      contentElt.src = hash;
    }
    const parts = hash.split(/[.-]/g);
    document.title = 'Celstiary - Guide: ' + capitalize(parts.slice(0, parts.length - 1).join(' '));
  } else {
    contentElt.src = 'welcome.html';
    document.title = 'Celstiary - Guide: Welcome';
  }
}


export function init() {
  contentElt = document.getElementById('content-frame');
  if (contentElt) {
    window.addEventListener('hashchange', () => {
        checkHash();
      });
    checkHash();
  } else {
    console.error('No content elt');
  }
}
