import { OutputScale, RenderingCancelledException } from "pdfjs-lib";
import { RenderingStates } from "./ui_utils.js";

const DRAW_UPSCALE_FACTOR = 2; // See comment in `PDFThumbnailView.draw` below.
const MAX_NUM_SCALING_STEPS = 3;
const THUMBNAIL_WIDTH = 128; // px

class TempImageFactory {
  static #tempCanvas = null;

  static getCanvas(width, height) {
    const tempCanvas = (this.#tempCanvas ||= document.createElement("canvas"));
    tempCanvas.width = width;
    tempCanvas.height = height;

    // Since this is a temporary canvas, we need to fill it with a white
    // background ourselves. `#getPageDrawContext` uses CSS rules for this.
    const ctx = tempCanvas.getContext("2d", { alpha: false });
    ctx.save();
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return [tempCanvas, tempCanvas.getContext("2d")];
  }

  static destroyCanvas() {
    const tempCanvas = this.#tempCanvas;
    if (tempCanvas) {
      // Zeroing the width and height causes Firefox to release graphics
      // resources immediately, which can greatly reduce memory consumption.
      tempCanvas.width = 0;
      tempCanvas.height = 0;
    }
    this.#tempCanvas = null;
  }
}

/**
 * @implements {IRenderableView}
 */
class PDFThumbnailView {
  /**
   * @param {PDFThumbnailViewOptions} options
   */
  constructor({
    container,
    eventBus,
    id,
    defaultViewport,
    optionalContentConfigPromise,
    linkService,
    renderingQueue,
    pageColors,
    enableHWA,
  }) {
    this.id = id;
    this.renderingId = "thumbnail" + id;
    this.pageLabel = null;

    this.pdfPage = null;
    this.rotation = 0;
    this.viewport = defaultViewport;
    this.pdfPageRotate = defaultViewport.rotation;
    this._optionalContentConfigPromise = optionalContentConfigPromise || null;
    this.pageColors = pageColors || null;
    this.enableHWA = enableHWA || false;

    this.eventBus = eventBus;
    this.linkService = linkService;
    this.renderingQueue = renderingQueue;

    this.renderTask = null;
    this.renderingState = RenderingStates.INITIAL;
    this.resume = null;

    // Create the anchor element
    const anchor = document.createElement("a");
    anchor.href = linkService.getAnchorUrl("#page=" + id);
    anchor.setAttribute("data-l10n-id", "pdfjs-thumb-page-title");
    anchor.setAttribute("data-l10n-args", this.#pageL10nArgs);
    anchor.onclick = function () {
      linkService.goToPage(id);
      return false;
    };
    this.anchor = anchor;

    // Call the setupLayout method to construct the thumbnail layout
    this.setupLayout(container, anchor);
  }

  /**
   * Sets up the layout of the thumbnail, including the image and action buttons.
   * @param {HTMLElement} container - The container to append the thumbnail to.
   * @param {HTMLElement} anchor - The anchor element wrapping the thumbnail.
   */
  setupLayout(container, anchor) {
    // Create the thumbnail container
    const div = document.createElement("div");
    div.className = "thumbnail";
    div.setAttribute("data-page-number", this.id);
    this.div = div;
    this.#updateDims();

    // Create the image placeholder
    const img = document.createElement("div");
    img.className = "thumbnailImage";
    this._placeholderImg = img;

    div.append(img);

    // Create the actions container with buttons
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "actions";

    // Define the buttons and their corresponding icons and tooltips
    const buttons = [
      { class: "trash-icon", src: "./images/action-trash.png", tooltip: "Delete Page" },
      { class: "copy-icon", src: "./images/action-copy.png", tooltip: "Copy Page" },
      { class: "download-icon", src: "./images/action-download.png", tooltip: "Download Page" },
      { class: "rotate-icon", src: "./images/action-rotate.png", tooltip: "Rotate PDF" },
    ];

    // Create and append each button to the actions container
    buttons.forEach((btn) => {
      const button = document.createElement("button");
      button.className = "action-button";
      button.title = btn.tooltip;
      button.setAttribute("aria-label", btn.tooltip); // For accessibility
  
      // Create the img element for the icon
      const iconImg = document.createElement("img");
      iconImg.className = `icon ${btn.class}`;
      iconImg.src = btn.src;
      iconImg.alt = btn.alt; 
      iconImg.width = 16;
      iconImg.height = 16;
  
      button.appendChild(iconImg);
  
      // Add event listeners for each button
      button.addEventListener("click", (event) => {
        event.stopPropagation(); // Prevent triggering the thumbnail click
        this.handleActionButtonClick(btn.class);
      });
  
      actionsDiv.appendChild(button);
    });

    div.appendChild(actionsDiv); // Append actions to the thumbnail div

    // Append the thumbnail to the anchor and container
    anchor.append(div);
    container.append(anchor);
  }

  #updateDims() {
    const { width, height } = this.viewport;
    const ratio = width / height;

    this.canvasWidth = THUMBNAIL_WIDTH;
    this.canvasHeight = (this.canvasWidth / ratio) | 0;
    this.scale = this.canvasWidth / width;

    const { style } = this.div;
    style.setProperty("--thumbnail-width", `${this.canvasWidth}px`);
    style.setProperty("--thumbnail-height", `${this.canvasHeight}px`);
  }

  setPdfPage(pdfPage) {
    this.pdfPage = pdfPage;
    this.pdfPageRotate = pdfPage.rotate;
    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = pdfPage.getViewport({ scale: 1, rotation: totalRotation });
    this.reset();
  }

  reset() {
    this.cancelRendering();
    this.renderingState = RenderingStates.INITIAL;

    this.div.removeAttribute("data-loaded");
    this.image?.replaceWith(this._placeholderImg);
    this.#updateDims();

    if (this.image) {
      this.image.removeAttribute("src");
      delete this.image;
    }
  }

  update({ rotation = null }) {
    if (typeof rotation === "number") {
      this.rotation = rotation; // The rotation may be zero.
    }
    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = this.viewport.clone({
      scale: 1,
      rotation: totalRotation,
    });
    this.reset();
  }

  /**
   * PLEASE NOTE: Most likely you want to use the `this.reset()` method,
   *              rather than calling this one directly.
   */
  cancelRendering() {
    if (this.renderTask) {
      this.renderTask.cancel();
      this.renderTask = null;
    }
    this.resume = null;
  }

  #getPageDrawContext(upscaleFactor = 1, enableHWA = this.enableHWA) {
    // Keep the no-thumbnail outline visible, i.e. `data-loaded === false`,
    // until rendering/image conversion is complete, to avoid display issues.
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: !enableHWA,
    });
    const outputScale = new OutputScale();

    canvas.width = (upscaleFactor * this.canvasWidth * outputScale.sx) | 0;
    canvas.height = (upscaleFactor * this.canvasHeight * outputScale.sy) | 0;

    const transform = outputScale.scaled
      ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
      : null;

    return { ctx, canvas, transform };
  }

  #convertCanvasToImage(canvas) {
    if (this.renderingState !== RenderingStates.FINISHED) {
      throw new Error("#convertCanvasToImage: Rendering has not finished.");
    }
    const reducedCanvas = this.#reduceImage(canvas);

    const image = document.createElement("img");
    image.className = "thumbnailImage";
    image.setAttribute("data-l10n-id", "pdfjs-thumb-page-canvas");
    image.setAttribute("data-l10n-args", this.#pageL10nArgs);
    image.src = reducedCanvas.toDataURL();
    this.image = image;

    this.div.setAttribute("data-loaded", true);
    this._placeholderImg.replaceWith(image);

    // Zeroing the width and height causes Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    reducedCanvas.width = 0;
    reducedCanvas.height = 0;
  }

  async #finishRenderTask(renderTask, canvas, error = null) {
    // The renderTask may have been replaced by a new one, so only remove
    // the reference to the renderTask if it matches the one that is
    // triggering this callback.
    if (renderTask === this.renderTask) {
      this.renderTask = null;
    }

    if (error instanceof RenderingCancelledException) {
      return;
    }
    this.renderingState = RenderingStates.FINISHED;
    this.#convertCanvasToImage(canvas);

    if (error) {
      throw error;
    }
  }

  async draw() {
    if (this.renderingState !== RenderingStates.INITIAL) {
      console.error("Must be in new state before drawing");
      return undefined;
    }
    const { pdfPage } = this;

    if (!pdfPage) {
      this.renderingState = RenderingStates.FINISHED;
      throw new Error("pdfPage is not loaded");
    }

    this.renderingState = RenderingStates.RUNNING;

    // Render the thumbnail at a larger size and downsize the canvas (similar
    // to `setImage`), to improve consistency between thumbnails created by
    // the `draw` and `setImage` methods (fixes issue 8233).
    // NOTE: To primarily avoid increasing memory usage too much, but also to
    //   reduce downsizing overhead, we purposely limit the up-scaling factor.
    const { ctx, canvas, transform } =
      this.#getPageDrawContext(DRAW_UPSCALE_FACTOR);
    const drawViewport = this.viewport.clone({
      scale: DRAW_UPSCALE_FACTOR * this.scale,
    });
    const renderContinueCallback = cont => {
      if (!this.renderingQueue.isHighestPriority(this)) {
        this.renderingState = RenderingStates.PAUSED;
        this.resume = () => {
          this.renderingState = RenderingStates.RUNNING;
          cont();
        };
        return;
      }
      cont();
    };

    const renderContext = {
      canvasContext: ctx,
      transform,
      viewport: drawViewport,
      optionalContentConfigPromise: this._optionalContentConfigPromise,
      pageColors: this.pageColors,
    };
    const renderTask = (this.renderTask = pdfPage.render(renderContext));
    renderTask.onContinue = renderContinueCallback;

    const resultPromise = renderTask.promise.then(
      () => this.#finishRenderTask(renderTask, canvas),
      error => this.#finishRenderTask(renderTask, canvas, error)
    );
    resultPromise.finally(() => {
      // Zeroing the width and height causes Firefox to release graphics
      // resources immediately, which can greatly reduce memory consumption.
      canvas.width = 0;
      canvas.height = 0;

      this.eventBus.dispatch("thumbnailrendered", {
        source: this,
        pageNumber: this.id,
        pdfPage: this.pdfPage,
      });
    });

    return resultPromise;
  }

  setImage(pageView) {
    if (this.renderingState !== RenderingStates.INITIAL) {
      return;
    }
    const { thumbnailCanvas: canvas, pdfPage, scale } = pageView;
    if (!canvas) {
      return;
    }
    if (!this.pdfPage) {
      this.setPdfPage(pdfPage);
    }
    if (scale < this.scale) {
      // Avoid upscaling the image, since that makes the thumbnail look blurry.
      return;
    }
    this.renderingState = RenderingStates.FINISHED;
    this.#convertCanvasToImage(canvas);
  }

  #reduceImage(img) {
    const { ctx, canvas } = this.#getPageDrawContext(1, true);

    if (img.width <= 2 * canvas.width) {
      ctx.drawImage(
        img,
        0,
        0,
        img.width,
        img.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
      return canvas;
    }
    // drawImage does an awful job of rescaling the image, doing it gradually.
    let reducedWidth = canvas.width << MAX_NUM_SCALING_STEPS;
    let reducedHeight = canvas.height << MAX_NUM_SCALING_STEPS;
    const [reducedImage, reducedImageCtx] = TempImageFactory.getCanvas(
      reducedWidth,
      reducedHeight
    );

    while (reducedWidth > img.width || reducedHeight > img.height) {
      reducedWidth >>= 1;
      reducedHeight >>= 1;
    }
    reducedImageCtx.drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
      0,
      0,
      reducedWidth,
      reducedHeight
    );
    while (reducedWidth > 2 * canvas.width) {
      reducedImageCtx.drawImage(
        reducedImage,
        0,
        0,
        reducedWidth,
        reducedHeight,
        0,
        0,
        reducedWidth >> 1,
        reducedHeight >> 1
      );
      reducedWidth >>= 1;
      reducedHeight >>= 1;
    }
    ctx.drawImage(
      reducedImage,
      0,
      0,
      reducedWidth,
      reducedHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }

  get #pageL10nArgs() {
    return JSON.stringify({ page: this.pageLabel ?? this.id });
  }

  /**
   * @param {string|null} label
   */
  setPageLabel(label) {
    this.pageLabel = typeof label === "string" ? label : null;

    this.anchor.setAttribute("data-l10n-args", this.#pageL10nArgs);

    if (this.renderingState !== RenderingStates.FINISHED) {
      return;
    }
    this.image?.setAttribute("data-l10n-args", this.#pageL10nArgs);
  }

  /**
   * Handle action button clicks based on the button class.
   * @param {string} action - The action corresponding to the button clicked.
   */
  handleActionButtonClick(action) {
    switch (action) {
      case "trash-icon":
        this.deletePage();
        break;
      case "duplicate-icon":
        this.duplicatePage();
        break;
      case "download-icon":
        this.downloadPage();
        break;
      case "refresh-icon":
        this.refreshThumbnail();
        break;
      default:
        console.warn(`Unhandled action: ${action}`);
    }
  }

  /**
   * Delete the current page.
   */
  deletePage() {
    // Implement the logic to delete the page
    console.log(`Deleting page ${this.id}`);
    // Example: Emit an event or directly interact with the PDF document
    this.eventBus.dispatch("deletepage", { pageNumber: this.id });
  }

  /**
   * Duplicate the current page.
   */
  duplicatePage() {
    // Implement the logic to duplicate the page
    console.log(`Duplicating page ${this.id}`);
    // Example: Emit an event or directly interact with the PDF document
    this.eventBus.dispatch("duplicatepage", { pageNumber: this.id });
  }

  /**
   * Download the current page as a PDF or image.
   */
  downloadPage() {
    // Implement the logic to download the page
    console.log(`Downloading page ${this.id}`);
    // Example: Use pdfPage.render to generate a downloadable file
    if (this.pdfPage) {
      const viewport = this.pdfPage.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      this.pdfPage.render(renderContext).promise.then(() => {
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `page-${this.id}.png`;
          a.click();
          URL.revokeObjectURL(url);
        });
      });
    }
  }

  /**
   * Refresh the thumbnail image.
   */
  refreshThumbnail() {
    // Implement the logic to refresh the thumbnail
    console.log(`Refreshing thumbnail for page ${this.id}`);
    this.reset();
    this.draw();
  }
}

export { PDFThumbnailView, TempImageFactory };
