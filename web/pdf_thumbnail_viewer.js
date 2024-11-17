/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** @typedef {import("../src/display/api").PDFDocumentProxy} PDFDocumentProxy */
/** @typedef {import("../src/display/api").PDFPageProxy} PDFPageProxy */
/** @typedef {import("./event_utils").EventBus} EventBus */
/** @typedef {import("./interfaces").IPDFLinkService} IPDFLinkService */
// eslint-disable-next-line max-len
/** @typedef {import("./pdf_rendering_queue").PDFRenderingQueue} PDFRenderingQueue */

import {
  getVisibleElements,
  isValidRotation,
  RenderingStates,
  scrollIntoView,
  watchScroll,
} from "./ui_utils.js";
import { PDFThumbnailView, TempImageFactory } from "./pdf_thumbnail_view.js";

const THUMBNAIL_SCROLL_MARGIN = -19;
const THUMBNAIL_SELECTED_CLASS = "selected";

/**
 * @typedef {Object} PDFThumbnailViewerOptions
 * @property {HTMLDivElement} container - The container for the thumbnail
 *   elements.
 * @property {EventBus} eventBus - The application event bus.
 * @property {IPDFLinkService} linkService - The navigation/linking service.
 * @property {PDFRenderingQueue} renderingQueue - The rendering queue object.
 * @property {Object} [pageColors] - Overwrites background and foreground colors
 *   with user defined ones in order to improve readability in high contrast
 *   mode.
 * @property {AbortSignal} [abortSignal] - The AbortSignal for the window
 *   events.
 * @property {boolean} [enableHWA] - Enables hardware acceleration for
 *   rendering. The default value is `false`.
 */

/**
 * Viewer control to display thumbnails for pages in a PDF document.
 */
class PDFThumbnailViewer {
  /**
   * @param {PDFThumbnailViewerOptions} options
   */
  constructor({
    container,
    eventBus,
    linkService,
    renderingQueue,
    pageColors,
    abortSignal,
    enableHWA,
    documentsResponse
  }) {
    this.container = container;
    this.eventBus = eventBus;
    this.linkService = linkService;
    this.renderingQueue = renderingQueue;
    this.pageColors = pageColors || null;
    this.enableHWA = enableHWA || false;
    this.documentsResponse = documentsResponse;
    this._documentsData = this.initializeDocuments(documentsResponse);
    this.scroll = watchScroll(
      this.container,
      this.#scrollUpdated.bind(this),
      abortSignal
    );
    this.#resetView();
  }

  initializeDocuments(documents) {
    const docs = documents.map((doc, docIndex) => ({
      ...doc,
      id: `doc-${docIndex}`, // Unique ID for the document
      pages: doc.pages.map((pageNumber, pageIndex) => ({
        pageNumber,
        id: `doc-${docIndex}-page-${pageIndex}`, // Unique ID for each page
      })),
    }));
    return docs;
  }

  setDocumentsData(documentsData) {
    this._documentsData = documentsData;
    this.#renderDocuments();
  }

  #scrollUpdated() {
    this.renderingQueue.renderHighestPriority();
  }

  getThumbnail(index) {
    return this._thumbnails[index];
  }

  #getVisibleThumbs() {
    return getVisibleElements({
      scrollEl: this.container,
      views: this._thumbnails,
    });
  }

  scrollThumbnailIntoView(pageNumber) {
    if (!this.pdfDocument) {
      return;
    }
    const thumbnailView = this._thumbnails.find(
      (thumb) => thumb.id === pageNumber
    );
  
    if (!thumbnailView) {
      console.error('scrollThumbnailIntoView: Invalid "pageNumber" parameter.');
      return;
    }
  
    // Find the .document-container ancestor of thumbnailView.div
    const docContainer = thumbnailView.div.closest('.document-container');
  
    if (!docContainer) {
      console.error(
        'scrollThumbnailIntoView: Unable to find document container for page number:',
        pageNumber
      );
      return;
    }
  
    // Optionally, handle highlighting of the document container
    if (this._currentDocumentContainer) {
      this._currentDocumentContainer.classList.remove('selected-document-container');
    }
    docContainer.classList.add('selected-document-container');
    this._currentDocumentContainer = docContainer;
  
    // Scroll the document container into view
    scrollIntoView(docContainer, { top: THUMBNAIL_SCROLL_MARGIN });
  
    // Update the current page number
    this._currentPageNumber = pageNumber;
  }

  get pagesRotation() {
    return this._pagesRotation;
  }

  set pagesRotation(rotation) {
    if (!isValidRotation(rotation)) {
      throw new Error("Invalid thumbnails rotation angle.");
    }
    if (!this.pdfDocument) {
      return;
    }
    if (this._pagesRotation === rotation) {
      return; // The rotation didn't change.
    }
    this._pagesRotation = rotation;

    const updateArgs = { rotation };
    for (const thumbnail of this._thumbnails) {
      thumbnail.update(updateArgs);
    }
  }

  cleanup() {
    for (const thumbnail of this._thumbnails) {
      if (thumbnail.renderingState !== RenderingStates.FINISHED) {
        thumbnail.reset();
      }
    }
    TempImageFactory.destroyCanvas();
  }

  #resetView() {
    this._thumbnails = [];
    this._currentPageNumber = 1;
    this._pageLabels = null;
    this._pagesRotation = 0;
  
    // Remove the thumbnails from the DOM.
    this.container.textContent = "";
  }

  /**
   * @param {PDFDocumentProxy} pdfDocument
   */
  setDocument(pdfDocument) {
    if (this.pdfDocument) {
      this.#cancelRendering();
      this.#resetView();
    }

    this.pdfDocument = pdfDocument;
    if (!pdfDocument) {
      return;
    }
    const firstPagePromise = pdfDocument.getPage(1);
    const optionalContentConfigPromise = pdfDocument.getOptionalContentConfig({
      intent: "display",
    });

    firstPagePromise
      .then(firstPdfPage => {
        const viewport = firstPdfPage.getViewport({ scale: 1 });
        this._defaultViewport = viewport;
        this.#renderDocuments();
        this.scrollThumbnailIntoView(1);
      })
      .catch(reason => {
        console.error("Unable to initialize thumbnail viewer", reason);
      });
  }

  #cancelRendering() {
    for (const thumbnail of this._thumbnails) {
      thumbnail.cancelRendering();
    }
  }

  /**
   * @param {Array|null} labels
   */
  setPageLabels(labels) {
    if (!this.pdfDocument) {
      return;
    }
    if (!labels) {
      this._pageLabels = null;
    } else if (
      !(Array.isArray(labels) && this.pdfDocument.numPages === labels.length)
    ) {
      this._pageLabels = null;
      console.error("PDFThumbnailViewer_setPageLabels: Invalid page labels.");
    } else {
      this._pageLabels = labels;
    }
    // Update all the `PDFThumbnailView` instances.
    for (let i = 0, ii = this._thumbnails.length; i < ii; i++) {
      this._thumbnails[i].setPageLabel(this._pageLabels?.[i] ?? null);
    }
  }

  /**
   * @param {PDFThumbnailView} thumbView
   * @returns {Promise<PDFPageProxy | null>}
   */
  async #ensurePdfPageLoaded(thumbView) {
    if (thumbView.pdfPage) {
      return thumbView.pdfPage;
    }
    try {
      const pdfPage = await this.pdfDocument.getPage(thumbView.id);
      if (!thumbView.pdfPage) {
        thumbView.setPdfPage(pdfPage);
      }
      return pdfPage;
    } catch (reason) {
      console.error("Unable to get page for thumb view", reason);
      return null; // Page error -- there is nothing that can be done.
    }
  }

  #getScrollAhead(visible) {
    if (visible.first?.id === 1) {
      return true;
    } else if (visible.last?.id === this._thumbnails.length) {
      return false;
    }
    return this.scroll.down;
  }

  forceRendering() {
    const visibleThumbs = this.#getVisibleThumbs();
    const scrollAhead = this.#getScrollAhead(visibleThumbs);
    const thumbView = this.renderingQueue.getHighestPriority(
      visibleThumbs,
      this._thumbnails,
      scrollAhead
    );
    if (thumbView) {
      this.#ensurePdfPageLoaded(thumbView).then(() => {
        this.renderingQueue.renderView(thumbView);
      });
      return true;
    }
    return false;
  }

  #renderDocuments() {
    // Clear existing thumbnails and containers
    this._thumbnails = [];
    this.container.textContent = "";
  
    const promises = [];
  
    for (const doc of this._documentsData) {
      // Create a container for the document
      const docContainer = document.createElement("div");
      docContainer.classList.add("document-container");
      docContainer.id = doc.id; // Use the updated document ID
  
      // Create a form container (optional)
      const formContainer = document.createElement("div");
      formContainer.classList.add("form-container");
  
      // Create label and text input for File Name
      const fileNameLabel = document.createElement("label");
      fileNameLabel.textContent = "File Name:";
      fileNameLabel.htmlFor = `file-name-${doc.id}`;
      fileNameLabel.style.display = "block"; // Add display block for styling
  
      const fileNameInput = document.createElement("input");
      fileNameInput.type = "text";
      fileNameInput.id = `file-name-${doc.id}`;
      fileNameInput.value = doc.document || ''; // Use existing file name if available
      fileNameInput.style.width = "200px"; // Adjust width as needed
  
      // Append label and input to the form container
      formContainer.appendChild(fileNameLabel);
      formContainer.appendChild(fileNameInput);
  
      // Create label and dropdown for Document Type
      const docTypeLabel = document.createElement("label");
      docTypeLabel.textContent = "Document Type:";
      docTypeLabel.htmlFor = `doc-type-${doc.id}`;
      docTypeLabel.style.display = "block"; // Add display block for styling
      docTypeLabel.style.marginTop = "10px"; // Add margin for spacing
  
      const docTypeSelect = document.createElement("select");
      docTypeSelect.id = `doc-type-${doc.id}`;
      docTypeSelect.style.width = "200px"; // Adjust width as needed
  
      // Add options to the select element (you can customize these)
      const docTypes = ['Invoice', 'Receipt', 'Report', 'Contract']; // Example document types
      for (const type of docTypes) {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        docTypeSelect.appendChild(option);
      }
  
      // Set the selected value if available
      if (doc.documentType) {
        docTypeSelect.value = doc.documentType;
      }
  
      // Append label and select to the form container
      formContainer.appendChild(docTypeLabel);
      formContainer.appendChild(docTypeSelect);
  
      // Append the form container to the document container
      docContainer.appendChild(formContainer);
  
      // Create a container for the thumbnails
      const thumbnailsContainer = document.createElement("div");
      thumbnailsContainer.classList.add("thumbnails-container");
      thumbnailsContainer.style.display = "flex";
      thumbnailsContainer.style.flexWrap = "wrap";
      thumbnailsContainer.style.gap = "10px";
      thumbnailsContainer.style.marginTop = "15px"; // Add margin for spacing
      docContainer.appendChild(thumbnailsContainer);
  
      // For each page, create a thumbnail
      for (const pageObj of doc.pages) {
        const pageNumber = pageObj.pageNumber;
        const thumbnail = new PDFThumbnailView({
          container: thumbnailsContainer,
          eventBus: this.eventBus,
          id: pageNumber,
          defaultViewport: this._defaultViewport.clone(),
          linkService: this.linkService,
          renderingQueue: this.renderingQueue,
          pageColors: this.pageColors,
          enableHWA: this.enableHWA,
        });
  
        this._thumbnails.push(thumbnail);
  
        // Ensure the pdfPage is loaded and set it to the thumbnail
        const promise = this.pdfDocument.getPage(pageNumber).then((pdfPage) => {
          thumbnail.setPdfPage(pdfPage);
        });
  
        promises.push(promise);
      }
  
      this.container.appendChild(docContainer);
  
      // Make the thumbnails container sortable
      window.Sortable.create(thumbnailsContainer, {
        group: "thumbnails",
        animation: 150,
        onEnd: (evt) => {
          // Handle the drag and drop event
          this.#onThumbnailDrop(evt);
        },
      });
    }
  
    // Wait for all pdfPages to be loaded
    Promise.all(promises).then(() => {
      this.renderingQueue.renderHighestPriority();
      // Dispatch an event indicating thumbnails are ready
      this.eventBus.dispatch('thumbnailsready', { source: this });
    });
  }
  
  #onThumbnailDrop(evt) {
    const { item, from, to, oldIndex, newIndex } = evt;
  
    // Update the documentsData accordingly
    const fromDocId = from.parentNode.id; // e.g., 'doc-1'
    const toDocId = to.parentNode.id;
  
    const fromDocIndex = this._documentsData.findIndex(
      (doc) => `doc-${doc.id}` === fromDocId
    );
    const toDocIndex = this._documentsData.findIndex(
      (doc) => `doc-${doc.id}` === toDocId
    );
  
    const fromDoc = this._documentsData[fromDocIndex];
    const toDoc = this._documentsData[toDocIndex];
  
    // Remove the page from the source document
    const [movedPage] = fromDoc.pages.splice(oldIndex, 1);
  
    // Insert the page into the destination document
    toDoc.pages.splice(newIndex, 0, movedPage);
  
    // Update the thumbnail's container
    item.parentNode.removeChild(item);
    to.insertBefore(item, to.children[newIndex]);
  
    // Optionally, update the thumbnails array if needed
    // In this case, the thumbnails remain the same objects
    // But you may want to re-render or update states
  }
}

export { PDFThumbnailViewer };
