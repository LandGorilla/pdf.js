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
import { PDFViewerApplication, ViewType } from "./app.js";

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
    this._documentStates = {};

    this.scroll = watchScroll(
      this.container,
      this.#scrollUpdated.bind(this),
      abortSignal
    );
    this.#resetView();

    // this.eventBus._on('thumbnail-delete', this._onDeleteThumbnail.bind(this));
    this.eventBus._on('thumbnail-download', this._onDownloadPage.bind(this));
    this.eventBus._on('thumbnail-click', this._onSelectThumbnail.bind(this));
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
    
    this.documentsData = this.initializeDocuments(response.result);
    this._documenTypes = response.document_types;

    for (const doc of this.documentsData) {
      this._documentStates[doc.id] = {
        state: 'none',
        progress: 0,
        result: null,
      };
    }

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

    switch (PDFViewerApplication.viewState) {
      case ViewType.NORMAL:
        this.#scrollToDocumentPage(pageNumber);
        break;
      case ViewType.GROUPED:
        // this.#scrollToDocumentContainer(pageNumber);
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
  setDocument(pdfDocument, args={}) {
    if (args.needsThumbnailsRefresh) {
      this.pdfDocument = pdfDocument;
      return;
    }

    if (this.pdfDocument) {
      this.#cancelRendering();
      this.#resetView();
    }

    this.pdfDocument = pdfDocument;
    if (!pdfDocument) {
      return;
    }

    let documentsResponse = args.documentsResponse;
    if (documentsResponse && args.flatPages) {
      const oldToNew = {};
      args.flatPages.forEach((oldPage, i) => {
        oldToNew[oldPage] = i + 1;  // new PDF pages are 1-based
      });

      documentsResponse.result.forEach(doc => {
        doc.pages = doc.pages.map(oldPageNum => oldToNew[oldPageNum]);
      });

      this.setDocumentsData(documentsResponse);
    }

    if (args.documentsData && args.flatPages) {
    //   const oldToNew = {};
    //   args.flatPages.forEach((oldPage, i) => {
    //     oldToNew[oldPage] = i + 1;  // new PDF pages are 1-based
    //   });
    
    //   args.documentsData.forEach(doc => {
    //     doc.pages.forEach(pageObj => {
    //       // pageObj.pageNumber = oldToNew[pageObj.pageNumber];
    //     });
    //   });
    
      this.#resetView();
      this.documentsData = args.documentsData;
      this.#renderDocumentContainers();
    }

    const firstPagePromise = pdfDocument.getPage(1);

    firstPagePromise
      .then((firstPdfPage) => {
        const viewport = firstPdfPage.getViewport({ scale: 1 });
        this._defaultViewport = viewport;

        switch (PDFViewerApplication.viewState) {
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

    for (const doc of this.documentsData) {
      // Create a container for the document
      const docContainer = document.createElement('div');
      docContainer.classList.add('document-container');
      docContainer.id = doc.id;

      // Create a form container (optional)
      const formContainer = document.createElement('div');
      formContainer.classList.add('form-container');

      // Create label and text input for File Name
      const fileNameLabel = document.createElement('label');
      fileNameLabel.textContent = 'File Name';
      fileNameLabel.htmlFor = `file-name-${doc.id}`;
      fileNameLabel.style.display = 'block'; // Add display block for styling

      const fileNameInput = document.createElement('input');
      fileNameInput.type = 'text';
      fileNameInput.id = `file-name-${doc.id}`;
      fileNameInput.value = doc.document || '';

      // Append label and input to the form container
      formContainer.appendChild(fileNameLabel);
      formContainer.appendChild(fileNameInput);

      // Create label and dropdown for Document Type
      const docTypeLabel = document.createElement('label');
      docTypeLabel.textContent = 'Document Type';
      docTypeLabel.htmlFor = `doc-type-${doc.id}`;
      docTypeLabel.style.display = 'block'; // Add display block for styling
      docTypeLabel.style.marginTop = '10px'; // Add margin for spacing

      const docTypeSelect = document.createElement('select');
      docTypeSelect.id = `doc-type-${doc.id}`;
      docTypeSelect.style.minWidth = '160px'; // Adjust width as needed

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

      // Create a horizontal list of options (delete, download)
      const optionsContainer = document.createElement('div');
      optionsContainer.classList.add('document-container-options'); 

      // Create Delete Icon Image
      const deleteIcon = document.createElement('img');
      deleteIcon.src = 'images/action-trash.png'; // Update with the correct path
      deleteIcon.alt = 'Delete';
      deleteIcon.classList.add('icon-delete');

      // Create Download Icon Image
      const downloadIcon = document.createElement('img');
      downloadIcon.src = 'images/action-download.png'; // Update with the correct path
      downloadIcon.alt = 'Download';
      downloadIcon.classList.add('icon-download');
      downloadIcon.addEventListener('click', (event) => {
        const docId = doc.id;
        const documentData = this.documentsData.find((d) => d.id === docId);
        const pageNumbers = documentData.pages.map((page) => page.pageNumber);
        this.eventBus.dispatch('document-container-download', { source: this, docId, pageNumbers });
      });

      // Append SVG icons to the options container
      optionsContainer.appendChild(deleteIcon);
      optionsContainer.appendChild(downloadIcon);

      // Append options container to the document container
      docContainer.appendChild(optionsContainer);

      // Create a container for the thumbnails
      const thumbnailsContainer = document.createElement('div');
      thumbnailsContainer.classList.add('thumbnails-container');
      thumbnailsContainer.style.display = 'flex';
      thumbnailsContainer.style.flexWrap = 'wrap';
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

      // STATUS AREA: Just a progress bar and a retry button
      const statusContainer = document.createElement('div');
      statusContainer.classList.add('document-status-container');

      const progressBar = document.createElement('progress');
      progressBar.classList.add('document-progress-bar');
      progressBar.value = 0;
      progressBar.max = 100;
      progressBar.style.display = 'none';

      const progressDescription = document.createElement('div');
      progressDescription.classList.add('document-progress-description');
      progressDescription.textContent = 'Extracting data...';
      progressDescription.style.display = 'none';

      const errorContainer = document.createElement('div');
      errorContainer.classList.add('document-error-container');
      errorContainer.style.display = 'none';
      errorContainer.textContent = 'An error occurred extracting data. Please try again.';

      const retryButton = document.createElement('button');
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', async () => {
        const docId = doc.id;
        this.eventBus.dispatch('document-container-retry', { source: this, docId });
      });

      errorContainer.appendChild(retryButton);
      statusContainer.appendChild(progressBar);
      statusContainer.appendChild(progressDescription);
      statusContainer.appendChild(errorContainer);
      docContainer.appendChild(statusContainer);

      this.container.appendChild(docContainer);

      // Make the thumbnails container sortable
      Sortable.create(thumbnailsContainer, {
        group: 'shared', // Allow dragging between containers
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: (evt) => {
          // Handle the drag and drop event
          this._onThumbnailDrop(evt);
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

  #updateDocumentUI(docId) {
    const docContainer = this.container.querySelector(`#${docId}`);
    if (!docContainer) return;
  
    const { state, progress } = this._documentStates[docId];
  
    const progressBar = docContainer.querySelector('.document-progress-bar');
    const progressDescription = docContainer.querySelector('.document-progress-description');
    const errorContainer = docContainer.querySelector('.document-error-container');
  
    switch (state) {
      case 'none':
      case 'done':
        // Hide progress bar and error container
        if (progressBar) progressBar.style.display = 'none';
        if (progressDescription) progressDescription.style.display = 'none';
        if (errorContainer) errorContainer.style.display = 'none';
        break;
  
      case 'processing':
        // Show progress bar, hide error container
        if (progressBar) {
          progressBar.style.display = 'inline-block';
          progressDescription.style.display = 'inline-block';
          progressBar.value = progress;
        }
        if (errorContainer) errorContainer.style.display = 'none';
        break;
  
      case 'error':
        // Show error container with retry, hide progress bar
        if (progressBar) progressBar.style.display = 'none';
        if (progressDescription) progressDescription.style.display = 'none';
        if (errorContainer) errorContainer.style.display = 'inline-block';
        break;
    }
  
    // Optionally add state classes to docContainer for styling
    docContainer.classList.remove('state-none', 'state-processing', 'state-done', 'state-error');
    docContainer.classList.add(`state-${state}`);
  }

  setDocumentState(docId, state) {
    if (!this._documentStates[docId]) return;
    this._documentStates[docId].state = state;
    this.#updateDocumentUI(docId);
  }
  
  setDocumentProgress(docId, progressValue) {
    if (!this._documentStates[docId]) return;
    this._documentStates[docId].progress = progressValue;
    this.#updateDocumentUI(docId);
  }

  setDocumentResult(docId, result) {
    this._documentStates[docId].result = result;
  }

  #displayDocumentForm(docId) {
    if (!this._documentStates[docId]) return;
    const result = this._documentStates[docId].result;
    const rightPanelContent = document.getElementById('rightSidebarContent')
    if (result) {
      rightPanelContent.innerHTML = result;
    } else {
      rightPanelContent.innerHTML = "";
    }
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

    // Insert the new document at the beginning of documentsData
    this.documentsData.unshift(newDoc);

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
        this._onThumbnailDrop(evt);
      },
    });

    scrollIntoView(docContainer, { top: THUMBNAIL_SCROLL_MARGIN });
  }

  _onSelectThumbnail(evt) {
    const { source, id } = evt;
    const thumbnail = source;
    const docContainer = thumbnail.div.closest('.document-container');
    const docId = docContainer.id;

    this.#displayDocumentForm(docId);
  }

  async _onDeleteThumbnail(evt) {
    const { source, id } = evt;
    const thumbnail = source;

    // 1) Log the thumbnail ID.
    console.log("Deleting thumbnail with id:", thumbnail.id);
    
    // 2) Check each document in documentsData.
    for (const doc of this.documentsData) {
      console.log("Checking doc:", doc.id, "with pages:", doc.pages);

      // 3) Print the IDs in doc.pages as well.
      console.log("Page IDs in this doc:", doc.pages.map(p => p.id));

      const pageIndex = doc.pages.findIndex((page) => {
        console.log("Comparing page.id:", page.id, "with thumbnail.id:", thumbnail.id);
        return page.id === thumbnail.id;
      });

      console.log("Resulting pageIndex:", pageIndex);

      if (pageIndex !== -1) {
        // If we actually found the page, splice it out.
        console.log("Splicing out page at index:", pageIndex, "from doc:", doc.id);
        doc.pages.splice(pageIndex, 1);

        // Now confirm it’s removed.
        console.log("Pages after splice:", doc.pages.map(p => p.id));

        // Handle empty documents
        // if (doc.pages.length === 0) {
        //   console.log("Document is now empty. Removing it completely:", doc.id);
        //   const docIndex = this.documentsData.indexOf(doc);
        //   if (docIndex !== -1) {
        //     this.documentsData.splice(docIndex, 1);
        //     console.log("Removed entire doc from documentsData. Current docs:", this.documentsData);
        //   }
        // }

        // Break out of the loop once we've found our page.
        break;
      }
    }
  
    // Remove the thumbnail's DOM element
    thumbnail.div.remove();
  
    // Remove the thumbnail from the _thumbnails array
    const thumbIndex = this._thumbnails.indexOf(thumbnail);
    if (thumbIndex !== -1) {
      this._thumbnails.splice(thumbIndex, 1);
    }
  
    // const docContainer = thumbnail.div.closest('.document-container');
    // if (docContainer) {
    //   // We are in document container mode
    //   // Remove the page from documentsData
    //   for (const doc of this.documentsData) {
    //     const pageIndex = doc.pages.findIndex((page) => page.id === thumbnail.id);
    //     if (pageIndex !== -1) {
    //       doc.pages.splice(pageIndex, 1);
  
    //       // Handle empty documents
    //       if (doc.pages.length === 0) {
    //         if (docContainer) {
    //           docContainer.remove();
    //         }
    //         const docIndex = this.documentsData.indexOf(doc);
    //         if (docIndex !== -1) {
    //           this.documentsData.splice(docIndex, 1);
    //         }
    //       }
    //       break;
    //     }
    //   }
    // }
  
    // Update page numbers
    this.#updatePageNumbers();
  
    // Re-render if necessary
    this.renderingQueue.renderHighestPriority();

    // Dispatch an event with the new page number and total pages
    const newTotalPages = this._thumbnails.length;
    const newPageNumber = Math.min(this._currentPageNumber, newTotalPages) || 1;

    // this.eventBus.dispatch('pageinfochanged', {
    //   source: this,
    //   pageNumber: newPageNumber,
    //   totalPages: newTotalPages,
    // });

    const newOrderedPages = this.documentsData
      .flatMap(doc => doc.pages)
      .map(p => p.pageNumber); 

    const newPDFUrl = await this.generateNewPDF(newOrderedPages);
    this.eventBus.dispatch('thumbnail-reordered', { source: this, newPDFUrl, documentsData: this.documentsData, flatPages: newOrderedPages });
  }

  async _generatePDF(evt) {
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
      
    } catch (error) {
      console.error('Error downloading page as PDF:', error);
    }
  }

  async _onDownloadPage(evt) {
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

  async _onThumbnailDrop(evt) {
    const { item, from, to, oldIndex, newIndex } = evt;
  
    // Get the source and destination document containers
    const fromDocContainer = from.closest('.document-container');
    const toDocContainer = to.closest('.document-container');
  
    const fromDocId = fromDocContainer.id;
    const toDocId = toDocContainer.id;
  
    console.log(
      `Dragging from docId=${fromDocId} to docId=${toDocId}, 
      oldIndex=${oldIndex}, newIndex=${newIndex}`
    );
  
    const fromDocIndex = this.documentsData.findIndex(
      (doc) => doc.id === fromDocId
    );
    const toDocIndex = this.documentsData.findIndex(
      (doc) => doc.id === toDocId
    );
  
    const fromDoc = this.documentsData[fromDocIndex];
    const toDoc = this.documentsData[toDocIndex];
  
    // Remove the page from the source document
    const [movedPage] = fromDoc.pages.splice(oldIndex, 1);
    console.log(
      `Removed page with id=${movedPage.id} from doc=${fromDoc.id}. 
      fromDoc now has pages:`,
      fromDoc.pages.map(p => p.pageNumber)
    );
  
    // Insert the page into the destination document
    toDoc.pages.splice(newIndex, 0, movedPage);
    console.log(
      `Inserted page with id=${movedPage.id} into doc=${toDoc.id} at index=${newIndex}. 
      toDoc now has pages:`,
      toDoc.pages.map(p => p.pageNumber)
    );
  
    // Update the _thumbnails array
    const movedThumbnailIndex = this._thumbnails.findIndex(
      (thumb) => thumb.id === movedPage.id
    );
    const [movedThumbnail] = this._thumbnails.splice(movedThumbnailIndex, 1);
  
    // Find the insertion index in _thumbnails
    const toDocThumbnails = this._thumbnails.filter(
      (thumb) => thumb.container.closest('.document-container').id === toDocId
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
          this._thumbnails.indexOf(
            toDocThumbnails[toDocThumbnails.length - 1]
          ) + 1;
      } else {
        insertIndex = this._thumbnails.indexOf(toDocThumbnails[newIndex]);
      }
    }
  
    this._thumbnails.splice(insertIndex, 0, movedThumbnail);
  
    // Reassign page numbers to ensure they are sequential (or keep original if desired)
    for (const doc of this.documentsData) {
      for (let i = 0; i < doc.pages.length; i++) {
        // doc.pages[i].pageNumber = i + 1; // Example if you wanted fully sequential
        // or keep original pageNumber as you do in your code:
        // doc.pages[i].pageNumber = doc.pages[i].pageNumber;
      }
    }
  
    // Update the pageNumber in thumbnails
    // for (const thumbnail of this._thumbnails) {
    //   const page = this.documentsData
    //     .flatMap((doc) => doc.pages)
    //     .find((p) => p.id === thumbnail.id);
    //   if (page) {
    //     thumbnail.pageNumber = page.pageNumber;
    //   }
    // }
  
    // Print final order of pages for each document container, for debugging
    console.log("=== Final documentsData order after drop ===");
    for (const doc of this.documentsData) {
      console.log(
        `Doc ${doc.id} pages:`,
        doc.pages.map(p => p.pageNumber)
      );
    }
    console.log("============================================");
  
    // Optionally, re-render the thumbnails if necessary
    this.renderingQueue.renderHighestPriority();
  }

  #updatePageNumbers() {
    switch (this.viewType) {
      case ViewType.NORMAL:
        let pageNumber = 1;
        for (const thumbnail of this._thumbnails) {
          thumbnail.pageNumber = pageNumber;
          thumbnail.setPageLabel(pageNumber.toString());
          pageNumber++;
        }
        break;

      case ViewType.GROUPED:
        let groupedPageNumber = 1;
        for (const doc of this.documentsData) {
          for (const page of doc.pages) {
            page.pageNumber = groupedPageNumber++;
          }
        }

        for (const thumbnail of this._thumbnails) {
          const page = this.documentsData
            .flatMap((doc) => doc.pages)
            .find((p) => p.id === thumbnail.id);
          if (page) {
            thumbnail.pageNumber = page.pageNumber;
            thumbnail.setPageLabel(page.pageNumber.toString());
          }
        }
        break;
    }
  }

  animateDocumentProgress(docId, current, target, durationInSeconds) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const duration = durationInSeconds * 1000;
      let rafId;
  
      const update = () => {
        const elapsed = Date.now() - startTime;
        let percentage = current + ((target - current) * elapsed) / duration;
  
        if (percentage >= target) {
          percentage = target;
          this.setDocumentProgress(docId, percentage);
          resolve();
          return;
        }
  
        this.setDocumentProgress(docId, percentage);
        rafId = requestAnimationFrame(update);
      };
  
      rafId = requestAnimationFrame(update);
    });
  }

  simulateDocumentProgress(docId, startPercentage, maxPercentage, durationInSeconds, control) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const duration = durationInSeconds * 1000;
      let rafId;
  
      const update = () => {
        // If an accelerate signal is triggered, animate the last chunk quickly to 100% and resolve.
        if (control.accelerate) {
          this.animateDocumentProgress(docId, maxPercentage, 100, 0.5)
            .then(resolve)
            .catch((err) => {
              console.error('Error accelerating document progress:', err);
              resolve();
            });
          return;
        }
  
        const elapsed = Date.now() - startTime;
        // Calculate progress from startPercentage up to maxPercentage
        let percentage = startPercentage + ((maxPercentage - startPercentage) * elapsed) / duration;
        if (percentage >= maxPercentage) {
          percentage = maxPercentage;
          // We’ve hit our max — let's stop here (but do not resolve yet, we'll wait for an accelerate).
        } 
  
        // Update the PDFThumbnailViewer's progress for this doc
        this.setDocumentProgress(docId, percentage);
  
        // Continue the animation
        rafId = requestAnimationFrame(update);
      };
  
      rafId = requestAnimationFrame(update);
    });
  }
}

export { PDFThumbnailViewer };