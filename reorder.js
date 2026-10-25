// Drag to reorder, built on pointer events so the same handle works with a finger on iPhone and a mouse on Mac.
// The dragged element is hidden, a floating copy follows the pointer, and a placeholder shows where it will land.

/**
 * ev      the pointerdown event on a drag handle
 * el      the element being moved
 * cfg.locate(under, x, y) -> { ref, after } to place next to an element, or { parent, first } to place inside a container, or null
 * cfg.onStart()           called before measuring (e.g. to collapse groups)
 * cfg.onDrop(el)          called after el is moved to its new place in the DOM
 * cfg.onCancel()          called when the drag is aborted
 */
export function beginDrag(ev, el, cfg) {
  ev.preventDefault();
  if (cfg.onStart) cfg.onStart(); // may change the layout (e.g. collapse groups)
  const rect = el.getBoundingClientRect();
  // Keep the grabbed handle under the finger, even if the layout just moved.
  let offsetY = ev.clientY - rect.top;
  if (cfg.anchor) { const a = cfg.anchor.getBoundingClientRect(); offsetY = a.top + a.height / 2 - rect.top; }
  let x = ev.clientX, y = ev.clientY, raf = 0, ended = false;

  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('id');
  Object.assign(ghost.style, { position: 'fixed', left: rect.left + 'px', top: (y - offsetY) + 'px', width: rect.width + 'px', margin: '0', pointerEvents: 'none', zIndex: '200' });
  const ph = document.createElement(el.tagName === 'LI' ? 'li' : 'div');
  ph.className = 'drag-ph';
  ph.style.height = rect.height + 'px';
  el.parentNode.insertBefore(ph, el);
  el.style.display = 'none';
  document.body.appendChild(ghost);
  document.body.classList.add('dragging');
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }

  function place() {
    const under = document.elementFromPoint(x, y);
    if (!under) return;
    const spot = cfg.locate(under, x, y);
    if (!spot) return;
    if (spot.ref) {
      if (spot.ref === ph || spot.ref === el) return;
      const target = spot.after ? spot.ref.nextSibling : spot.ref;
      if (target === ph) return;
      spot.ref.parentNode.insertBefore(ph, target);
    } else if (spot.parent) {
      if (spot.first) { if (spot.parent.firstChild !== ph) spot.parent.insertBefore(ph, spot.parent.firstChild); }
      else if (spot.parent.lastChild !== ph) spot.parent.appendChild(ph);
    }
  }
  function frame() {
    raf = 0;
    if (ended) return;
    const edge = 72, bottomEdge = window.innerHeight - 150;
    let dy = 0;
    if (y < edge) dy = -Math.ceil((edge - y) / 6);
    else if (y > bottomEdge) dy = Math.ceil((y - bottomEdge) / 6);
    if (dy) { window.scrollBy(0, dy); place(); raf = requestAnimationFrame(frame); }
  }
  function move(e) {
    if (e.pointerId !== ev.pointerId) return;
    e.preventDefault();
    x = e.clientX; y = e.clientY;
    ghost.style.top = (y - offsetY) + 'px';
    place();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function finish(commit) {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    ph.parentNode.insertBefore(el, ph);
    ph.remove();
    ghost.remove();
    el.style.display = '';
    document.body.classList.remove('dragging');
    if (commit) cfg.onDrop(el); else if (cfg.onCancel) cfg.onCancel();
  }
  function up(e) { if (e.pointerId === ev.pointerId) finish(true); }
  function cancel(e) { if (e.pointerId === ev.pointerId) finish(true); }
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  place();
}
