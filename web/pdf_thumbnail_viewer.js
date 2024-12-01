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

// PDFThumbnailViewer.js

import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs/modular/sortable.esm.js';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib/+esm';
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

const ViewType = Object.freeze({
  NORMAL: 'NORMAL',
  GROUPED: 'GROUPED',
});

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
 * @property {Array} [documentsResponse] - The initial documents data.
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
    documentsResponse,
  }) {
    this.container = container;
    this.eventBus = eventBus;
    this.linkService = linkService;
    this.renderingQueue = renderingQueue;
    this.pageColors = pageColors || null;
    this.enableHWA = enableHWA || false;
    this.documentsResponse = documentsResponse;
    this._documentsData = this.initializeDocuments(documentsResponse);
    this.viewType = ViewType.NORMAL;

    this.scroll = watchScroll(
      this.container,
      this.#scrollUpdated.bind(this),
      abortSignal
    );
    this.#resetView();

    // this.eventBus._on('thumbnail-delete', this.#onDeleteThumbnail.bind(this));
    this.eventBus._on('thumbnail-download', this.#onDownloadPage.bind(this));
  }

  initializeDocuments(documents) {
    const docs = documents.map((doc, docIndex) => ({
      ...doc,
      id: `doc-${docIndex}`, // Unique ID for the document
      pages: doc.pages.map((pageNumber, pageIndex) => ({
        pageNumber, // Use the actual page number
        id: `doc-${docIndex}-page-${pageIndex}`, // Unique ID for each page
      })),
    }));
    return docs;
  }

  setDocumentsData(response) {
    this.#resetView();
    
    this._documentsData = this.initializeDocuments(response.result);
    this._documenTypes = response.document_types;
    this.viewType = ViewType.GROUPED;
    this.#renderDocumentContainers();
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

    switch (this.viewType) {
      case ViewType.NORMAL:
        this.#scrollToDocumentPage(pageNumber);
        break;
      case ViewType.GROUPED:
        this.#scrollToDocumentContainer(pageNumber);
        break;
    }
  }

  #scrollToDocumentPage(pageNumber) {
    const thumbnailView = this._thumbnails[pageNumber - 1];

    if (!thumbnailView) {
      console.error('scrollThumbnailIntoView: Invalid "pageNumber" parameter.');
      return;
    }

    if (pageNumber !== this._currentPageNumber) {
      const prevThumbnailView = this._thumbnails[this._currentPageNumber - 1];
      // Remove the highlight from the previous thumbnail...
      prevThumbnailView.div.classList.remove(THUMBNAIL_SELECTED_CLASS);
      // ... and add the highlight to the new thumbnail.
      thumbnailView.div.classList.add(THUMBNAIL_SELECTED_CLASS);
    }
    const { first, last, views } = this.#getVisibleThumbs();

    // If the thumbnail isn't currently visible, scroll it into view.
    if (views.length > 0) {
      let shouldScroll = false;
      if (pageNumber <= first.id || pageNumber >= last.id) {
        shouldScroll = true;
      } else {
        for (const { id, percent } of views) {
          if (id !== pageNumber) {
            continue;
          }
          shouldScroll = percent < 100;
          break;
        }
      }
      if (shouldScroll) {
        scrollIntoView(thumbnailView.div, { top: THUMBNAIL_SCROLL_MARGIN });
      }
    }

    this._currentPageNumber = pageNumber;
  }

  #scrollToDocumentContainer(pageNumber) {
    const thumbnailView = this._thumbnails.find(
      (thumb) => thumb.pageNumber === pageNumber
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
      this._currentDocumentContainer.classList.remove(
        'selected-document-container'
      );
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
      throw new Error('Invalid thumbnails rotation angle.');
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
    this.container.textContent = '';
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

    firstPagePromise
      .then((firstPdfPage) => {
        const viewport = firstPdfPage.getViewport({ scale: 1 });
        this._defaultViewport = viewport;

        switch (this.viewType) {
          case ViewType.NORMAL:
            this.#renderDocuments(firstPdfPage, viewport);
            break;
          case ViewType.GROUPED:
            this.#renderDocumentContainers();
            this.scrollThumbnailIntoView(1);
            break;
        }
      })
      .catch((reason) => {
        console.error('Unable to initialize thumbnail viewer', reason);
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
      console.error('PDFThumbnailViewer_setPageLabels: Invalid page labels.');
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
      const pdfPage = await this.pdfDocument.getPage(thumbView.pageNumber);
      if (!thumbView.pdfPage) {
        thumbView.setPdfPage(pdfPage);
      }
      return pdfPage;
    } catch (reason) {
      console.error('Unable to get page for thumb view', reason);
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

  #renderDocuments(firstPdfPage, viewport) {
    this._thumbnails = [];

    const optionalContentConfigPromise = this.pdfDocument.getOptionalContentConfig({
      intent: "display",
    });
    const pagesCount = this.pdfDocument.numPages;
    for (let pageNum = 1; pageNum <= pagesCount; ++pageNum) {
      const thumbnail = new PDFThumbnailView({
        container: this.container,
        eventBus: this.eventBus,
        id: pageNum,
        pageNumber: pageNum,
        defaultViewport: viewport.clone(),
        optionalContentConfigPromise,
        linkService: this.linkService,
        renderingQueue: this.renderingQueue,
        pageColors: this.pageColors,
        enableHWA: this.enableHWA,
      });
      this._thumbnails.push(thumbnail);
    }
    // Set the first `pdfPage` immediately, since it's already loaded,
    // rather than having to repeat the `PDFDocumentProxy.getPage` call in
    // the `this.#ensurePdfPageLoaded` method before rendering can start.
    this._thumbnails[0]?.setPdfPage(firstPdfPage);

    // Ensure that the current thumbnail is always highlighted on load.
    const thumbnailView = this._thumbnails[this._currentPageNumber - 1];
    thumbnailView.div.classList.add(THUMBNAIL_SELECTED_CLASS);
  }

  #renderDocumentContainers() {
    // Clear existing thumbnails and containers
    this._thumbnails = [];
    this.container.textContent = '';

    const promises = [];

    for (const doc of this._documentsData) {
      // Create a container for the document
      const docContainer = document.createElement('div');
      docContainer.classList.add('document-container');
      docContainer.id = doc.id; // Use the updated document ID

      // Create a form container (optional)
      const formContainer = document.createElement('div');
      formContainer.classList.add('form-container');

      // Create label and text input for File Name
      const fileNameLabel = document.createElement('label');
      fileNameLabel.textContent = 'File Name:';
      fileNameLabel.htmlFor = `file-name-${doc.id}`;
      fileNameLabel.style.display = 'block'; // Add display block for styling

      const fileNameInput = document.createElement('input');
      fileNameInput.type = 'text';
      fileNameInput.id = `file-name-${doc.id}`;
      fileNameInput.value = doc.document || ''; // Use existing file name if available
      // fileNameInput.style.width = '100%'; // Adjust width as needed

      // Append label and input to the form container
      formContainer.appendChild(fileNameLabel);
      formContainer.appendChild(fileNameInput);

      // Create label and dropdown for Document Type
      const docTypeLabel = document.createElement('label');
      docTypeLabel.textContent = 'Document Type:';
      docTypeLabel.htmlFor = `doc-type-${doc.id}`;
      docTypeLabel.style.display = 'block'; // Add display block for styling
      docTypeLabel.style.marginTop = '10px'; // Add margin for spacing

      const docTypeSelect = document.createElement('select');
      docTypeSelect.id = `doc-type-${doc.id}`;
      docTypeSelect.style.minWidth = '160px'; // Adjust width as needed

      // Add options to the select element (you can customize these)
      const docTypes = this._documenTypes; // Example document types
      for (const type of docTypes) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        docTypeSelect.appendChild(option);
      }

      // Set the selected value if available
      if (doc.document_type) {
        docTypeSelect.value = doc.document_type;
      }

      // Append label and select to the form container
      formContainer.appendChild(docTypeLabel);
      formContainer.appendChild(docTypeSelect);

      // Append the form container to the document container
      docContainer.appendChild(formContainer);

      // Create a container for the thumbnails
      const thumbnailsContainer = document.createElement('div');
      thumbnailsContainer.classList.add('thumbnails-container');
      thumbnailsContainer.style.display = 'flex';
      thumbnailsContainer.style.flexWrap = 'wrap';
      // thumbnailsContainer.style.gap = '10px';
      thumbnailsContainer.style.marginTop = '15px'; // Add margin for spacing
      docContainer.appendChild(thumbnailsContainer);

      // For each page, create a thumbnail
      for (const pageObj of doc.pages) {
        const pageId = pageObj.id; // Unique page ID
        const pageNumber = pageObj.pageNumber; // Unique global page number

        const thumbnail = new PDFThumbnailView({
          container: thumbnailsContainer,
          eventBus: this.eventBus,
          id: pageId, 
          pageNumber: pageNumber,
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
      Sortable.create(thumbnailsContainer, {
        group: 'shared', // Allow dragging between containers
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
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

  // Function to generate a unique ID (you can customize this logic)
  #generateUniqueId() {
    return '_' + Math.random().toString(36).substr(2, 9);
  }

  // Function to add a new empty document container at the beginning
  addNewEmptyDocumentContainer() {
    // Create a new empty document object
    const newDoc = {
      id: this.#generateUniqueId(),
      document: '',        // Empty file name
      document_type: '',   // Default document type
      pages: [],           // Empty pages array
    };

    // Insert the new document at the beginning of _documentsData
    this._documentsData.unshift(newDoc);

    // Create a new document container and insert it at the beginning of the container
    const docContainer = document.createElement('div');
    docContainer.classList.add('document-container');
    docContainer.id = newDoc.id;

    // Create the form container with file input and document type
    const formContainer = document.createElement('div');
    formContainer.classList.add('form-container');

    // Create label and text input for File Name
    const fileNameLabel = document.createElement('label');
    fileNameLabel.textContent = 'File Name:';
    fileNameLabel.htmlFor = `file-name-${newDoc.id}`;
    fileNameLabel.style.display = 'block'; // Add display block for styling

    const fileNameInput = document.createElement('input');
    fileNameInput.type = 'text';
    fileNameInput.id = `file-name-${newDoc.id}`;
    fileNameInput.value = ''; // Empty value for new document
    fileNameInput.style.width = '100%'; // Adjust width as needed

    // Append label and input to the form container
    formContainer.appendChild(fileNameLabel);
    formContainer.appendChild(fileNameInput);

    // Create label and dropdown for Document Type
    const docTypeLabel = document.createElement('label');
    docTypeLabel.textContent = 'Document Type:';
    docTypeLabel.htmlFor = `doc-type-${newDoc.id}`;
    docTypeLabel.style.display = 'block'; // Add display block for styling
    docTypeLabel.style.marginTop = '10px'; // Add margin for spacing

    const docTypeSelect = document.createElement('select');
    docTypeSelect.id = `doc-type-${newDoc.id}`;
    docTypeSelect.style.minWidth = '160px'; // Adjust width as needed

    // Add options to the select element
    const docTypes = this._documenTypes; // Example document types
    for (const type of docTypes) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      docTypeSelect.appendChild(option);
    }

    // Set the selected value to default or empty
    docTypeSelect.value = '';

    // Append label and select to the form container
    formContainer.appendChild(docTypeLabel);
    formContainer.appendChild(docTypeSelect);

    // Append the form container to the document container
    docContainer.appendChild(formContainer);

    // Create a container for the thumbnails (empty for new document)
    const thumbnailsContainer = document.createElement('div');
    thumbnailsContainer.classList.add('thumbnails-container');
    thumbnailsContainer.style.display = 'flex';
    thumbnailsContainer.style.flexWrap = 'wrap';
    thumbnailsContainer.style.marginTop = '15px'; // Add margin for spacing
    docContainer.appendChild(thumbnailsContainer);

    // Insert the new document container at the beginning of the main container
    this.container.insertBefore(docContainer, this.container.firstChild);

    // Make the thumbnails container sortable
    Sortable.create(thumbnailsContainer, {
      group: 'shared', // Allow dragging between containers
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: (evt) => {
        // Handle the drag and drop event
        this.#onThumbnailDrop(evt);
      },
    });

    scrollIntoView(docContainer, { top: THUMBNAIL_SCROLL_MARGIN });
  }

  #onDeleteThumbnail(evt) {
    const { source, id } = evt;
    const thumbnail = source;

    // Remove the thumbnail's DOM element
    thumbnail.div.remove();

    // Remove the thumbnail from the _thumbnails array
    const thumbIndex = this._thumbnails.indexOf(thumbnail);
    if (thumbIndex !== -1) {
      this._thumbnails.splice(thumbIndex, 1);
    }

    // Remove the page from _documentsData
    for (const doc of this._documentsData) {
      const pageIndex = doc.pages.findIndex((page) => page.id === thumbnail.id);
      if (pageIndex !== -1) {
        doc.pages.splice(pageIndex, 1);

        // Handle empty documents
        if (doc.pages.length === 0) {
          const docContainer = thumbnail.div.closest('.document-container');
          if (docContainer) {
            docContainer.remove();
          }
          const docIndex = this._documentsData.indexOf(doc);
          if (docIndex !== -1) {
            this._documentsData.splice(docIndex, 1);
          }
        }
        break;
      }
    }

    // Update page numbers
    this.#updatePageNumbers();

    // Re-render if necessary
    this.renderingQueue.renderHighestPriority();
  }

  async #onDownloadPage(evt) {
    const { source, id } = evt;
    const pageNumber = source.pageNumber;
    try {
      const originalPdfBytes = await this.pdfDocument.getData();
      const originalPdf = await PDFDocument.load(originalPdfBytes);
      const pdfDoc = await PDFDocument.create();

      // Copy the specified page into the new PDF
      const [copiedPage] = await pdfDoc.copyPages(originalPdf, [pageNumber - 1]);
      pdfDoc.addPage(copiedPage);

      const pdfBytes = await pdfDoc.save();

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `page-${pageNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading page as PDF:', error);
    }
  }

  #onThumbnailDrop(evt) {
    const { item, from, to, oldIndex, newIndex } = evt;

    // Get the source and destination document containers
    const fromDocContainer = from.closest('.document-container');
    const toDocContainer = to.closest('.document-container');

    const fromDocId = fromDocContainer.id;
    const toDocId = toDocContainer.id;

    const fromDocIndex = this._documentsData.findIndex(
      (doc) => doc.id === fromDocId
    );
    const toDocIndex = this._documentsData.findIndex(
      (doc) => doc.id === toDocId
    );

    const fromDoc = this._documentsData[fromDocIndex];
    const toDoc = this._documentsData[toDocIndex];

    // Remove the page from the source document
    const [movedPage] = fromDoc.pages.splice(oldIndex, 1);

    // Insert the page into the destination document
    toDoc.pages.splice(newIndex, 0, movedPage);

    // Update the _thumbnails array
    const movedThumbnailIndex = this._thumbnails.findIndex(
      (thumb) => thumb.id === movedPage.id
    );
    const [movedThumbnail] = this._thumbnails.splice(movedThumbnailIndex, 1);

    // Find the insertion index in _thumbnails
    const toDocThumbnails = this._thumbnails.filter(
      (thumb) =>
        thumb.container.closest('.document-container').id === toDocId
    );

    let insertIndex;
    if (toDocThumbnails.length === 0) {
      // If the destination document has no thumbnails yet
      insertIndex = this._thumbnails.findIndex(
        (thumb) => thumb.container.closest('.document-container').id === toDocId
      );
      if (insertIndex === -1) {
        insertIndex = this._thumbnails.length;
      }
    } else {
      if (newIndex >= toDocThumbnails.length) {
        insertIndex =
          this._thumbnails.indexOf(toDocThumbnails[toDocThumbnails.length - 1]) +
          1;
      } else {
        insertIndex = this._thumbnails.indexOf(toDocThumbnails[newIndex]);
      }
    }

    this._thumbnails.splice(insertIndex, 0, movedThumbnail);

    // Reassign page numbers to ensure they are sequential
    for (const doc of this._documentsData) {
      for (let i = 0; i < doc.pages.length; i++) {
        doc.pages[i].pageNumber = doc.pages[i].pageNumber; // Keep original page numbers
      }
    }
  
    // Update the pageNumber in thumbnails
    for (const thumbnail of this._thumbnails) {
      const page = this._documentsData
        .flatMap((doc) => doc.pages)
        .find((p) => p.id === thumbnail.id);
      if (page) {
        thumbnail.pageNumber = page.pageNumber;
      }
    }

    // Optionally, re-render the thumbnails if necessary
    this.renderingQueue.renderHighestPriority();
  }

  #updatePageNumbers() {
    let pageNumber = 1;
    for (const doc of this._documentsData) {
      for (const page of doc.pages) {
        page.pageNumber = pageNumber++;
      }
    }

    for (const thumbnail of this._thumbnails) {
      const page = this._documentsData
        .flatMap((doc) => doc.pages)
        .find((p) => p.id === thumbnail.id);
      if (page) {
        thumbnail.pageNumber = page.pageNumber;
      }
    }
  }

  /**
   * Method to generate the modified PDF based on user changes.
   * This method assumes you have included a PDF manipulation library like PDF-lib.
   */
  async generateModifiedPDF() {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const originalPdfBytes = await this.pdfDocument.getData();
    const originalPdf = await PDFLib.PDFDocument.load(originalPdfBytes);

    for (const doc of this._documentsData) {
      for (const page of doc.pages) {
        const [copiedPage] = await pdfDoc.copyPages(
          originalPdf,
          [page.pageNumber - 1]
        );
        pdfDoc.addPage(copiedPage);
      }
    }

    const pdfBytes = await pdfDoc.save();
    // Trigger download or further processing
    // For example:
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modified.pdf';
    a.click();
    URL.revokeObjectURL(url);
  }
}

export { PDFThumbnailViewer };