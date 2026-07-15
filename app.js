/* ==========================================================================
   STICKERSNAP — app.js
   100% client-side. No fetch(), no XMLHttpRequest, no analytics.
   Everything below runs on the Canvas API inside the user's own browser.
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     DOM references
     --------------------------------------------------------------------- */
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const dropzoneContent = document.getElementById('dropzoneContent');
  const uploadPreview = document.getElementById('uploadPreview');
  const uploadThumb = document.getElementById('uploadThumb');
  const uploadFilename = document.getElementById('uploadFilename');
  const uploadError = document.getElementById('uploadError');

  const canvas = document.getElementById('stickerCanvas');
  const ctx = canvas.getContext('2d');
  const canvasPlaceholder = document.getElementById('canvasPlaceholder');

  const textInput = document.getElementById('textInput');
  const fontSelect = document.getElementById('fontSelect');
  const colorInput = document.getElementById('colorInput');
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeValue = document.getElementById('sizeValue');
  const strokeToggle = document.getElementById('strokeToggle');
  const posButtons = Array.from(document.querySelectorAll('.pos-btn'));
  const addLayerBtn = document.getElementById('addLayerBtn');
  const layerList = document.getElementById('layerList');

  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const exportStatus = document.getElementById('exportStatus');

  const CANVAS_SIZE = 512;
  const MAX_BYTES = 100 * 1024; // WhatsApp sticker limit: 100KB

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */
  let sourceImage = null;   // the loaded HTMLImageElement
  let layers = [];          // array of text layer objects
  let selectedLayerId = null;
  let layerCounter = 0;

  function createLayer() {
    layerCounter += 1;
    return {
      id: layerCounter,
      text: 'Your text here',
      font: fontSelect.value,
      size: 40,
      color: '#ffffff',
      stroke: true,
      position: 'center'
    };
  }

  function getSelectedLayer() {
    return layers.find(function (l) { return l.id === selectedLayerId; }) || null;
  }

  /* ---------------------------------------------------------------------
     Upload handling (click + drag & drop)
     --------------------------------------------------------------------- */
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  function handleFile(file) {
    hideError();

    // Validate: must be an actual image type we support.
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (validTypes.indexOf(file.type) === -1) {
      showError('That file isn\u2019t a supported image. Please upload a JPG, PNG, or WebP.');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        sourceImage = img;

        // Show filename + thumbnail
        uploadFilename.textContent = file.name;
        uploadThumb.src = e.target.result;
        dropzoneContent.hidden = true;
        uploadPreview.hidden = false;

        // First upload gets a default text layer so the tool feels alive immediately.
        if (layers.length === 0) {
          const layer = createLayer();
          layers.push(layer);
          selectedLayerId = layer.id;
        }

        canvasPlaceholder.hidden = true;
        downloadBtn.disabled = false;
        renderLayerList();
        syncControlsToSelectedLayer();
        drawCanvas();
      };
      img.onerror = function () {
        showError('This image couldn\u2019t be read. Please try a different file.');
      };
      img.src = e.target.result;
    };
    reader.onerror = function () {
      showError('This file couldn\u2019t be read. Please try again.');
    };
    reader.readAsDataURL(file);
  }

  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.hidden = false;
  }
  function hideError() {
    uploadError.hidden = true;
    uploadError.textContent = '';
  }

  /* ---------------------------------------------------------------------
     Canvas rendering
     --------------------------------------------------------------------- */

  // Design choice: COVER-CROP instead of letterbox.
  // WhatsApp stickers are viewed at very small sizes in chat threads, so
  // letterboxing (adding blank bars to fit the whole photo) shrinks the
  // subject and leaves dead space that reads as a mistake at sticker scale.
  // Cropping the image to fully cover the 512x512 square keeps the subject
  // large and edge-to-edge, which is how virtually all real stickers look.
  function drawImageCover(image) {
    const srcRatio = image.width / image.height;
    const dstRatio = 1; // 512x512 is always square

    let sx, sy, sWidth, sHeight;

    if (srcRatio > dstRatio) {
      // Source is wider than square -> crop left/right, keep full height
      sHeight = image.height;
      sWidth = image.height * dstRatio;
      sx = (image.width - sWidth) / 2;
      sy = 0;
    } else {
      // Source is taller than square -> crop top/bottom, keep full width
      sWidth = image.width;
      sHeight = image.width / dstRatio;
      sx = 0;
      sy = (image.height - sHeight) / 2;
    }

    ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  function drawTextLayer(layer) {
    ctx.font = layer.size + 'px ' + layer.font;
    ctx.fillStyle = layer.color;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const lines = layer.text.split('\n');
    const lineHeight = layer.size * 1.15;
    const totalHeight = lineHeight * lines.length;

    let startY;
    if (layer.position === 'top') {
      ctx.textBaseline = 'top';
      startY = 24;
    } else if (layer.position === 'bottom') {
      ctx.textBaseline = 'bottom';
      startY = CANVAS_SIZE - 24 - totalHeight + lineHeight;
    } else {
      ctx.textBaseline = 'middle';
      startY = (CANVAS_SIZE - totalHeight) / 2 + lineHeight / 2;
    }

    lines.forEach(function (line, i) {
      const y = startY + i * lineHeight;
      const x = CANVAS_SIZE / 2;
      if (layer.stroke) {
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = Math.max(2, layer.size * 0.12);
        ctx.strokeText(line, x, y);
      }
      ctx.fillText(line, x, y);
    });
  }

  function drawCanvas() {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (!sourceImage) return;
    drawImageCover(sourceImage);
    layers.forEach(drawTextLayer);
  }

  /* ---------------------------------------------------------------------
     Controls <-> selected layer sync
     --------------------------------------------------------------------- */

  function syncControlsToSelectedLayer() {
    const layer = getSelectedLayer();
    if (!layer) return;
    textInput.value = layer.text;
    fontSelect.value = layer.font;
    colorInput.value = layer.color;
    sizeSlider.value = layer.size;
    sizeValue.textContent = layer.size;
    strokeToggle.checked = layer.stroke;
    posButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.pos === layer.position);
    });
  }

  function updateSelectedLayer(props) {
    const layer = getSelectedLayer();
    if (!layer) return;
    Object.assign(layer, props);
    renderLayerList();
    drawCanvas();
  }

  textInput.addEventListener('input', function () {
    updateSelectedLayer({ text: textInput.value || ' ' });
  });
  fontSelect.addEventListener('change', function () {
    updateSelectedLayer({ font: fontSelect.value });
  });
  colorInput.addEventListener('input', function () {
    updateSelectedLayer({ color: colorInput.value });
  });
  sizeSlider.addEventListener('input', function () {
    sizeValue.textContent = sizeSlider.value;
    updateSelectedLayer({ size: parseInt(sizeSlider.value, 10) });
  });
  strokeToggle.addEventListener('change', function () {
    updateSelectedLayer({ stroke: strokeToggle.checked });
  });
  posButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      posButtons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      updateSelectedLayer({ position: btn.dataset.pos });
    });
  });

  /* ---------------------------------------------------------------------
     Layer list (add / select / delete)
     --------------------------------------------------------------------- */

  addLayerBtn.addEventListener('click', function () {
    if (!sourceImage) return; // no point adding text before an image exists
    const layer = createLayer();
    layers.push(layer);
    selectedLayerId = layer.id;
    renderLayerList();
    syncControlsToSelectedLayer();
    drawCanvas();
  });

  function renderLayerList() {
    layerList.innerHTML = '';
    layers.forEach(function (layer, index) {
      const li = document.createElement('li');
      li.className = 'layer-item' + (layer.id === selectedLayerId ? ' selected' : '');

      const label = document.createElement('span');
      label.className = 'layer-text';
      label.textContent = 'Layer ' + (index + 1) + ': ' + (layer.text.split('\n')[0] || '(empty)');
      li.appendChild(label);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'layer-delete';
      delBtn.setAttribute('aria-label', 'Delete this text layer');
      delBtn.textContent = '\u2715';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteLayer(layer.id);
      });
      li.appendChild(delBtn);

      li.addEventListener('click', function () {
        selectedLayerId = layer.id;
        renderLayerList();
        syncControlsToSelectedLayer();
      });

      layerList.appendChild(li);
    });
  }

  function deleteLayer(id) {
    layers = layers.filter(function (l) { return l.id !== id; });
    if (selectedLayerId === id) {
      selectedLayerId = layers.length ? layers[layers.length - 1].id : null;
    }
    renderLayerList();
    if (selectedLayerId) syncControlsToSelectedLayer();
    drawCanvas();
  }

  /* ---------------------------------------------------------------------
     Export: canvas -> compressed WebP -> download
     --------------------------------------------------------------------- */

  downloadBtn.addEventListener('click', function () {
    if (!sourceImage) return;
    exportSticker();
  });

  function exportSticker() {
    setExportStatus('Processing\u2026', false);
    downloadBtn.disabled = true;

    // Give the UI a tick to paint the "Processing..." state before the
    // (synchronous-feeling) compression loop runs.
    setTimeout(function () {
      compressToLimit(function (blob, finalQuality) {
        downloadBtn.disabled = false;

        if (!blob) {
          setExportStatus('Export failed. Please try again.', true);
          return;
        }

        if (blob.size > MAX_BYTES) {
          setExportStatus(
            'Warning: this sticker is ' + Math.round(blob.size / 1024) +
            'KB even at maximum compression \u2014 over WhatsApp\u2019s 100KB limit. ' +
            'Try a simpler image or smaller text.',
            true
          );
        } else {
          setExportStatus(
            'Done \u2014 ' + Math.round(blob.size / 1024) + 'KB (quality ' +
            Math.round(finalQuality * 100) + '%).',
            false
          );
        }

        triggerDownload(blob);
      });
    }, 50);
  }

  // Tries decreasing WebP quality until the blob fits under MAX_BYTES,
  // or we hit a minimum quality floor.
  function compressToLimit(callback) {
    const qualities = [0.92, 0.8, 0.68, 0.56, 0.44, 0.32, 0.2, 0.1];
    let index = 0;
    let bestBlob = null;
    let bestQuality = qualities[0];

    function tryNext() {
      if (index >= qualities.length) {
        callback(bestBlob, bestQuality);
        return;
      }
      const q = qualities[index];
      canvas.toBlob(function (blob) {
        if (!blob) { index += 1; tryNext(); return; }
        // Keep track of the smallest/last attempted blob as a fallback.
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestQuality = q;
        }
        if (blob.size <= MAX_BYTES) {
          callback(blob, q);
          return;
        }
        index += 1;
        tryNext();
      }, 'image/webp', q);
    }

    tryNext();
  }

  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sticker.webp';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function setExportStatus(msg, isWarning) {
    exportStatus.textContent = msg;
    exportStatus.classList.toggle('warn', !!isWarning);
  }

  /* ---------------------------------------------------------------------
     Reset
     --------------------------------------------------------------------- */

  resetBtn.addEventListener('click', function () {
    sourceImage = null;
    layers = [];
    selectedLayerId = null;

    fileInput.value = '';
    dropzoneContent.hidden = false;
    uploadPreview.hidden = true;
    uploadThumb.src = '';
    uploadFilename.textContent = '';
    hideError();

    canvasPlaceholder.hidden = false;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    textInput.value = '';
    sizeSlider.value = 40;
    sizeValue.textContent = 40;
    colorInput.value = '#ffffff';
    strokeToggle.checked = true;
    posButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.pos === 'center'); });

    layerList.innerHTML = '';
    downloadBtn.disabled = true;
    setExportStatus('', false);
  });

  /* ---------------------------------------------------------------------
     Hamburger menu (used across all pages)
     --------------------------------------------------------------------- */

  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const siteNav = document.getElementById('siteNav');
  if (hamburgerBtn && siteNav) {
    hamburgerBtn.addEventListener('click', function () {
      const isOpen = siteNav.classList.toggle('open');
      hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
      hamburgerBtn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });

    // Close the mobile menu after a link is tapped.
    siteNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        siteNav.classList.remove('open');
        hamburgerBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

})();
        
