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
import { PDFViewerApplication, ViewType, EditorState } from "./app.js";

const THUMBNAIL_SCROLL_MARGIN = -19;
const THUMBNAIL_SELECTED_CLASS = "selected";
const CONTAINER_SELECTED_CLASS = "selected";

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
    this.documentStates = {};
    this._selectedThumbnail = null;
    this.sortableInstances = {};

    this.scroll = watchScroll(
      this.container,
      this.#scrollUpdated.bind(this),
      abortSignal
    );
    this.#resetView();

    this.eventBus._on('thumbnail-rotate', this._onRotateThumbnail.bind(this));
    this.eventBus._on('thumbnail-delete', this._onDeleteThumbnail.bind(this));
    this.eventBus._on('thumbnail-download', this._onDownloadPage.bind(this));
    this.eventBus._on('thumbnail-click', this._onSelectThumbnail.bind(this));

    const mainCheckbox = document.querySelector('#select-all-container input[type="checkbox"]');
    mainCheckbox.addEventListener('change', (event) => {
      this.toggleAllCheckboxes(event.target.checked);
    });

    const invoicesCheckbox = document.querySelector('#select-invoices-container input[type="checkbox"]');
    invoicesCheckbox.addEventListener('change', (event) => {
      this.toggleInvoicesCheckboxes(event.target.checked);
    });
  }

  async initializeDocuments(documents) {
    if (!this.pdfDocument) {
      return;
    }

    const docPromises = documents.map(async (doc, docIndex) => {
      // Now map over each pageNumber in this doc’s `pages`.
      const pagePromises = doc.pages.map(async (pageNumber, pageIndex) => {
        // 1) Load the actual PDF page from pdf-lib
        const page = await this.pdfDocument.getPage(pageNumber);

        // 2) Read the rotation in degrees
        // pdf-lib’s `getRotation()` returns an object like { angle: 90, type: 'degrees' }
        // const { angle } = pdfPage.getRotation();
        const angle = page.rotate % 360;

        // 3) Return the new page object
        return {
          pageNumber,                              // e.g. 1-based page number
          id: `doc-${docIndex}-page-${pageIndex}`, // “doc-0-page-0” style
          rotation: angle,                         // e.g. 0, 90, 180, 270
        };
      });

      // Wait for all pages in this doc
      const pages = await Promise.all(pagePromises);

      // Return a new doc object with an ID, plus the updated pages array
      return {
        ...doc,
        id: `doc-${docIndex}`,
        pages,
      };
    });

    // Wait for all docs
    const docs = await Promise.all(docPromises);
    return docs;
  }

  async setDocumentsData(response) {
    this.#resetView();
    
    this.documentsData = await this.initializeDocuments(response.result);
    this.previousDocumentsData = structuredClone(this.documentsData);
    this._documenTypes = response.document_types;

    for (const doc of this.documentsData) {
      this.setupState(doc.id);
    }

    this.#renderDocumentContainers();
  }

  setupState(docId) {
    this.documentStates[docId] = {
      state: 'none',
      progress: 0,
      result: null,
      json: null
    };
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
    // Find the thumbnail view corresponding to the page number.
    const thumbnailView = this._thumbnails.find(
      (thumb) => thumb.pageNumber === pageNumber
    );
    if (!thumbnailView) {
      console.error('scrollThumbnailIntoView: Invalid "pageNumber" parameter.');
      return;
    }
  
    // Update thumbnail highlighting.
    if (pageNumber !== this._currentPageNumber) {
      const prevThumbnailView = this._thumbnails[this._currentPageNumber - 1];
      if (prevThumbnailView) {
        prevThumbnailView.div.classList.remove(THUMBNAIL_SELECTED_CLASS);
      }
      thumbnailView.div.classList.add(THUMBNAIL_SELECTED_CLASS);
    }
  
    // Find the document container for this thumbnail.
    const docContainer = thumbnailView.div.closest('.document-container');
    if (!docContainer) {
      console.error(
        'scrollThumbnailIntoView: Unable to find document container for page number:',
        pageNumber
      );
      return;
    }

    const thumbnailContainer = docContainer.querySelector('.thumbnails-container');
    if (!thumbnailContainer) {
      console.error(
        'scrollThumbnailIntoView: Unable to find thumbnail container within document container for page number:',
        pageNumber
      );
      return;
    }
  
    // Update document container highlighting.
    if (this._currentThumbnailContainer) {
      this._currentThumbnailContainer.classList.remove(CONTAINER_SELECTED_CLASS);
    }
    thumbnailContainer.classList.add(CONTAINER_SELECTED_CLASS);
    this._currentThumbnailContainer = thumbnailContainer;
    this._currentDocumentContainer = docContainer;

    this.#displayDocumentForm(docContainer.id);
  
    // Build an array of "views" representing all document containers.
    // Each view object must have a `div` property and an `id`.
    const docContainersViews = Array.from(this.container.children).map(child => ({
      div: child,
      id: child.id
    }));
  
    // Use getVisibleElements to get the currently visible doc containers.
    const visibleDocContainers = getVisibleElements({
      scrollEl: this.container,
      views: docContainersViews,
    });
  
    // Check whether our target container is visible.
    const isVisible = visibleDocContainers.views.some(view => view.id === docContainer.id);
  
    // If the container is not visible, scroll to center it.
    if (!isVisible) {
      const scrollParent = this.container; // In our case, the container is the scroll parent.
      const parentHeight = scrollParent.clientHeight;
      const containerTop = docContainer.offsetTop;
      const containerHeight = docContainer.offsetHeight;
      const desiredScrollTop = containerTop - (parentHeight / 2 - containerHeight / 2);
      scrollParent.scrollTop = desiredScrollTop;
    }
    
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

    this.cleanup();

    // Remove the thumbnails from the DOM.
    this.container.textContent = '';

    console.log("[#resetView] container child count:", this.container.childNodes.length);
  }

  /**
   * @param {PDFDocumentProxy} pdfDocument
   */
  async setDocument(pdfDocument, args={}) {
    if (!pdfDocument) {
      return;
    }

    this.#cancelRendering();
    this.#resetView();

    this.pdfDocument = pdfDocument;
    
    let documentsResponse = args.documentsResponse;
    if (documentsResponse && args.flatPages) {
      const oldToNew = {};
      args.flatPages.forEach((oldPage, i) => {
        oldToNew[oldPage] = i + 1;  // new PDF pages are 1-based
      });

      documentsResponse.result.forEach(doc => {
        doc.pages = doc.pages.map(oldPageNum => oldToNew[oldPageNum]);
      });

      await this.setDocumentsData(documentsResponse);
    }

    // Apply changes
    if (args.documentsData) {
      this.documentsData = args.documentsData;
      this.previousDocumentsData = structuredClone(args.documentsData);
      this.renumberDocsAndPages();
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
    this._selectedThumbnail = this._thumbnails[0];

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

    for (const [docIndex, doc] of this.documentsData.entries()) {
      // Create a container for the document
      const docContainer = document.createElement('div');
      docContainer.classList.add('document-container');
      docContainer.id = doc.id;

      // Checkbox
      const selectDiv = document.createElement('div');
      selectDiv.classList.add('document-select');

      const selectLabel = document.createElement('label');
      selectLabel.textContent = 'Select Document'; // This text will appear next to the checkbox
      selectLabel.classList.add('checkmark-label');

      const selectCheckbox = document.createElement('input');
      selectCheckbox.type = 'checkbox';
      selectCheckbox.id = `select-${doc.id}`; // Ensure this is unique

      const checkmarkSpan = document.createElement('span');
      checkmarkSpan.classList.add('checkmark');

      // Append the checkbox and the custom checkmark span into the label
      selectLabel.appendChild(selectCheckbox);
      selectLabel.appendChild(checkmarkSpan);

      selectDiv.appendChild(selectLabel);
      docContainer.appendChild(selectDiv);


      // Create a form container (optional)
      const formContainer = document.createElement('div');
      formContainer.classList.add('form-container');

      // Create label and text input for File Name
      const fileNameLabel = document.createElement('label');
      fileNameLabel.textContent = 'Document Name';
      fileNameLabel.htmlFor = `file-name-${doc.id}`;
      fileNameLabel.style.display = 'block';
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
      docTypeLabel.style.display = 'block';
      docTypeLabel.style.marginTop = '10px';

      const docTypeSelect = document.createElement('select');
      docTypeSelect.id = `doc-type-${doc.id}`;
      docTypeSelect.style.minWidth = '160px';

      const docTypes = this._documenTypes;
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

      fileNameInput.addEventListener('input', (event) => {
        const newName = event.target.value;
        const document = this.documentsData.find(document => document.id === doc.id);
        if (document) {
          document.document = newName;
        }
      });
      
      docTypeSelect.addEventListener('change', (event) => {
        const newType = event.target.value;
        const document = this.documentsData.find(document => document.id === doc.id);
        if (document) {
          document.document_type = newType;
        }
      });

      // Create a horizontal list of options (delete, download)
      const optionsContainer = document.createElement('div');
      optionsContainer.classList.add('document-container-options');

      // Create Add Container
      const addDocumentIcon = document.createElement('img');
      addDocumentIcon.src = 'images/folder-plus.svg';
      addDocumentIcon.alt = 'Add Document Container';
      addDocumentIcon.title = 'Add Document Container';
      addDocumentIcon.style.display = 'none';
      addDocumentIcon.classList.add('icon-add-document');
      addDocumentIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        const currentContainer = event.target.closest('.document-container');
        const containers = Array.from(this.container.children);
        const index = containers.indexOf(currentContainer);
        this.addNewEmptyDocumentContainer(index + 1, false);
      });
      optionsContainer.appendChild(addDocumentIcon);

      // Create and append new "Extract" div
      const extractIcon = document.createElement('img');
      extractIcon.src = 'images/book-sparkles-solid.svg';
      extractIcon.alt = 'Extract data';
      extractIcon.title = 'Extract data';
      extractIcon.classList.add('document-container-svg-button');
      extractIcon.addEventListener('click', (event) => {
        const docId = doc.id;
        const documentData = this.documentsData.find((d) => d.id === docId);
        const pageNumbers = documentData.pages.map((page) => page.pageNumber);
        this.eventBus.dispatch('document-container-extract', { source: this, docId, pageNumbers });
      });
      optionsContainer.appendChild(extractIcon);

      // Create Delete Icon Image
      const deleteIcon = document.createElement('img');
      deleteIcon.src = 'images/action-trash.png'; // Update with the correct path
      deleteIcon.alt = 'Delete';
      deleteIcon.title = 'Delete';
      deleteIcon.style.display = 'none';
      deleteIcon.classList.add('icon-delete');
      deleteIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeDocumentContainer(doc.id);
      });

      // Create Download Icon Image
      const downloadIcon = document.createElement('img');
      downloadIcon.src = 'images/action-download.png'; // Update with the correct path
      downloadIcon.alt = 'Download';
      downloadIcon.title = 'Download';
      downloadIcon.classList.add('icon-download');
      downloadIcon.addEventListener('click', (event) => {
        event.stopPropagation();

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
          thumbnail.rotation = pdfPage.rotate;
        });

        promises.push(promise);
      }

      this._selectedThumbnail = this._thumbnails[0];

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
      const sortableInstance = Sortable.create(thumbnailsContainer, {
        group: 'shared', // Allow dragging between containers
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        disabled: true,
        onEnd: (evt) => {
          this._onThumbnailDrop(evt);
        },
      });
      this.sortableInstances[doc.id] = sortableInstance;
    }

    // Ensure that the current thumbnail is always highlighted on load.
    const thumbnailView = this._thumbnails[this._currentPageNumber - 1];
    thumbnailView.div.classList.add(THUMBNAIL_SELECTED_CLASS);

    // Also add the CONTAINER_SELECTED_CLASS to the current document's thumbnails container
    const docContainer = thumbnailView.div.closest('.document-container');
    if (docContainer) {
      const thumbnailContainer = docContainer.querySelector('.thumbnails-container');
      if (thumbnailContainer) {
        thumbnailContainer.classList.add(CONTAINER_SELECTED_CLASS);
        this._currentThumbnailContainer = thumbnailContainer;
        this._currentDocumentContainer = docContainer;
      }

      this.#displayDocumentForm(docContainer.id);
    }

    this.allowEdition(PDFViewerApplication.editorState == EditorState.EDIT);

    Promise.all(promises).then(() => {
      this.renderingQueue.renderHighestPriority();
      this.eventBus.dispatch('thumbnailsready', { source: this });
    });
  }

  enableDragAndDrop(flag) {
    Object.values(this.sortableInstances).forEach(instance => {
      instance.option('disabled', !flag);
    });
  }

  getSelectedDocumentContainerIds() {
    const selectedIds = [];
    const docContainers = this.container.querySelectorAll('.document-container');
    docContainers.forEach((docContainer) => {
      const checkbox = docContainer.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        selectedIds.push(docContainer.id);
      }
    });
    return selectedIds;
  }

  toggleAllCheckboxes(selectAll) {
    const checkboxes = document.querySelectorAll('.document-container input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = selectAll;
    });
  }

  toggleInvoicesCheckboxes(selectAll) {
    const docContainers = document.querySelectorAll('.document-container');
    docContainers.forEach((container) => {
      const docTypeSelect = container.querySelector('select[id^="doc-type-"]');
      if (docTypeSelect && docTypeSelect.value === 'Invoice') {
        const checkbox = container.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = selectAll;
        }
      }
    });
  }

  allowEdition(show) {
    const docContainers = document.querySelectorAll('.document-container');
    docContainers.forEach((container) => {
      // Set delete icon display
      const deleteIcon = container.querySelector('.icon-delete');
      if (deleteIcon) {
        deleteIcon.style.display = show ? 'flex' : 'none';
      }
      // Set add document icon display
      const addDocumentIcon = container.querySelector('.icon-add-document');
      if (addDocumentIcon) {
        addDocumentIcon.style.display = show ? 'flex' : 'none';
      }
      
      // Enable/disable text input (document name)
      const textInput = container.querySelector('input[type="text"]');
      if (textInput) {
        textInput.disabled = !show;
      }
      
      // Enable/disable dropdown (document type)
      const dropdown = container.querySelector('select');
      if (dropdown) {
        dropdown.disabled = !show;
      }
    });
  }

  removeDocumentContainer(docId, autoScroll=true) {
    const docContainer = document.getElementById(docId);
    if (docContainer) {
      docContainer.remove();
    }
    
    const docIndex = this.documentsData.findIndex(d => d.id === docId);
    if (docIndex !== -1) {
      this.documentsData.splice(docIndex, 1);
    }
    
    // this._thumbnails = this._thumbnails.filter(thumb => !thumb.id.startsWith(docId));

    if (autoScroll) {
      const currentScrollTop = this.container.scrollTop;
      this.container.scrollTop = currentScrollTop + 1;
      this.container.scrollTop = currentScrollTop;
    }
  }

  getDocumentName(docId) {
    const fileNameInput = this.container.querySelector(`#file-name-${docId}`);
    if (fileNameInput) {
      return fileNameInput.value;
    }
    return null;
  }

  formatToFilename(input) {
    return input
      .trim()
      .split(/\s+/)
      .join('_')
      .toLowerCase();
  }

  resetSelectAll() {
    const mainCheckbox = document.querySelector('#select-all-container input[type="checkbox"]');
    mainCheckbox.checked = false;
    this.toggleAllCheckboxes(false);
  }

  updateThumbnailButtonsVisibility(flag) {
    // Select all actions containers within thumbnails
    const thumbnailsActions = document.querySelectorAll('.thumbnail .actions');
    
    thumbnailsActions.forEach(actionsDiv => {
      // Get all buttons within this actions container
      const buttons = actionsDiv.querySelectorAll('.action-button');
  
      buttons.forEach(button => {
        // Find the icon image inside the button
        const iconImg = button.querySelector('img.icon');
        if (!iconImg) return;
  
        if (flag) {
          // In non-VIEW mode, show all action buttons
          button.style.display = 'inline-flex';
        } else {
          // Hide button if its icon is not the download icon
          if (!iconImg.classList.contains('download-icon')) {
            button.style.display = 'none';
          } else {
            button.style.display = 'inline-flex'; // Show download icon
          }
        }
      });
    });
  
    // Hide/show the delete button for document containers separately
    const containerDeleteButtons = document.querySelectorAll('.document-container .icon-delete');
    containerDeleteButtons.forEach(btn => {
      if (flag) {
        btn.style.display = 'inline-flex'; // Show delete buttons in edit mode
      } else {
        btn.style.display = 'none';        // Hide delete buttons in view mode
      }
    });
  }
  
  // Call this function whenever EditorState changes.

  #updateDocumentUI(docId) {
    const docContainer = this.container.querySelector(`#${docId}`);
    if (!docContainer) return;
  
    const { state, progress } = this.documentStates[docId];
  
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
    if (!this.documentStates[docId]) return;
    this.documentStates[docId].state = state;
    this.#updateDocumentUI(docId);
  }
  
  setDocumentProgress(docId, progressValue) {
    if (!this.documentStates[docId]) return;
    this.documentStates[docId].progress = progressValue;
    this.#updateDocumentUI(docId);
  }

  setDocumentResult(docId, jsonResult, htmlContent) {
    this.documentStates[docId].result = htmlContent;
    this.documentStates[docId].json = jsonResult;
  }

  #displayDocumentForm(docId) {
    if (!this.documentStates[docId]) return;
    const result = this.documentStates[docId].result;
    const rightPanelContent = document.getElementById('rightSidebarContent');
    if (result) {
      rightPanelContent.innerHTML = result;
    } else {
      rightPanelContent.innerHTML = "";
    }
  }

  displayFormForCurrentDocument(docId) {
    const docContainer = this._selectedThumbnail.div.closest('.document-container');
    const selecetdDocId = docContainer.id;
    
    if (selecetdDocId != docId) { return; }
    
    this.#displayDocumentForm(docId);
  }

  // Function to generate a unique ID (you can customize this logic)
  #generateUniqueId() {
    return '_' + Math.random().toString(36).substr(2, 9);
  }

  // Function to add a new empty document container at the beginning
  addNewEmptyDocumentContainer(index=0, autoScroll=true) {
    // Create a new empty document object.
    const newDoc = {
      id: this.#generateUniqueId(),
      document: '',
      document_type: '',
      pages: []
    };

    this.setupState(newDoc.id);
  
    // Insert the new document at the beginning of the documentsData array.
    this.documentsData.splice(index, 0, newDoc);
  
    // Create the main document container.
    const docContainer = document.createElement('div');
    docContainer.classList.add('document-container');
    docContainer.id = newDoc.id;
  
    // --- Checkbox Section ---
    const selectDiv = document.createElement('div');
    selectDiv.classList.add('document-select');
  
    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'Select Document';
    selectLabel.classList.add('checkmark-label');
  
    const selectCheckbox = document.createElement('input');
    selectCheckbox.type = 'checkbox';
    selectCheckbox.id = `select-${newDoc.id}`;
  
    const checkmarkSpan = document.createElement('span');
    checkmarkSpan.classList.add('checkmark');
  
    // Append checkbox and custom checkmark into the label.
    selectLabel.appendChild(selectCheckbox);
    selectLabel.appendChild(checkmarkSpan);
    selectDiv.appendChild(selectLabel);
    docContainer.appendChild(selectDiv);
  
    // --- Form Container (Document Name and Document Type) ---
    const formContainer = document.createElement('div');
    formContainer.classList.add('form-container');
  
    // Document Name input.
    const fileNameLabel = document.createElement('label');
    fileNameLabel.textContent = 'Document Name';
    fileNameLabel.htmlFor = `file-name-${newDoc.id}`;
    fileNameLabel.style.display = 'block';
  
    const fileNameInput = document.createElement('input');
    fileNameInput.type = 'text';
    fileNameInput.id = `file-name-${newDoc.id}`;
    fileNameInput.value = ''; // Empty for a new document
  
    formContainer.appendChild(fileNameLabel);
    formContainer.appendChild(fileNameInput);
  
    // Document Type dropdown.
    const docTypeLabel = document.createElement('label');
    docTypeLabel.textContent = 'Document Type';
    docTypeLabel.htmlFor = `doc-type-${newDoc.id}`;
    docTypeLabel.style.display = 'block';
    docTypeLabel.style.marginTop = '10px';
  
    const docTypeSelect = document.createElement('select');
    docTypeSelect.id = `doc-type-${newDoc.id}`;
    docTypeSelect.style.minWidth = '160px';
  
    // Populate the select element with document types.
    const docTypes = this._documenTypes;
    for (const type of docTypes) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      docTypeSelect.appendChild(option);
    }
    // Set to default (empty) value.
    docTypeSelect.value = '';
  
    formContainer.appendChild(docTypeLabel);
    formContainer.appendChild(docTypeSelect);
    docContainer.appendChild(formContainer);

    fileNameInput.addEventListener('input', (event) => {
      const newName = event.target.value;
      const doc = this.documentsData.find(doc => doc.id === newDoc.id);
      if (doc) {
        doc.document = newName;
      }
    });
    
    docTypeSelect.addEventListener('change', (event) => {
      const newType = event.target.value;
      const doc = this.documentsData.find(doc => doc.id === newDoc.id);
      if (doc) {
        doc.document_type = newType;
      }
    });
  
    // --- Options Container (Extract, Delete, Download) ---
    const optionsContainer = document.createElement('div');
    optionsContainer.classList.add('document-container-options');

    // Create Add Container
    const addDocumentIcon = document.createElement('img');
    addDocumentIcon.src = 'images/folder-plus.svg';
    addDocumentIcon.alt = 'Add Document Container';
    addDocumentIcon.title = 'Add Document Container';
    addDocumentIcon.classList.add('icon-add-document');
    addDocumentIcon.addEventListener('click', (event) => {
      event.stopPropagation();
      const currentContainer = event.target.closest('.document-container');
      const containers = Array.from(this.container.children);
      const index = containers.indexOf(currentContainer);
      this.addNewEmptyDocumentContainer(index + 1, false);
    });
    optionsContainer.appendChild(addDocumentIcon);
  
    // Extract button.
    const extractIcon = document.createElement('img');
    extractIcon.src = 'images/book-sparkles-solid.svg';
    extractIcon.alt = 'Extract data';
    extractIcon.title = 'Extract data';
    extractIcon.classList.add('document-container-svg-button');
    extractIcon.addEventListener('click', (event) => {
      const docId = newDoc.id;
      const documentData = this.documentsData.find((d) => d.id === docId);
      const pageNumbers = documentData.pages.map((page) => page.pageNumber);

      if (!docTypeSelect.value) {
        PDFViewerApplication.showGenericMessage("Select a type before extracting data.");
        return;
      }

      if (pageNumbers.length == 0) {
        PDFViewerApplication.showGenericMessage("The document has no pages");
        return;
      }

      this.eventBus.dispatch('document-container-extract', { source: this, docId, pageNumbers });
    });
    optionsContainer.appendChild(extractIcon);
  
    // Delete icon.
    const deleteIcon = document.createElement('img');
    deleteIcon.src = 'images/action-trash.png';
    deleteIcon.alt = 'Delete';
    deleteIcon.title = 'Delete';
    deleteIcon.classList.add('icon-delete');
    deleteIcon.addEventListener('click', (event) => {
      event.stopPropagation();
      const docId = newDoc.id;
      const containerToRemove = document.getElementById(docId);
      if (containerToRemove) {
        containerToRemove.remove();
      }
      const docIndex = this.documentsData.findIndex((d) => d.id === docId);
      if (docIndex !== -1) {
        this.documentsData.splice(docIndex, 1);
      }
      // Adjust scroll position (forces a reflow).
      const currentScrollTop = this.container.scrollTop;
      this.container.scrollTop = currentScrollTop + 1;
      this.container.scrollTop = currentScrollTop;
    });
    optionsContainer.appendChild(deleteIcon);
  
    // Download icon.
    const downloadIcon = document.createElement('img');
    downloadIcon.src = 'images/action-download.png';
    downloadIcon.alt = 'Download';
    downloadIcon.title = 'Download';
    downloadIcon.classList.add('icon-download');
    downloadIcon.addEventListener('click', (event) => {
      event.stopPropagation();
      const docId = newDoc.id;
      const documentData = this.documentsData.find((d) => d.id === docId);
      const pageNumbers = documentData.pages.map((page) => page.pageNumber);
      this.eventBus.dispatch('document-container-download', { source: this, docId, pageNumbers });
    });
    optionsContainer.appendChild(downloadIcon);
    docContainer.appendChild(optionsContainer);
  
    // --- Thumbnails Container (empty for a new document) ---
    const thumbnailsContainer = document.createElement('div');
    thumbnailsContainer.classList.add('thumbnails-container');
    thumbnailsContainer.style.display = 'flex';
    thumbnailsContainer.style.flexWrap = 'wrap';
    docContainer.appendChild(thumbnailsContainer);
  
    // --- Status Area (Progress bar, progress description, error message with retry) ---
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
      const docId = newDoc.id;
      this.eventBus.dispatch('document-container-retry', { source: this, docId });
    });
    errorContainer.appendChild(retryButton);
  
    statusContainer.appendChild(progressBar);
    statusContainer.appendChild(progressDescription);
    statusContainer.appendChild(errorContainer);
    docContainer.appendChild(statusContainer);
  
    // --- Append the Document Container ---
    this.container.insertBefore(
      docContainer,
      this.container.children[index] || null
    );
  
    // --- Enable Drag & Drop on the Thumbnails Container ---
    const sortableInstance = Sortable.create(thumbnailsContainer, {
      group: 'shared', // Allow dragging between containers
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: (evt) => {
        this._onThumbnailDrop(evt);
      },
    });
    this.sortableInstances[newDoc.id] = sortableInstance;
  
    if (autoScroll) {
      // Scroll the new document container into view.
      scrollIntoView(docContainer, { top: THUMBNAIL_SCROLL_MARGIN });
    }
  }

  _onSelectThumbnail(evt) {
    switch (PDFViewerApplication.viewState) {
      case ViewType.NORMAL:
        return;
      case ViewType.GROUPED:
        const { source, id } = evt;
        const thumbnail = source;
        const docContainer = thumbnail.div.closest('.document-container');
        const docId = docContainer.id;
        this._selectedThumbnail = source;
        this.#displayDocumentForm(docId);

        break;
    }
  }

  async _onDeleteThumbnail(evt) {
    const { source, id } = evt;
    const thumbnail = source;
  
    for (const doc of this.documentsData) {
      const pageIndex = doc.pages.findIndex((page) => page.id === thumbnail.id);
      if (pageIndex !== -1) {
        doc.pages.splice(pageIndex, 1);
        break;
      }
    }
  
    const thumbIndex = this._thumbnails.indexOf(thumbnail);
    if (thumbIndex !== -1) {
      this._thumbnails.splice(thumbIndex, 1);
    }
  
    thumbnail.div.remove();
    this.renderingQueue.renderHighestPriority();
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
    const fromDocContainer = from.closest('.document-container');
    const toDocContainer = to.closest('.document-container');
    
    const fromDocId = fromDocContainer.id;
    const toDocId = toDocContainer.id;
    
    // 1) Identify the "fromDoc" and "toDoc" in documentsData.
    const fromDocIndex = this.documentsData.findIndex(doc => doc.id === fromDocId);
    const toDocIndex = this.documentsData.findIndex(doc => doc.id === toDocId);
    const fromDoc = this.documentsData[fromDocIndex];
    const toDoc = this.documentsData[toDocIndex];
    
    // 2) Remove the page from the source doc and insert into destination doc
    const [movedPage] = fromDoc.pages.splice(oldIndex, 1);
    toDoc.pages.splice(newIndex, 0, movedPage);
    
    // 4) Re-render or at least re-queue the rendering so we see the changes.
    this.renderingQueue.renderHighestPriority();
  }

  _onRotateThumbnail(evt) {
    const { source } = evt;
    const thumbnail = source;
  
    const docContainer = thumbnail.div.closest('.document-container');
    const docId = docContainer?.id;
    if (!docId) return;
  
    const doc = this.documentsData.find(d => d.id === docId);
    if (!doc) return;
  
    const page = doc.pages.find(p => p.id === thumbnail.id);
    if (!page) return;
  
    const newRotation = ((thumbnail.rotation || 0) + 90) % 360;
    page.rotation = newRotation;
  
    thumbnail.reRenderWithRotation(newRotation)
      .catch(err => {
        console.error("Error in reRenderWithRotation:", err);
      });
  
    this.renderingQueue.renderHighestPriority();
  }

  renumberDocsAndPages() {
    let globalPageNumber = 1;
  
    // Loop over each doc in documentsData
    for (let docIndex = 0; docIndex < this.documentsData.length; docIndex++) {
      const doc = this.documentsData[docIndex];
  
      // Now loop over the pages in this doc
      for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
        const page = doc.pages[pageIndex];
        const oldPageId = page.id;
        const newPageId = `doc-${docIndex}-page-${pageIndex}`;
  
        // Update the page's ID
        page.id = newPageId;
  
        // Update pageNumber to either doc-local or global numbering:
        // For doc-local:  page.pageNumber = pageIndex + 1;
        // For global:     page.pageNumber = globalPageNumber++;
        page.pageNumber = globalPageNumber++;
  
        // Find the corresponding thumbnail in _thumbnails (by old ID).
        const thumbIndex = this._thumbnails.findIndex(t => t.id === oldPageId);
        if (thumbIndex !== -1) {
          // Update the thumbnail's own ID
          this._thumbnails[thumbIndex].id = newPageId;
          this._thumbnails[thumbIndex].div.id = newPageId;
  
          const label = page.pageNumber.toString();
          this._thumbnails[thumbIndex].setPageLabel(label);
        }
      }
    }
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