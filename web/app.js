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

/** @typedef {import("./interfaces.js").IL10n} IL10n */
// eslint-disable-next-line max-len
/** @typedef {import("../src/display/api.js").PDFDocumentProxy} PDFDocumentProxy */
// eslint-disable-next-line max-len
/** @typedef {import("../src/display/api.js").PDFDocumentLoadingTask} PDFDocumentLoadingTask */

import { PDFDocument, degrees } from 'https://cdn.jsdelivr.net/npm/pdf-lib/+esm';
import { zipSync } from "https://cdn.skypack.dev/fflate";
import {
  animationStarted,
  apiPageLayoutToViewerModes,
  apiPageModeToSidebarView,
  AutoPrintRegExp,
  CursorTool,
  DEFAULT_SCALE_VALUE,
  getActiveOrFocusedElement,
  isValidRotation,
  isValidScrollMode,
  isValidSpreadMode,
  normalizeWheelEventDirection,
  parseQueryString,
  ProgressBar,
  RenderingStates,
  ScrollMode,
  SidebarView,
  SpreadMode,
  TextLayerMode,
} from "./ui_utils.js";
import {
  AnnotationEditorType,
  build,
  FeatureTest,
  getDocument,
  getFilenameFromUrl,
  getPdfFilenameFromUrl,
  GlobalWorkerOptions,
  InvalidPDFException,
  isDataScheme,
  isPdfFile,
  MissingPDFException,
  PDFWorker,
  shadow,
  UnexpectedResponseException,
  version,
} from "pdfjs-lib";
import { AppOptions, OptionKind } from "./app_options.js";
import { EventBus, FirefoxEventBus } from "./event_utils.js";
import { ExternalServices, initCom, MLManager } from "web-external_services";
import {
  ImageAltTextSettings,
  NewAltTextManager,
} from "web-new_alt_text_manager";
import { LinkTarget, PDFLinkService } from "./pdf_link_service.js";
import { AltTextManager } from "web-alt_text_manager";
import { AnnotationEditorParams } from "web-annotation_editor_params";
import { CaretBrowsingMode } from "./caret_browsing.js";
import { DownloadManager } from "web-download_manager";
import { OverlayManager } from "./overlay_manager.js";
import { PasswordPrompt } from "./password_prompt.js";
import { PDFAttachmentViewer } from "web-pdf_attachment_viewer";
import { PDFCursorTools } from "web-pdf_cursor_tools";
import { PDFDocumentProperties } from "web-pdf_document_properties";
import { PDFFindBar } from "web-pdf_find_bar";
import { PDFFindController } from "./pdf_find_controller.js";
import { PDFHistory } from "./pdf_history.js";
import { PDFLayerViewer } from "web-pdf_layer_viewer";
import { PDFOutlineViewer } from "web-pdf_outline_viewer";
import { PDFPresentationMode } from "web-pdf_presentation_mode";
import { PDFPrintServiceFactory } from "web-print_service";
import { PDFRenderingQueue } from "./pdf_rendering_queue.js";
import { PDFScriptingManager } from "./pdf_scripting_manager.js";
import { PDFSidebar } from "web-pdf_sidebar";
import { PDFThumbnailViewer } from "web-pdf_thumbnail_viewer";
import { PDFViewer } from "./pdf_viewer.js";
import { Preferences } from "web-preferences";
import { SecondaryToolbar } from "web-secondary_toolbar";
import { Toolbar } from "web-toolbar";
import { ViewHistory } from "./view_history.js";
import { PDFRightSidebar } from './pdf_rightsidebar.js';
import { ConcurrencyQueue } from './concurrency_queue.js';

const FORCE_PAGES_LOADED_TIMEOUT = 10000; // ms

const ViewOnLoad = {
  UNKNOWN: -1,
  PREVIOUS: 0,
  INITIAL: 1,
};

const ViewType = Object.freeze({
  NORMAL: 'NORMAL',
  GROUPED: 'GROUPED',
});

const EditorState = Object.freeze({
  VIEW: 'VIEW',
  EDIT: 'EDIT',
});

const API_URL = 'https://research.landgorilla.dev';
// const API_URL = 'http://localhost:8083';

const PDFViewerApplication = {
  initialBookmark: document.location.hash.substring(1),
  _initializedCapability: {
    ...Promise.withResolvers(),
    settled: false,
  },
  appConfig: null,
  /** @type {PDFDocumentProxy} */
  pdfDocument: null,
  /** @type {PDFDocumentLoadingTask} */
  pdfLoadingTask: null,
  printService: null,
  /** @type {PDFViewer} */
  pdfViewer: null,
  /** @type {PDFThumbnailViewer} */
  pdfThumbnailViewer: null,
  /** @type {PDFRenderingQueue} */
  pdfRenderingQueue: null,
  /** @type {PDFPresentationMode} */
  pdfPresentationMode: null,
  /** @type {PDFDocumentProperties} */
  pdfDocumentProperties: null,
  /** @type {PDFLinkService} */
  pdfLinkService: null,
  /** @type {PDFHistory} */
  pdfHistory: null,
  /** @type {PDFSidebar} */
  pdfSidebar: null,
  /** @type {PDFOutlineViewer} */
  pdfOutlineViewer: null,
  /** @type {PDFAttachmentViewer} */
  pdfAttachmentViewer: null,
  /** @type {PDFLayerViewer} */
  pdfLayerViewer: null,
  /** @type {PDFCursorTools} */
  pdfCursorTools: null,
  /** @type {PDFScriptingManager} */
  pdfScriptingManager: null,
  /** @type {ViewHistory} */
  store: null,
  /** @type {DownloadManager} */
  downloadManager: null,
  /** @type {OverlayManager} */
  overlayManager: null,
  /** @type {Preferences} */
  preferences: new Preferences(),
  /** @type {Toolbar} */
  toolbar: null,
  /** @type {SecondaryToolbar} */
  secondaryToolbar: null,
  /** @type {EventBus} */
  eventBus: null,
  /** @type {IL10n} */
  l10n: null,
  /** @type {AnnotationEditorParams} */
  annotationEditorParams: null,
  /** @type {ImageAltTextSettings} */
  imageAltTextSettings: null,
  isInitialViewSet: false,
  isViewerEmbedded: window.parent !== window,
  url: "",
  baseUrl: "",
  mlManager: null,
  _downloadUrl: "",
  _eventBusAbortController: null,
  _windowAbortController: null,
  _globalAbortController: new AbortController(),
  documentInfo: null,
  metadata: null,
  _contentDispositionFilename: null,
  _contentLength: null,
  _saveInProgress: false,
  _wheelUnusedTicks: 0,
  _wheelUnusedFactor: 1,
  _touchUnusedTicks: 0,
  _touchUnusedFactor: 1,
  _PDFBug: null,
  _hasAnnotationEditors: false,
  _title: document.title,
  _printAnnotationStoragePromise: null,
  _touchInfo: null,
  _isCtrlKeyDown: false,
  _caretBrowsing: null,
  _isScrolling: false,
  accessToken: null,
  viewState: ViewType.NORMAL,
  editorState: EditorState.VIEW,

  // Called once when the document is loaded.
  async initialize(appConfig) {
    this.appConfig = appConfig;

    // Ensure that `Preferences`, and indirectly `AppOptions`, have initialized
    // before creating e.g. the various viewer components.
    try {
      await this.preferences.initializedPromise;
    } catch (ex) {
      console.error(`initialize: "${ex.message}".`);
    }
    if (AppOptions.get("pdfBugEnabled")) {
      await this._parseHashParams();
    }

    if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
      let mode;
      switch (AppOptions.get("viewerCssTheme")) {
        case 1:
          mode = "is-light";
          break;
        case 2:
          mode = "is-dark";
          break;
      }
      if (mode) {
        document.documentElement.classList.add(mode);
      }
      if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
        if (AppOptions.get("enableFakeMLManager")) {
          this.mlManager =
            MLManager.getFakeMLManager?.({
              enableGuessAltText: AppOptions.get("enableGuessAltText"),
              enableAltTextModelDownload: AppOptions.get(
                "enableAltTextModelDownload"
              ),
            }) || null;
        }
      }
    } else if (AppOptions.get("enableAltText")) {
      // We want to load the image-to-text AI engine as soon as possible.
      this.mlManager = new MLManager({
        enableGuessAltText: AppOptions.get("enableGuessAltText"),
        enableAltTextModelDownload: AppOptions.get(
          "enableAltTextModelDownload"
        ),
        altTextLearnMoreUrl: AppOptions.get("altTextLearnMoreUrl"),
      });
    }

    // Ensure that the `L10n`-instance has been initialized before creating
    // e.g. the various viewer components.
    this.l10n = await this.externalServices.createL10n();
    document.getElementsByTagName("html")[0].dir = this.l10n.getDirection();
    // Connect Fluent, when necessary, and translate what we already have.
    if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
      this.l10n.translate(appConfig.appContainer || document.documentElement);
    }

    if (
      this.isViewerEmbedded &&
      AppOptions.get("externalLinkTarget") === LinkTarget.NONE
    ) {
      // Prevent external links from "replacing" the viewer,
      // when it's embedded in e.g. an <iframe> or an <object>.
      AppOptions.set("externalLinkTarget", LinkTarget.TOP);
    }
    await this._initializeViewerComponents();

    // Bind the various event handlers *after* the viewer has been
    // initialized, to prevent errors if an event arrives too soon.
    this.bindEvents();
    this.bindWindowEvents();

    this._initializedCapability.settled = true;
    this._initializedCapability.resolve();
  },

  /**
   * Potentially parse special debugging flags in the hash section of the URL.
   * @private
   */
  async _parseHashParams() {
    const hash = document.location.hash.substring(1);
    if (!hash) {
      return;
    }
    const { mainContainer, viewerContainer } = this.appConfig,
      params = parseQueryString(hash);

    const loadPDFBug = async () => {
      if (this._PDFBug) {
        return;
      }
      const { PDFBug } =
        typeof PDFJSDev === "undefined"
          ? await import(AppOptions.get("debuggerSrc")) // eslint-disable-line no-unsanitized/method
          : await __non_webpack_import__(AppOptions.get("debuggerSrc"));

      this._PDFBug = PDFBug;
    };

    // Parameters that need to be handled manually.
    if (params.get("disableworker") === "true") {
      try {
        GlobalWorkerOptions.workerSrc ||= AppOptions.get("workerSrc");

        if (typeof PDFJSDev === "undefined") {
          globalThis.pdfjsWorker = await import("pdfjs/pdf.worker.js");
        } else {
          await __non_webpack_import__(PDFWorker.workerSrc);
        }
      } catch (ex) {
        console.error(`_parseHashParams: "${ex.message}".`);
      }
    }
    if (params.has("textlayer")) {
      switch (params.get("textlayer")) {
        case "off":
          AppOptions.set("textLayerMode", TextLayerMode.DISABLE);
          break;
        case "visible":
        case "shadow":
        case "hover":
          viewerContainer.classList.add(`textLayer-${params.get("textlayer")}`);
          try {
            await loadPDFBug();
            this._PDFBug.loadCSS();
          } catch (ex) {
            console.error(`_parseHashParams: "${ex.message}".`);
          }
          break;
      }
    }
    if (params.has("pdfbug")) {
      AppOptions.setAll({ pdfBug: true, fontExtraProperties: true });

      const enabled = params.get("pdfbug").split(",");
      try {
        await loadPDFBug();
        this._PDFBug.init(mainContainer, enabled);
      } catch (ex) {
        console.error(`_parseHashParams: "${ex.message}".`);
      }
    }
    // It is not possible to change locale for the (various) extension builds.
    if (
      (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) &&
      params.has("locale")
    ) {
      AppOptions.set("localeProperties", { lang: params.get("locale") });
    }

    // Parameters that can be handled automatically.
    const opts = {
      disableAutoFetch: x => x === "true",
      disableFontFace: x => x === "true",
      disableHistory: x => x === "true",
      disableRange: x => x === "true",
      disableStream: x => x === "true",
      verbosity: x => x | 0,
    };

    // Set some specific preferences for tests.
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("TESTING")) {
      Object.assign(opts, {
        enableAltText: x => x === "true",
        enableFakeMLManager: x => x === "true",
        enableGuessAltText: x => x === "true",
        enableUpdatedAddImage: x => x === "true",
        highlightEditorColors: x => x,
        maxCanvasPixels: x => parseInt(x),
        spreadModeOnLoad: x => parseInt(x),
        supportsCaretBrowsingMode: x => x === "true",
      });
    }

    for (const name in opts) {
      const check = opts[name],
        key = name.toLowerCase();

      if (params.has(key)) {
        AppOptions.set(name, check(params.get(key)));
      }
    }
  },

  /**
   * @private
   */
  async _initializeViewerComponents() {
    const { appConfig, externalServices, l10n } = this;

    const eventBus =
      typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")
        ? new FirefoxEventBus(
            AppOptions.get("allowedGlobalEvents"),
            externalServices,
            AppOptions.get("isInAutomation")
          )
        : new EventBus();
    this.eventBus = AppOptions.eventBus = eventBus;
    this.mlManager?.setEventBus(eventBus, this._globalAbortController.signal);

    this.overlayManager = new OverlayManager();

    const pdfRenderingQueue = new PDFRenderingQueue();
    pdfRenderingQueue.onIdle = this._cleanup.bind(this);
    this.pdfRenderingQueue = pdfRenderingQueue;

    const pdfLinkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: AppOptions.get("externalLinkTarget"),
      externalLinkRel: AppOptions.get("externalLinkRel"),
      ignoreDestinationZoom: AppOptions.get("ignoreDestinationZoom"),
    });
    this.pdfLinkService = pdfLinkService;

    const downloadManager = (this.downloadManager = new DownloadManager());

    const findController = new PDFFindController({
      linkService: pdfLinkService,
      eventBus,
      updateMatchesCountOnProgress:
        typeof PDFJSDev === "undefined"
          ? !window.isGECKOVIEW
          : !PDFJSDev.test("GECKOVIEW"),
    });
    this.findController = findController;

    const pdfScriptingManager = new PDFScriptingManager({
      eventBus,
      externalServices,
      docProperties: this._scriptingDocProperties.bind(this),
    });
    this.pdfScriptingManager = pdfScriptingManager;

    const container = appConfig.mainContainer,
      viewer = appConfig.viewerContainer;
    const annotationEditorMode = AppOptions.get("annotationEditorMode");
    const pageColors =
      AppOptions.get("forcePageColors") ||
      window.matchMedia("(forced-colors: active)").matches
        ? {
            background: AppOptions.get("pageColorsBackground"),
            foreground: AppOptions.get("pageColorsForeground"),
          }
        : null;
    let altTextManager;
    if (AppOptions.get("enableUpdatedAddImage")) {
      altTextManager = appConfig.newAltTextDialog
        ? new NewAltTextManager(
            appConfig.newAltTextDialog,
            this.overlayManager,
            eventBus
          )
        : null;
    } else {
      altTextManager = appConfig.altTextDialog
        ? new AltTextManager(
            appConfig.altTextDialog,
            container,
            this.overlayManager,
            eventBus
          )
        : null;
    }

    const enableHWA = AppOptions.get("enableHWA");
    const pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      renderingQueue: pdfRenderingQueue,
      linkService: pdfLinkService,
      downloadManager,
      altTextManager,
      findController,
      scriptingManager:
        AppOptions.get("enableScripting") && pdfScriptingManager,
      l10n,
      textLayerMode: AppOptions.get("textLayerMode"),
      annotationMode: AppOptions.get("annotationMode"),
      annotationEditorMode,
      annotationEditorHighlightColors: AppOptions.get("highlightEditorColors"),
      enableHighlightFloatingButton: AppOptions.get(
        "enableHighlightFloatingButton"
      ),
      enableUpdatedAddImage: AppOptions.get("enableUpdatedAddImage"),
      enableNewAltTextWhenAddingImage: AppOptions.get(
        "enableNewAltTextWhenAddingImage"
      ),
      imageResourcesPath: AppOptions.get("imageResourcesPath"),
      enablePrintAutoRotate: AppOptions.get("enablePrintAutoRotate"),
      maxCanvasPixels: AppOptions.get("maxCanvasPixels"),
      enablePermissions: AppOptions.get("enablePermissions"),
      pageColors,
      mlManager: this.mlManager,
      abortSignal: this._globalAbortController.signal,
      enableHWA,
    });
    this.pdfViewer = pdfViewer;

    pdfRenderingQueue.setViewer(pdfViewer);
    pdfLinkService.setViewer(pdfViewer);
    pdfScriptingManager.setViewer(pdfViewer);

    if (appConfig.sidebar?.thumbnailView) {
      this.pdfThumbnailViewer = new PDFThumbnailViewer({
        container: appConfig.sidebar.thumbnailView,
        eventBus,
        renderingQueue: pdfRenderingQueue,
        linkService: pdfLinkService,
        pageColors,
        abortSignal: this._globalAbortController.signal,
        enableHWA
      });
      pdfRenderingQueue.setThumbnailViewer(this.pdfThumbnailViewer);
    }

    // The browsing history is only enabled when the viewer is standalone,
    // i.e. not when it is embedded in a web page.
    if (!this.isViewerEmbedded && !AppOptions.get("disableHistory")) {
      this.pdfHistory = new PDFHistory({
        linkService: pdfLinkService,
        eventBus,
      });
      pdfLinkService.setHistory(this.pdfHistory);
    }

    if (!this.supportsIntegratedFind && appConfig.findBar) {
      this.findBar = new PDFFindBar(
        appConfig.findBar,
        appConfig.principalContainer,
        eventBus
      );
    }

    if (appConfig.annotationEditorParams) {
      if (
        ((typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) ||
          typeof AbortSignal.any === "function") &&
        annotationEditorMode !== AnnotationEditorType.DISABLE
      ) {
        this.annotationEditorParams = new AnnotationEditorParams(
          appConfig.annotationEditorParams,
          eventBus
        );
      } else {
        for (const id of ["editorModeButtons", "editorModeSeparator"]) {
          document.getElementById(id)?.classList.add("hidden");
        }
      }
    }

    if (
      this.mlManager &&
      appConfig.secondaryToolbar?.imageAltTextSettingsButton
    ) {
      this.imageAltTextSettings = new ImageAltTextSettings(
        appConfig.altTextSettingsDialog,
        this.overlayManager,
        eventBus,
        this.mlManager
      );
    }

    if (appConfig.documentProperties) {
      this.pdfDocumentProperties = new PDFDocumentProperties(
        appConfig.documentProperties,
        this.overlayManager,
        eventBus,
        l10n,
        /* fileNameLookup = */ () => this._docFilename
      );
    }

    // NOTE: The cursor-tools are unlikely to be helpful/useful in GeckoView,
    // in particular the `HandTool` which basically simulates touch scrolling.
    if (appConfig.secondaryToolbar?.cursorHandToolButton) {
      this.pdfCursorTools = new PDFCursorTools({
        container,
        eventBus,
        cursorToolOnLoad: AppOptions.get("cursorToolOnLoad"),
      });
    }

    if (appConfig.toolbar) {
      if (
        typeof PDFJSDev === "undefined"
          ? window.isGECKOVIEW
          : PDFJSDev.test("GECKOVIEW")
      ) {
        const nimbusData = JSON.parse(
          AppOptions.get("nimbusDataStr") || "null"
        );
        this.toolbar = new Toolbar(appConfig.toolbar, eventBus, nimbusData);
      } else {
        this.toolbar = new Toolbar(
          appConfig.toolbar,
          eventBus,
          AppOptions.get("toolbarDensity")
        );
      }
    }

    if (appConfig.secondaryToolbar) {
      if (AppOptions.get("enableAltText")) {
        appConfig.secondaryToolbar.imageAltTextSettingsButton?.classList.remove(
          "hidden"
        );
        appConfig.secondaryToolbar.imageAltTextSettingsSeparator?.classList.remove(
          "hidden"
        );
      }

      this.secondaryToolbar = new SecondaryToolbar(
        appConfig.secondaryToolbar,
        eventBus
      );
    }

    if (
      this.supportsFullscreen &&
      appConfig.secondaryToolbar?.presentationModeButton
    ) {
      this.pdfPresentationMode = new PDFPresentationMode({
        container,
        pdfViewer,
        eventBus,
      });
    }

    if (appConfig.passwordOverlay) {
      this.passwordPrompt = new PasswordPrompt(
        appConfig.passwordOverlay,
        this.overlayManager,
        this.isViewerEmbedded
      );
    }

    if (appConfig.sidebar?.outlineView) {
      this.pdfOutlineViewer = new PDFOutlineViewer({
        container: appConfig.sidebar.outlineView,
        eventBus,
        l10n,
        linkService: pdfLinkService,
        downloadManager,
      });
    }

    if (appConfig.sidebar?.attachmentsView) {
      this.pdfAttachmentViewer = new PDFAttachmentViewer({
        container: appConfig.sidebar.attachmentsView,
        eventBus,
        l10n,
        downloadManager,
      });
    }

    if (appConfig.sidebar?.layersView) {
      this.pdfLayerViewer = new PDFLayerViewer({
        container: appConfig.sidebar.layersView,
        eventBus,
        l10n,
      });
    }

    if (appConfig.sidebar) {
      this.pdfSidebar = new PDFSidebar({
        elements: appConfig.sidebar,
        eventBus,
        l10n,
      });
      this.pdfSidebar.onToggled = this.forceRendering.bind(this);
      this.pdfSidebar.onUpdateThumbnails = () => {
        // Use the rendered pages to set the corresponding thumbnail images.
        for (const pageView of pdfViewer.getCachedPageViews()) {
          if (pageView.renderingState === RenderingStates.FINISHED) {
            this.pdfThumbnailViewer
              .getThumbnail(pageView.id - 1)
              ?.setImage(pageView);
          }
        }
        this.pdfThumbnailViewer.scrollThumbnailIntoView(
          pdfViewer.currentPageNumber
        );
      };
    }

    const outerContainer = document.getElementById('outerContainer');
    const rightSidebarContainer = document.getElementById('rightSidebarContainer');
    const rightSidebarResizer = document.getElementById('rightSidebarResizer');

    this.pdfRightSidebar = new PDFRightSidebar({
      outerContainer,
      rightSidebarContainer,
      rightSidebarResizer
    });

    this.refreshOptions();
  },

  async run(config) {
    await this.initialize(config);

    const { appConfig, eventBus } = this;
    let file;
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      const queryString = document.location.search.substring(1);
      const params = parseQueryString(queryString);
      file = params.get("file") ?? AppOptions.get("defaultUrl");
      validateFileURL(file);
    } else if (PDFJSDev.test("MOZCENTRAL")) {
      file = window.location.href;
    } else if (PDFJSDev.test("CHROME")) {
      file = AppOptions.get("defaultUrl");
    }

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      const fileInput = (this._openFileInput = document.createElement("input"));
      fileInput.id = "fileInput";
      fileInput.hidden = true;
      fileInput.type = "file";
      fileInput.value = null;
      document.body.append(fileInput);

      fileInput.addEventListener("change", function (evt) {
        const { files } = evt.target;
        if (!files || files.length === 0) {
          return;
        }
        eventBus.dispatch("fileinputchange", {
          source: this,
          fileInput: evt.target,
        });
      });

      // Enable dragging-and-dropping a new PDF file onto the viewerContainer.
      appConfig.mainContainer.addEventListener("dragover", function (evt) {
        for (const item of evt.dataTransfer.items) {
          if (item.type === "application/pdf") {
            evt.dataTransfer.dropEffect =
              evt.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
        }
      });
      appConfig.mainContainer.addEventListener("drop", function (evt) {
        if (evt.dataTransfer.files?.[0].type !== "application/pdf") {
          return;
        }
        evt.preventDefault();
        evt.stopPropagation();
        eventBus.dispatch("fileinputchange", {
          source: this,
          fileInput: evt.dataTransfer,
        });
      });
    }

    if (!AppOptions.get("supportsDocumentFonts")) {
      AppOptions.set("disableFontFace", true);
      this.l10n.get("pdfjs-web-fonts-disabled").then(msg => {
        console.warn(msg);
      });
    }

    if (!this.supportsPrinting) {
      appConfig.toolbar?.print?.classList.add("hidden");
      appConfig.secondaryToolbar?.printButton.classList.add("hidden");
    }

    if (!this.supportsFullscreen) {
      appConfig.secondaryToolbar?.presentationModeButton.classList.add(
        "hidden"
      );
    }

    if (this.supportsIntegratedFind) {
      appConfig.findBar?.toggleButton?.classList.add("hidden");
    }

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      if (file) {
        this.open({ url: file });
      } else {
        this._hideViewBookmark();
      }
    } else if (PDFJSDev.test("MOZCENTRAL || CHROME")) {
      this.setTitleUsingUrl(file, /* downloadUrl = */ file);

      this.externalServices.initPassiveLoading();
    } else {
      throw new Error("Not implemented: run");
    }
  },

  get externalServices() {
    return shadow(this, "externalServices", new ExternalServices());
  },

  get initialized() {
    return this._initializedCapability.settled;
  },

  get initializedPromise() {
    return this._initializedCapability.promise;
  },

  updateZoom(steps, scaleFactor, origin) {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.updateScale({
      drawingDelay: AppOptions.get("defaultZoomDelay"),
      steps,
      scaleFactor,
      origin,
    });
  },

  zoomIn() {
    this.updateZoom(1);
  },

  zoomOut() {
    this.updateZoom(-1);
  },

  zoomReset() {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;
  },

  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  },

  get page() {
    return this.pdfViewer.currentPageNumber;
  },

  set page(val) {
    this.pdfViewer.currentPageNumber = val;
  },

  get supportsPrinting() {
    return PDFPrintServiceFactory.supportsPrinting;
  },

  get supportsFullscreen() {
    return shadow(this, "supportsFullscreen", document.fullscreenEnabled);
  },

  get supportsPinchToZoom() {
    return shadow(
      this,
      "supportsPinchToZoom",
      AppOptions.get("supportsPinchToZoom")
    );
  },

  get supportsIntegratedFind() {
    return shadow(
      this,
      "supportsIntegratedFind",
      AppOptions.get("supportsIntegratedFind")
    );
  },

  get loadingBar() {
    const barElement = document.getElementById("loadingBar");
    const bar = barElement ? new ProgressBar(barElement) : null;
    return shadow(this, "loadingBar", bar);
  },

  get supportsMouseWheelZoomCtrlKey() {
    return shadow(
      this,
      "supportsMouseWheelZoomCtrlKey",
      AppOptions.get("supportsMouseWheelZoomCtrlKey")
    );
  },

  get supportsMouseWheelZoomMetaKey() {
    return shadow(
      this,
      "supportsMouseWheelZoomMetaKey",
      AppOptions.get("supportsMouseWheelZoomMetaKey")
    );
  },

  get supportsCaretBrowsingMode() {
    return AppOptions.get("supportsCaretBrowsingMode");
  },

  moveCaret(isUp, select) {
    this._caretBrowsing ||= new CaretBrowsingMode(
      this._globalAbortController.signal,
      this.appConfig.mainContainer,
      this.appConfig.viewerContainer,
      this.appConfig.toolbar?.container
    );
    this._caretBrowsing.moveCaret(isUp, select);
  },

  setTitleUsingUrl(url = "", downloadUrl = null) {
    this.url = url;
    this.baseUrl = url.split("#", 1)[0];
    if (downloadUrl) {
      this._downloadUrl =
        downloadUrl === url ? this.baseUrl : downloadUrl.split("#", 1)[0];
    }
    if (isDataScheme(url)) {
      this._hideViewBookmark();
    } else if (
      typeof PDFJSDev !== "undefined" &&
      PDFJSDev.test("MOZCENTRAL || CHROME")
    ) {
      AppOptions.set("docBaseUrl", this.baseUrl);
    }

    let title = getPdfFilenameFromUrl(url, "");
    if (!title) {
      try {
        title = decodeURIComponent(getFilenameFromUrl(url));
      } catch {
        // decodeURIComponent may throw URIError.
      }
    }
    this.setTitle(title || url); // Always fallback to the raw URL.
  },

  setTitle(title = this._title) {
    this._title = title;

    if (this.isViewerEmbedded) {
      // Embedded PDF viewers should not be changing their parent page's title.
      return;
    }
    const editorIndicator =
      this._hasAnnotationEditors && !this.pdfRenderingQueue.printing;
    document.title = `${editorIndicator ? "* " : ""}${title}`;
  },

  get _docFilename() {
    // Use `this.url` instead of `this.baseUrl` to perform filename detection
    // based on the reference fragment as ultimate fallback if needed.
    return this._contentDispositionFilename || getPdfFilenameFromUrl(this.url);
  },

  /**
   * @private
   */
  _hideViewBookmark() {
    const { secondaryToolbar } = this.appConfig;
    // URL does not reflect proper document location - hiding some buttons.
    secondaryToolbar?.viewBookmarkButton.classList.add("hidden");

    // Avoid displaying multiple consecutive separators in the secondaryToolbar.
    if (secondaryToolbar?.presentationModeButton.classList.contains("hidden")) {
      document.getElementById("viewBookmarkSeparator")?.classList.add("hidden");
    }
  },

  /**
   * Closes opened PDF document.
   * @returns {Promise} - Returns the promise, which is resolved when all
   *                      destruction is completed.
   */
  async close() {
    this._unblockDocumentLoadEvent();
    this._hideViewBookmark();

    if (!this.pdfLoadingTask) {
      return;
    }
    if (
      (typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("GENERIC && !TESTING")) &&
      this.pdfDocument?.annotationStorage.size > 0 &&
      this._annotationStorageModified
    ) {
      try {
        // Trigger saving, to prevent data loss in forms; see issue 12257.
        await this.save();
      } catch {
        // Ignoring errors, to ensure that document closing won't break.
      }
    }
    const promises = [];

    promises.push(this.pdfLoadingTask.destroy());
    this.pdfLoadingTask = null;

    if (this.pdfDocument) {
      this.pdfDocument = null;

      await this.pdfThumbnailViewer?.setDocument(null);
      this.pdfViewer.setDocument(null);
      this.pdfLinkService.setDocument(null);
      this.pdfDocumentProperties?.setDocument(null);
    }
    this.pdfLinkService.externalLinkEnabled = true;
    this.store = null;
    this.isInitialViewSet = false;
    this.url = "";
    this.baseUrl = "";
    this._downloadUrl = "";
    this.documentInfo = null;
    this.metadata = null;
    this._contentDispositionFilename = null;
    this._contentLength = null;
    this._saveInProgress = false;
    this._hasAnnotationEditors = false;

    promises.push(
      this.pdfScriptingManager.destroyPromise,
      this.passwordPrompt.close()
    );

    this.setTitle();
    this.pdfSidebar?.reset();
    this.pdfOutlineViewer?.reset();
    this.pdfAttachmentViewer?.reset();
    this.pdfLayerViewer?.reset();

    this.pdfHistory?.reset();
    this.findBar?.reset();
    this.toolbar?.reset();
    this.secondaryToolbar?.reset();
    this._PDFBug?.cleanup();

    await Promise.all(promises);
  },

  /**
   * Opens a new PDF document.
   * @param {Object} args - Accepts any/all of the properties from
   *   {@link DocumentInitParameters}, and also a `originalUrl` string.
   * @returns {Promise} - Promise that is resolved when the document is opened.
   */
  async open(args) {
    if (this.pdfLoadingTask) {
      // We need to destroy already opened document.
      await this.close();
    }
    // Set the necessary global worker parameters, using the available options.
    const workerParams = AppOptions.getAll(OptionKind.WORKER);
    Object.assign(GlobalWorkerOptions, workerParams);

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      if (args.data && isPdfFile(args.filename)) {
        this._contentDispositionFilename = args.filename;
      }
    } else if (args.url) {
      // The Firefox built-in viewer always calls `setTitleUsingUrl`, before
      // `initPassiveLoading`, and it never provides an `originalUrl` here.
      this.setTitleUsingUrl(
        args.originalUrl || args.url,
        /* downloadUrl = */ args.url
      );
    }

    // Set the necessary API parameters, using all the available options.
    const apiParams = AppOptions.getAll(OptionKind.API);
    const loadingTask = getDocument({
      ...apiParams,
      ...args,
    });
    this.pdfLoadingTask = loadingTask;

    loadingTask.onPassword = (updateCallback, reason) => {
      if (this.isViewerEmbedded) {
        // The load event can't be triggered until the password is entered, so
        // if the viewer is in an iframe and its visibility depends on the
        // onload callback then the viewer never shows (bug 1801341).
        this._unblockDocumentLoadEvent();
      }

      this.pdfLinkService.externalLinkEnabled = false;
      this.passwordPrompt.setUpdateCallback(updateCallback, reason);
      this.passwordPrompt.open();
    };

    loadingTask.onProgress = ({ loaded, total }) => {
      this.progress(loaded / total);
    };

    return loadingTask.promise.then(
      async pdfDocument => {
        await this.load(pdfDocument, args);
      },
      reason => {
        if (loadingTask !== this.pdfLoadingTask) {
          return undefined; // Ignore errors for previously opened PDF files.
        }

        let key = "pdfjs-loading-error";
        if (reason instanceof InvalidPDFException) {
          key = "pdfjs-invalid-file-error";
        } else if (reason instanceof MissingPDFException) {
          key = "pdfjs-missing-file-error";
        } else if (reason instanceof UnexpectedResponseException) {
          key = "pdfjs-unexpected-response-error";
        }
        return this._documentError(key, { message: reason.message }).then(
          () => {
            throw reason;
          }
        );
      }
    );
  },

  async download() {
    let data;
    try {
      data = await this.pdfDocument.getData();
    } catch {
      // When the PDF document isn't ready, simply download using the URL.
    }
    this.downloadManager.download(data, this._downloadUrl, this._docFilename);
  },

  async save() {
    if (this._saveInProgress) {
      return;
    }
    this._saveInProgress = true;
    await this.pdfScriptingManager.dispatchWillSave();

    try {
      const data = await this.pdfDocument.saveDocument();
      this.downloadManager.download(data, this._downloadUrl, this._docFilename);
    } catch (reason) {
      // When the PDF document isn't ready, fallback to a "regular" download.
      console.error(`Error when saving the document: ${reason.message}`);
      await this.download();
    } finally {
      await this.pdfScriptingManager.dispatchDidSave();
      this._saveInProgress = false;
    }

    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: "editing",
        data: {
          type: "save",
          stats: this.pdfDocument?.annotationStorage.editorStats,
        },
      });
    }
  },

  async downloadOrSave() {
    // In the Firefox case, this method MUST always trigger a download.
    // When the user is closing a modified and unsaved document, we display a
    // prompt asking for saving or not. In case they save, we must wait for
    // saving to complete before closing the tab.
    // So in case this function does not trigger a download, we must trigger a
    // a message and change PdfjsChild.sys.mjs to take it into account.
    const { classList } = this.appConfig.appContainer;
    classList.add("wait");
    await (this.pdfDocument?.annotationStorage.size > 0
      ? this.save()
      : this.download());
    classList.remove("wait");
  },

  createDocumentContainer() {
    this.pdfThumbnailViewer?.addNewEmptyDocumentContainer();
  },

  refreshOptions() {
    const sidebarLeftAction = document.getElementById("sidebar-left-actions");

    switch (this.viewState) {
      case ViewType.NORMAL:
        document.getElementById("classify-documents-button").style.display = "flex";
        document.getElementById("extract-data-from-documents").style.display = "none";
        document.getElementById("edit-pdf").style.display = "none";
        document.getElementById("add-container-button").style.display = "none";
        document.getElementById("select-checkboxes-container").style.display = "none";
        document.getElementById("open-sidebar-options").style.display = "none";
        document.getElementById("edit-mode-container").style.display = "none";
        sidebarLeftAction.style.justifyContent = "flex-end";
        break;
      case ViewType.GROUPED:
        document.getElementById("classify-documents-button").style.display = "none";
        document.getElementById("extract-data-from-documents").style.display = "flex";
        document.getElementById("edit-pdf").style.display = "flex";
        document.getElementById("select-checkboxes-container").style.display = "flex";
        document.getElementById("open-sidebar-options").style.display = "flex";
        sidebarLeftAction.style.justifyContent = 'space-between';

        var editModeHeight = 0;
        switch (this.editorState) {
          case EditorState.VIEW:
            document.getElementById("edit-pdf").style.display = "flex";
            document.getElementById("add-container-button").style.display = "none";
            document.getElementById("edit-mode-container").style.display = "none";
            break;
          case EditorState.EDIT:
            document.getElementById("edit-pdf").style.display = "none";
            document.getElementById("add-container-button").style.display = "flex";
            document.getElementById("edit-mode-container").style.display = "flex";
            editModeHeight = 100;
            break;
        }

        document.documentElement.style.setProperty('--editModeContainer-height', `${editModeHeight}px`);

        break;
    }

    this.pdfThumbnailViewer?.enableDragAndDrop(this.editorState == EditorState.EDIT);
    this.pdfThumbnailViewer?.updateThumbnailButtonsVisibility(this.editorState == EditorState.EDIT);
    this.pdfThumbnailViewer?.allowEdition(this.editorState == EditorState.EDIT);
  },

  async searchDocumentsInFile() {
    if (!this.pdfDocument) {
      return;
    }
    
    try {
      this.showLoading();

      // Start simulating progress up to 90% over the desired duration (e.g., 5 seconds)
      let control = { accelerate: false };
      const progressPromise = this.simulateProgress(20, 90, control);
      const fetchPromise = (async () => {

        // Create PDF
        const pdfBytes = await this.pdfDocument.getData();
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const pdfFile = new File([pdfBlob], 'file.pdf', { type: 'application/pdf' });
        
        // Create request
        const formData = new FormData();
        formData.append('file', pdfFile);

        const token = this.accessToken;
        const response = await fetch(
          `${API_URL}/v1/vertex-ai/pdf-analyzer/classify`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          }
        );
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        this.viewState = ViewType.GROUPED;

        const data = await response.json();
        const flatPages = data.result.flatMap(doc => doc.pages);
        const newPdfBlob = await this.extractPagesFromPdf(flatPages);

        const url = URL.createObjectURL(newPdfBlob);
        // const a = document.createElement('a');
        // a.href = url;
        // a.download = `temp-pdf.pdf`;
        // document.body.appendChild(a);
        // a.click();
        // document.body.removeChild(a);
        // URL.revokeObjectURL(url);
        
        PDFViewerApplication.open({ url: url, needsThumbnailsRefresh: false, documentsResponse: data, flatPages });

        this.refreshOptions();

        // Signal to accelerate the progress bar to 100%
        control.accelerate = true;
      })();

      // Wait for both the progress simulation and the fetch to complete
      await Promise.all([progressPromise, fetchPromise]);

      this.hideLoading();
    } catch (error) {
      console.error('Error fetching data:', error);
      this.hideLoading();
    }
  },

  async extractPagesFromPdf(pagesToExtract) {
    const pdfBytes = await this.pdfDocument.getData();
    const originalPdf = await PDFDocument.load(pdfBytes);
    const totalPages = originalPdf.getPageCount();
    const invalidPages = pagesToExtract.filter(page => page < 1 || page > totalPages);
    if (invalidPages.length > 0) {
      throw new Error(`Invalid page numbers: ${invalidPages.join(', ')}. The PDF has ${totalPages} pages.`);
    }
  
    const newPdf = await PDFDocument.create();
    const pagesZeroBased = pagesToExtract.map(pageNumber => pageNumber - 1);
    const copiedPages = await newPdf.copyPages(originalPdf, pagesZeroBased);
    copiedPages.forEach(page => newPdf.addPage(page));
  
    const newPdfBytes = await newPdf.save();
    const pdfBlob = new Blob([newPdfBytes], { type: 'application/pdf' });
    return pdfBlob;
  },

  async extractDataForAllDocuments() {
    await this.extractDataFromDocuments();
  },

  async extractDataForSelectedDocuments() {
    const docIds = this.pdfThumbnailViewer?.getSelectedDocumentContainerIds() || [];
    
    if (docIds.length === 0) {
      this.showGenericMessage("No document was selected");
      return;
    }
    
    if (docIds.length > 0) {
      await this.extractDataFromDocuments(docIds);
    }
  },

  async extractDataFromDocuments(docIds) {
    const isLoading = this.pdfThumbnailViewer?.anyDocumentProcessing();
    if (isLoading) {
      this.showGenericMessage("Please wait until the process has finished.");
      return;
    }

    const allDocs = this.getCurrentDocumentsAndPages() || [];
    let docsToProcess = allDocs;
    if (docIds) {
      docsToProcess = allDocs.filter(docData => docIds.includes(docData.docId));
    }
    
    // Create a progress tracker object: each document starts at 0 progress.
    const progressMap = {};
    docsToProcess.forEach(doc => {
      progressMap[doc.docId] = 0;
    });
    const totalDocs = docsToProcess.length;
  
    // Helper to update overall progress.
    const updateOverallProgress = () => {
      const sum = Object.values(progressMap).reduce((acc, curr) => acc + curr, 0);
      const overall = sum / totalDocs; // overall progress between 0 and 1
      this.progress(overall);
    };
  
    try {
      const queue = new ConcurrencyQueue(3);
      
      for (const docData of docsToProcess) {
        const docId = docData.docId;
        this.pdfThumbnailViewer?.setDocumentState(docId, 'processing');
        this.pdfThumbnailViewer?.setDocumentProgress(docId, 0);
        
        // Define a task that accepts a progress callback.
        const task = async (progressCallback) => {
          return this.processDocument(docId, docData, progressCallback);
        };
  
        // Wrap the task to handle errors and update progress.
        const wrappedTask = () =>
          task((progressValue) => {
            // Update this document's progress.
            progressMap[docId] = progressValue;
            // Recalculate and update overall progress.
            updateOverallProgress();
          }).then(result => result)
            .catch(error => {
              console.error(`Error processing doc ${docId}:`, error);
              return null;
            });
  
        queue.addTask(wrappedTask);
      }
  
      // Run all tasks in the queue.
      const results = await queue.run();
      console.log('All selected documents have been analyzed:', results);
      return results;
    } catch (error) {
      console.error('Error processing selected documents:', error);
      throw error;
    }
  },

  async processDocument(docId, docData, progressCallback = () => {}) {
    // Start processing: report 0% progress.
    progressCallback(0);

    // Mark the document as "processing" and reset progress
    this.pdfThumbnailViewer?.setDocumentState(docId, 'processing');
    this.pdfThumbnailViewer?.setDocumentProgress(docId, 0);
  
    // Start simulating progress from 0% -> 90% over 5 seconds
    const control = { accelerate: false, currentProgress: 0 };
    const progressSimPromise = this.pdfThumbnailViewer?.simulateDocumentProgress(
      docId,
      0,
      90,
      5, // durationInSeconds, adjust as needed
      control
    );
  
    try {
      // Extract pages, create partial PDF
      const newPdfBlob = await this.extractPagesFromPdf(docData.pages);
      const newPdfFile = new File([newPdfBlob], 'file.pdf', { type: 'application/pdf' });
      // Optionally show partial progress at 50%
      this.pdfThumbnailViewer?.setDocumentProgress(docId, 50);
      await this.animateProgress(progressCallback, control.currentProgress || 0, 0.5, 2000);
  
      // Prepare form data
      const formData = new FormData();
      formData.append('file', newPdfFile);
  
      const docTypeElement = document.querySelector(`#doc-type-${docId}`);
      const docTypeValue = docTypeElement ? docTypeElement.value : '';
      formData.append('doc_type', docTypeValue);
  
      // Call your endpoint
      const token = this.accessToken;
      const response = await fetch(`${API_URL}/v1/vertex-ai/pdf-analyzer/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
  
      // Parse the result from server
      const jsonResponse = await response.json();
      const htmlContent = jsonResponse["html"];
      const result = jsonResponse["result"];
  
      // Update progress to ~90% if needed
      this.pdfThumbnailViewer?.setDocumentProgress(docId, 90);
      this.pdfThumbnailViewer?.setDocumentResult(docId, result, htmlContent);
  
      // Now accelerate to 100%
      control.accelerate = true;
      await progressSimPromise; // Wait for that final jump
  
      // Mark doc as done
      this.pdfThumbnailViewer?.setDocumentState(docId, 'done');
      this.pdfThumbnailViewer?.displayFormForCurrentDocument(docId);
      
      // Animate the final jump from the simulation’s current progress (assumed ~0.9) to 1.
      await this.animateProgress(progressCallback, control.currentProgress || 0.9, 1, 500);

      return result;
  
    } catch (error) {
      console.error(`Error processing doc ${docId}:`, error);
      this.pdfThumbnailViewer?.setDocumentState(docId, 'error');
  
      // Accelerate to 100% (optional: you could also stop at e.g. 50%)
      control.accelerate = true;
      await progressSimPromise;

      // Animate progress from 0.5 to 1 over 500ms
      await this.animateProgress(progressCallback, control.currentProgress || 0.9, 1, 500);

      throw error;
    }
  },

  async deleteSelectedDocuments() {
    const docIds = this.pdfThumbnailViewer?.getSelectedDocumentContainerIds() || [];
    
    if (docIds.length === 0) {
      this.showGenericMessage("No document was selected");
      return;
    }

    for (const docId of docIds) {
      this.pdfThumbnailViewer?.removeDocumentContainer(docId, false);
    }
    await this.applyChanges();

    this.pdfThumbnailViewer?.resetSelectAll();
  },

  async createZipBlob(files) {
    const filesData = {};
    for (const { filename, blob } of files) {
      const buffer = await blob.arrayBuffer();
      filesData[filename] = new Uint8Array(buffer);
    }
    const zipped = zipSync(filesData);
    return new Blob([zipped], { type: "application/zip" });
  },

  async downloadSelectedDocuments() {
    const docIds = this.pdfThumbnailViewer?.getSelectedDocumentContainerIds() || [];
    
    if (docIds.length === 0) {
      this.showGenericMessage("No document was selected");
      return;
    }

    const pdfFiles = await Promise.all(
      docIds.map(async (docId) => {
        // Get your document data and pages, then extract the PDF Blob.
        const documentData = this.pdfThumbnailViewer?.documentsData.find((d) => d.id === docId);
        const pageNumbers = documentData.pages.map((page) => page.pageNumber);
        const blob = await PDFViewerApplication.extractPagesFromPdf(pageNumbers);
        
        // Retrieve and format the document name.
        const docName = this.pdfThumbnailViewer?.getDocumentName(docId) || docId;
        const formattedName = this.pdfThumbnailViewer?.formatToFilename(docName) || docName;
        
        return { filename: `${formattedName}.pdf`, blob };
      })
    );
  
    if (pdfFiles.length === 0) {
      console.warn("No PDFs were generated.");
      return;
    }
  
    // If there's only one PDF, download it directly.
    if (pdfFiles.length === 1) {
      const { filename, blob } = pdfFiles[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      // Otherwise, create a zip file containing all PDFs.
      const zipBlob = await this.createZipBlob(pdfFiles);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  },

  addToInvoiceTracking() {
    const selectedDocIds = this.pdfThumbnailViewer?.getSelectedDocumentContainerIds() || [];
    
    if (selectedDocIds.length === 0) {
      this.showGenericMessage("No document was selected");
      return;
    }
    
    // Validate that at least one selected document is of type 'Invoice'
    const selectedInvoiceDocIds = selectedDocIds.filter(docId => {
      // Assume each document container has a combo box with id="doc-type-{docId}"
      const docTypeElement = document.getElementById(`doc-type-${docId}`);
      return docTypeElement && docTypeElement.value === 'Invoice';
    });
    
    if (selectedInvoiceDocIds.length === 0) {
      this.showGenericMessage("You have not selected any Invoice documents");
      return;
    }
    
    // Retrieve the document states from the thumbnail viewer.
    const documentStates = this.pdfThumbnailViewer?.documentStates;
    if (!documentStates) {
      console.error("documentStates is not available.");
      return;
    }
    
    // Check if any selected document has missing or null JSON content.
    // Using == null catches both null and undefined.
    const hasMissingOrNullJson = selectedDocIds.some(docId => {
      const jsonContent = documentStates[docId]?.json;
      return jsonContent == null;
    });
    
    if (hasMissingOrNullJson) {
      this.showGenericMessage("Some documents do not have the extracted data available");
      return;
    }
    
    // Create a JSON array only for the Invoice documents.
    const jsonsArray = selectedInvoiceDocIds.map(docId => documentStates[docId].json);

    // Generate a UUID; if the browser supports crypto.randomUUID use that, otherwise provide a fallback.
    let requestId;
    if (crypto && crypto.randomUUID) {
      requestId = crypto.randomUUID();
    } else {
      // Fallback: simple UUID generator
      requestId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    // Build the final object with the required format.
    const resultObject = {
      request_id: requestId,
      datetime: new Date().toISOString(),
      number_of_invoices: jsonsArray.length,
      data: jsonsArray
    };

    const jsonString = JSON.stringify(resultObject, null, 2);
    
    // Create a Blob from the JSON string and trigger a download.
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = "result.json";
    document.body.appendChild(a); // Append to the DOM (required by some browsers)
    a.click();
    document.body.removeChild(a);
    
    // Optionally revoke the object URL.
    URL.revokeObjectURL(url);
  },

  getCurrentDocumentsAndPages() {
    const result = [];
    const container = this.pdfThumbnailViewer?.container;
    const thumbnails = this.pdfThumbnailViewer?._thumbnails;
    const docContainers = container.querySelectorAll('.document-container');
  
    for (const docContainer of docContainers) {
      const docId = docContainer.id;
  
      // Find the thumbnails container within this docContainer
      const thumbnailsContainer = docContainer.querySelector('.thumbnails-container');
      if (!thumbnailsContainer) {
        // No thumbnails for this document container
        result.push({ docId, pages: [] });
        continue;
      }
  
      const thumbnailDivs = thumbnailsContainer.querySelectorAll('.thumbnail');
      const pages = [];
  
      for (const thumbDiv of thumbnailDivs) {
        const thumbnail = thumbnails.find(thumb => thumb.id === thumbDiv.id);
        if (thumbnail) {
          pages.push(thumbnail.pageNumber);
        }
      }
  
      result.push({ docId, pages });
    }
  
    return result;
  },

  updateProgress(percentage) {
    if (percentage < 0) percentage = 0;
    if (percentage > 100) percentage = 100;
  
    this.currentProgressPercentage = percentage;
  
    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = percentage + '%';
  },
  
  simulateProgress(durationInSeconds, maxPercentage, control) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const duration = durationInSeconds * 1000;
      const targetPercentage = maxPercentage;
      let rafId;
  
      const update = () => {
        if (control && control.accelerate) {
          // Accelerate to 100% over 0.5 seconds
          this.animateProgressTo(100, 0.5).then(resolve);
          return;
        }
        const elapsed = Date.now() - startTime;
        const percentage = Math.min(
          (elapsed / duration) * targetPercentage,
          targetPercentage
        );
        this.updateProgress(percentage);
        rafId = requestAnimationFrame(update);
      };
  
      rafId = requestAnimationFrame(update);
    });
  },
  
  animateProgressTo(targetPercentage, durationInSeconds) {
    return new Promise((resolve) => {
      const startPercentage = this.currentProgressPercentage || 0;
      const startTime = Date.now();
      const duration = durationInSeconds * 1000;
      let rafId;
  
      const update = () => {
        const elapsed = Date.now() - startTime;
        let percentage =
          startPercentage +
          ((targetPercentage - startPercentage) * elapsed) / duration;
        if (percentage >= targetPercentage) {
          percentage = targetPercentage;
          this.updateProgress(percentage);
          resolve(); // Animation complete
          return;
        }
        this.updateProgress(percentage);
        rafId = requestAnimationFrame(update);
      };
  
      rafId = requestAnimationFrame(update);
    });
  },

  animateProgress(callback, start, end, durationInMs) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      function step(now) {
        const elapsed = now - startTime;
        const fraction = Math.min(elapsed / durationInMs, 1);
        const value = start + (end - start) * fraction;
        callback(value);
        if (fraction < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  },

  editPDF() {
    this.editorState = EditorState.EDIT;
    this.refreshOptions();
  },

  async undoChanges() {
    const originalPdfBytes = await this.pdfDocument.getData();
    const blob = new Blob([originalPdfBytes], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(blob);

    this.editorState = EditorState.VIEW;
    this.refreshOptions();

    PDFViewerApplication.open({ url: pdfUrl, documentsData: this.pdfThumbnailViewer.previousDocumentsData });
  },

  async applyChanges() {
    // Flatten the pages in the final desired order.
    const documentsData = this.pdfThumbnailViewer.documentsData;
    const newOrderedPages = documentsData
      .flatMap(doc => doc.pages)
      .map(p => p.pageNumber);

    // console.log("documentsData:", JSON.stringify(documentsData, null, 2));

    // Generate the new PDF with those pages.
    const newPDFUrl = await this.generateNewPDF(newOrderedPages);

    this.editorState = EditorState.VIEW;
    this.refreshOptions();

    PDFViewerApplication.open({ url: newPDFUrl, needsThumbnailsRefresh: false, documentsData, flatPages: newOrderedPages });
  },

  async regeneratePdfAfterChanges() {
    const documentsData = this.pdfThumbnailViewer.documentsData;
    console.log("Regenerating PDF based on the final order in documentsData.");
  
    // Flatten out all the pages in documentsData, in the current container order.
    // e.g. if container #1 has [4,1,2,3], container #2 has [5,6], finalOrderedPages = [4,1,2,3,5,6].
    const finalOrderedPages = documentsData
      .flatMap(doc => doc.pages)   // -> array of { pageNumber, id, ... }
      .map(p => p.pageNumber);     // -> array of numeric page numbers
  
    console.log("finalOrderedPages after user’s drag/drop operations:", finalOrderedPages);
  
    // Now generate the PDF in that exact page order using pdf-lib.
    // This is basically your existing "generateNewPDF" or "extractPagesFromPdf" logic,
    // but we'll inline it here for clarity.
  
    // 1) Get the original PDF data
    const originalPdfBytes = await this.pdfDocument.getData();
    const originalPdf = await PDFDocument.load(originalPdfBytes);
    const totalPages = originalPdf.getPageCount();
  
    // 2) Validate
    const invalidPages = finalOrderedPages.filter(n => n < 1 || n > totalPages);
    if (invalidPages.length > 0) {
      throw new Error(
        `Invalid pages: ${invalidPages.join(", ")}. ` +
        `Original PDF has ${totalPages} pages.`
      );
    }
  
    // 3) Create new PDF
    const newPdf = await PDFDocument.create();
  
    // Convert each pageNumber to 0-based index for copyPages
    const zeroBased = finalOrderedPages.map(n => n - 1);
    console.log("Copying pages in zero-based order:", zeroBased);
  
    const copiedPages = await newPdf.copyPages(originalPdf, zeroBased);
  
    // 4) Add them in the new PDF
    copiedPages.forEach((page, i) => {
      console.log(`Adding old pageIndex=${zeroBased[i]} as new PDF page #${i + 1}`);
      newPdf.addPage(page);
    });
  
    // 5) Finalize the PDF
    const newPdfBytes = await newPdf.save();
    const blob = new Blob([newPdfBytes], { type: "application/pdf" });
  
    console.log("Done regenerating PDF. Blob size:", newPdfBytes.length);

    const url = URL.createObjectURL(blob);
    return url;
  },

  flattenPageRotation(page, rotation) {
    // Ensure the rotation is in [0, 90, 180, 270] form.
    rotation = rotation % 360;
  
    // The current page size
    const { width, height } = page.getSize();
  
    switch (rotation) {
      case 0:
        // No change needed
        page.setRotation(degrees(0));
        return;
  
      case 90:
        // Physically rotate 90° means the new page is "tall" instead of "wide"
        page.setSize({ width: height, height: width });
        // Move content up by the new width so it doesn't get clipped at bottom
        page.translateContent(0, width);
        // Rotate all content 90 degrees
        page.rotateContent(degrees(90));
        break;
  
      case 180:
        // Page dimensions remain the same for 180°
        // Move content "right and up" by (width, height)
        page.translateContent(width, height);
        page.rotateContent(degrees(180));
        break;
  
      case 270:
        // For 270°, swap width & height
        page.setSize({ width: height, height: width });
        // Translate content to the right by the new width (which was old height)
        page.translateContent(height, 0);
        page.rotateContent(degrees(270));
        break;
    }
  
    // Ensure the page dictionary's /Rotate is zero
    page.setRotation(degrees(0));
  },

  async generateNewPDF(pagesToExtract) {
    // 1) Load the original PDF
    const originalPdfBytes = await this.pdfDocument.getData();
    const originalPdf = await PDFDocument.load(originalPdfBytes);
    const newPdf = await PDFDocument.create();
  
    // 2) Copy pages in the specified order
    const zeroBased = pagesToExtract.map(num => num - 1);
    const copiedPages = await newPdf.copyPages(originalPdf, zeroBased);
  
    // 3) Create a lookup from pageNumber => rotation
    const pageRotationMap = {};
    for (const doc of this.pdfThumbnailViewer.documentsData) {
      for (const page of doc.pages) {
        pageRotationMap[page.pageNumber] = page.rotation || 0; 
      }
    }
  
    copiedPages.forEach((pdfPage, i) => {
      const pageNum = zeroBased[i] + 1;
      const rotateVal = pageRotationMap[pageNum] || 0;
      const angle = degrees(rotateVal);
      pdfPage.setRotation(angle);
  
      newPdf.addPage(pdfPage);
    });
  
    // 5) Save and return URL
    const newPdfBytes = await newPdf.save();
    const blob = new Blob([newPdfBytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  },

  /**
   * Report the error; used for errors affecting loading and/or parsing of
   * the entire PDF document.
   */
  async _documentError(key, moreInfo = null) {
    this._unblockDocumentLoadEvent();

    const message = await this._otherError(
      key || "pdfjs-loading-error",
      moreInfo
    );

    this.eventBus.dispatch("documenterror", {
      source: this,
      message,
      reason: moreInfo?.message ?? null,
    });
  },

  /**
   * Report the error; used for errors affecting e.g. only a single page.
   * @param {string} key - The localization key for the error.
   * @param {Object} [moreInfo] - Further information about the error that is
   *                              more technical. Should have a 'message' and
   *                              optionally a 'stack' property.
   * @returns {string} A (localized) error message that is human readable.
   */
  async _otherError(key, moreInfo = null) {
    const message = await this.l10n.get(key);

    const moreInfoText = [`PDF.js v${version || "?"} (build: ${build || "?"})`];
    if (moreInfo) {
      moreInfoText.push(`Message: ${moreInfo.message}`);

      if (moreInfo.stack) {
        moreInfoText.push(`Stack: ${moreInfo.stack}`);
      } else {
        if (moreInfo.filename) {
          moreInfoText.push(`File: ${moreInfo.filename}`);
        }
        if (moreInfo.lineNumber) {
          moreInfoText.push(`Line: ${moreInfo.lineNumber}`);
        }
      }
    }

    console.error(`${message}\n\n${moreInfoText.join("\n")}`);
    return message;
  },

  progress(level) {
    const percent = Math.round(level * 100);
    if (!this.loadingBar) {
      return;
    }
  
    // If a new process starts (level is 0) but the bar is still at 100,
    // reset the progress so we can update from 0 onward.
    if (percent === 0 && this.loadingBar.percent === 100) {
      this.loadingBar.percent = 0;
    } else if (percent < this.loadingBar.percent) {
      return;
    }
  
    if (percent >= 100) {
      // Schedule hiding the bar after a delay.
      this.hideTimeout = setTimeout(() => {
        this.loadingBar.hide();
      }, 300);
    } else {
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }
      this.loadingBar.show();
    }
  
    this.loadingBar.percent = percent;
  
    if (
      this.pdfDocument?.loadingParams.disableAutoFetch ??
      AppOptions.get("disableAutoFetch")
    ) {
      this.loadingBar.setDisableAutoFetch();
    }
  },

  async load(pdfDocument, args) {
    this.pdfDocument = pdfDocument;

    pdfDocument.getDownloadInfo().then(({ length }) => {
      this._contentLength = length; // Ensure that the correct length is used.
      this.loadingBar?.hide();

      firstPagePromise.then(() => {
        this.eventBus.dispatch("documentloaded", { source: this });
      });
    });

    // Since the `setInitialView` call below depends on this being resolved,
    // fetch it early to avoid delaying initial rendering of the PDF document.
    const pageLayoutPromise = pdfDocument.getPageLayout().catch(() => {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const pageModePromise = pdfDocument.getPageMode().catch(() => {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const openActionPromise = pdfDocument.getOpenAction().catch(() => {
      /* Avoid breaking initial rendering; ignoring errors. */
    });

    this.toolbar?.setPagesCount(pdfDocument.numPages, false);
    this.secondaryToolbar?.setPagesCount(pdfDocument.numPages);

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("CHROME")) {
      const baseUrl = location.href.split("#", 1)[0];
      // Ignore "data:"-URLs for performance reasons, even though it may cause
      // internal links to not work perfectly in all cases (see bug 1803050).
      this.pdfLinkService.setDocument(
        pdfDocument,
        isDataScheme(baseUrl) ? null : baseUrl
      );
    } else {
      this.pdfLinkService.setDocument(pdfDocument);
    }
    this.pdfDocumentProperties?.setDocument(pdfDocument);

    const pdfViewer = this.pdfViewer;
    pdfViewer.setDocument(pdfDocument);
    const { firstPagePromise, onePageRendered, pagesPromise } = pdfViewer;

    await this.pdfThumbnailViewer?.setDocument(pdfDocument, args);

    const storedPromise = (this.store = new ViewHistory(
      pdfDocument.fingerprints[0]
    ))
      .getMultiple({
        page: null,
        zoom: DEFAULT_SCALE_VALUE,
        scrollLeft: "0",
        scrollTop: "0",
        rotation: null,
        sidebarView: SidebarView.UNKNOWN,
        scrollMode: ScrollMode.UNKNOWN,
        spreadMode: SpreadMode.UNKNOWN,
      })
      .catch(() => {
        /* Unable to read from storage; ignoring errors. */
      });

    firstPagePromise.then(pdfPage => {
      // this.loadingBar?.setWidth(this.appConfig.mainContainer);
      this._initializeAnnotationStorageCallbacks(pdfDocument);

      Promise.all([
        animationStarted,
        storedPromise,
        pageLayoutPromise,
        pageModePromise,
        openActionPromise,
      ])
        .then(async ([timeStamp, stored, pageLayout, pageMode, openAction]) => {
          const viewOnLoad = AppOptions.get("viewOnLoad");

          this._initializePdfHistory({
            fingerprint: pdfDocument.fingerprints[0],
            viewOnLoad,
            initialDest: openAction?.dest,
          });
          const initialBookmark = this.initialBookmark;

          // Initialize the default values, from user preferences.
          const zoom = AppOptions.get("defaultZoomValue");
          let hash = zoom ? `zoom=${zoom}` : null;

          let rotation = null;
          let sidebarView = SidebarView.THUMBS; // AppOptions.get("sidebarViewOnLoad");
          let scrollMode = AppOptions.get("scrollModeOnLoad");
          let spreadMode = AppOptions.get("spreadModeOnLoad");

          if (stored?.page && viewOnLoad !== ViewOnLoad.INITIAL) {
            hash =
              `page=${stored.page}&zoom=${zoom || stored.zoom},` +
              `${stored.scrollLeft},${stored.scrollTop}`;

            rotation = parseInt(stored.rotation, 10);
            // Always let user preference take precedence over the view history.
            if (sidebarView === SidebarView.UNKNOWN) {
              sidebarView = stored.sidebarView | 0;
            }
            if (scrollMode === ScrollMode.UNKNOWN) {
              scrollMode = stored.scrollMode | 0;
            }
            if (spreadMode === SpreadMode.UNKNOWN) {
              spreadMode = stored.spreadMode | 0;
            }
          }
          // Always let the user preference/view history take precedence.
          if (pageMode && sidebarView === SidebarView.UNKNOWN) {
            sidebarView = apiPageModeToSidebarView(pageMode);
          }
          if (
            pageLayout &&
            scrollMode === ScrollMode.UNKNOWN &&
            spreadMode === SpreadMode.UNKNOWN
          ) {
            const modes = apiPageLayoutToViewerModes(pageLayout);
            // TODO: Try to improve page-switching when using the mouse-wheel
            // and/or arrow-keys before allowing the document to control this.
            // scrollMode = modes.scrollMode;
            spreadMode = modes.spreadMode;
          }

          this.setInitialView(hash, {
            rotation,
            sidebarView,
            scrollMode,
            spreadMode,
          });
          this.eventBus.dispatch("documentinit", { source: this });
          // Make all navigation keys work on document load,
          // unless the viewer is embedded in a web page.
          if (!this.isViewerEmbedded) {
            pdfViewer.focus();
          }

          // For documents with different page sizes, once all pages are
          // resolved, ensure that the correct location becomes visible on load.
          // (To reduce the risk, in very large and/or slow loading documents,
          //  that the location changes *after* the user has started interacting
          //  with the viewer, wait for either `pagesPromise` or a timeout.)
          await Promise.race([
            pagesPromise,
            new Promise(resolve => {
              setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT);
            }),
          ]);
          if (!initialBookmark && !hash) {
            return;
          }
          if (pdfViewer.hasEqualPageSizes) {
            return;
          }
          this.initialBookmark = initialBookmark;

          // eslint-disable-next-line no-self-assign
          pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
          // Re-apply the initial document location.
          this.setInitialView(hash);
        })
        .catch(() => {
          // Ensure that the document is always completely initialized,
          // even if there are any errors thrown above.
          this.setInitialView();
        })
        .then(function () {
          // At this point, rendering of the initial page(s) should always have
          // started (and may even have completed).
          // To prevent any future issues, e.g. the document being completely
          // blank on load, always trigger rendering here.
          pdfViewer.update();
        });
    });

    pagesPromise.then(
      () => {
        this._unblockDocumentLoadEvent();

        this._initializeAutoPrint(pdfDocument, openActionPromise);
      },
      reason => {
        this._documentError("pdfjs-loading-error", { message: reason.message });
      }
    );

    onePageRendered.then(data => {
      this.externalServices.reportTelemetry({
        type: "pageInfo",
        timestamp: data.timestamp,
      });

      if (this.pdfOutlineViewer) {
        pdfDocument.getOutline().then(outline => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the outline resolved.
          }
          this.pdfOutlineViewer.render({ outline, pdfDocument });
        });
      }
      if (this.pdfAttachmentViewer) {
        pdfDocument.getAttachments().then(attachments => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the attachments resolved.
          }
          this.pdfAttachmentViewer.render({ attachments });
        });
      }
      if (this.pdfLayerViewer) {
        // Ensure that the layers accurately reflects the current state in the
        // viewer itself, rather than the default state provided by the API.
        pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the layers resolved.
          }
          this.pdfLayerViewer.render({ optionalContentConfig, pdfDocument });
        });
      }
    });

    this._initializePageLabels(pdfDocument);
    this._initializeMetadata(pdfDocument);
  },

  /**
   * @private
   */
  async _scriptingDocProperties(pdfDocument) {
    if (!this.documentInfo) {
      // It should be *extremely* rare for metadata to not have been resolved
      // when this code runs, but ensure that we handle that case here.
      await new Promise(resolve => {
        this.eventBus._on("metadataloaded", resolve, { once: true });
      });
      if (pdfDocument !== this.pdfDocument) {
        return null; // The document was closed while the metadata resolved.
      }
    }
    if (!this._contentLength) {
      // Always waiting for the entire PDF document to be loaded will, most
      // likely, delay sandbox-creation too much in the general case for all
      // PDF documents which are not provided as binary data to the API.
      // Hence we'll simply have to trust that the `contentLength` (as provided
      // by the server), when it exists, is accurate enough here.
      await new Promise(resolve => {
        this.eventBus._on("documentloaded", resolve, { once: true });
      });
      if (pdfDocument !== this.pdfDocument) {
        return null; // The document was closed while the downloadInfo resolved.
      }
    }

    return {
      ...this.documentInfo,
      baseURL: this.baseUrl,
      filesize: this._contentLength,
      filename: this._docFilename,
      metadata: this.metadata?.getRaw(),
      authors: this.metadata?.get("dc:creator"),
      numPages: this.pagesCount,
      URL: this.url,
    };
  },

  /**
   * @private
   */
  async _initializeAutoPrint(pdfDocument, openActionPromise) {
    const [openAction, jsActions] = await Promise.all([
      openActionPromise,
      this.pdfViewer.enableScripting ? null : pdfDocument.getJSActions(),
    ]);

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the auto print data resolved.
    }
    let triggerAutoPrint = openAction?.action === "Print";

    if (jsActions) {
      console.warn("Warning: JavaScript support is not enabled");

      // Hack to support auto printing.
      for (const name in jsActions) {
        if (triggerAutoPrint) {
          break;
        }
        switch (name) {
          case "WillClose":
          case "WillSave":
          case "DidSave":
          case "WillPrint":
          case "DidPrint":
            continue;
        }
        triggerAutoPrint = jsActions[name].some(js => AutoPrintRegExp.test(js));
      }
    }

    if (triggerAutoPrint) {
      this.triggerPrinting();
    }
  },

  /**
   * @private
   */
  async _initializeMetadata(pdfDocument) {
    const { info, metadata, contentDispositionFilename, contentLength } =
      await pdfDocument.getMetadata();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the metadata resolved.
    }
    this.documentInfo = info;
    this.metadata = metadata;
    this._contentDispositionFilename ??= contentDispositionFilename;
    this._contentLength ??= contentLength; // See `getDownloadInfo`-call above.

    // Provides some basic debug information
    console.log(
      `PDF ${pdfDocument.fingerprints[0]} [${info.PDFFormatVersion} ` +
        `${(info.Producer || "-").trim()} / ${(info.Creator || "-").trim()}] ` +
        `(PDF.js: ${version || "?"} [${build || "?"}])`
    );
    let pdfTitle = info.Title;

    const metadataTitle = metadata?.get("dc:title");
    if (metadataTitle) {
      // Ghostscript can produce invalid 'dc:title' Metadata entries:
      //  - The title may be "Untitled" (fixes bug 1031612).
      //  - The title may contain incorrectly encoded characters, which thus
      //    looks broken, hence we ignore the Metadata entry when it contains
      //    characters from the Specials Unicode block (fixes bug 1605526).
      if (
        metadataTitle !== "Untitled" &&
        !/[\uFFF0-\uFFFF]/g.test(metadataTitle)
      ) {
        pdfTitle = metadataTitle;
      }
    }
    if (pdfTitle) {
      this.setTitle(
        `${pdfTitle} - ${this._contentDispositionFilename || this._title}`
      );
    } else if (this._contentDispositionFilename) {
      this.setTitle(this._contentDispositionFilename);
    }

    if (
      info.IsXFAPresent &&
      !info.IsAcroFormPresent &&
      !pdfDocument.isPureXfa
    ) {
      if (pdfDocument.loadingParams.enableXfa) {
        console.warn("Warning: XFA Foreground documents are not supported");
      } else {
        console.warn("Warning: XFA support is not enabled");
      }
    } else if (
      (info.IsAcroFormPresent || info.IsXFAPresent) &&
      !this.pdfViewer.renderForms
    ) {
      console.warn("Warning: Interactive form support is not enabled");
    }

    if (info.IsSignaturesPresent) {
      console.warn("Warning: Digital signatures validation is not supported");
    }

    this.eventBus.dispatch("metadataloaded", { source: this });
  },

  /**
   * @private
   */
  async _initializePageLabels(pdfDocument) {
    if (
      typeof PDFJSDev === "undefined"
        ? window.isGECKOVIEW
        : PDFJSDev.test("GECKOVIEW")
    ) {
      return;
    }
    const labels = await pdfDocument.getPageLabels();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the page labels resolved.
    }
    if (!labels || AppOptions.get("disablePageLabels")) {
      return;
    }
    const numLabels = labels.length;
    // Ignore page labels that correspond to standard page numbering,
    // or page labels that are all empty.
    let standardLabels = 0,
      emptyLabels = 0;
    for (let i = 0; i < numLabels; i++) {
      const label = labels[i];
      if (label === (i + 1).toString()) {
        standardLabels++;
      } else if (label === "") {
        emptyLabels++;
      } else {
        break;
      }
    }
    if (standardLabels >= numLabels || emptyLabels >= numLabels) {
      return;
    }
    const { pdfViewer, pdfThumbnailViewer, toolbar } = this;

    pdfViewer.setPageLabels(labels);
    pdfThumbnailViewer?.setPageLabels(labels);

    // Changing toolbar page display to use labels and we need to set
    // the label of the current page.
    toolbar?.setPagesCount(numLabels, true);
    toolbar?.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel
    );
  },

  /**
   * @private
   */
  _initializePdfHistory({ fingerprint, viewOnLoad, initialDest = null }) {
    if (!this.pdfHistory) {
      return;
    }
    this.pdfHistory.initialize({
      fingerprint,
      resetHistory: viewOnLoad === ViewOnLoad.INITIAL,
      updateUrl: AppOptions.get("historyUpdateUrl"),
    });

    if (this.pdfHistory.initialBookmark) {
      this.initialBookmark = this.pdfHistory.initialBookmark;

      this.initialRotation = this.pdfHistory.initialRotation;
    }

    // Always let the browser history/document hash take precedence.
    if (
      initialDest &&
      !this.initialBookmark &&
      viewOnLoad === ViewOnLoad.UNKNOWN
    ) {
      this.initialBookmark = JSON.stringify(initialDest);
      // TODO: Re-factor the `PDFHistory` initialization to remove this hack
      // that's currently necessary to prevent weird initial history state.
      this.pdfHistory.push({ explicitDest: initialDest, pageNumber: null });
    }
  },

  /**
   * @private
   */
  _initializeAnnotationStorageCallbacks(pdfDocument) {
    if (pdfDocument !== this.pdfDocument) {
      return;
    }
    const { annotationStorage } = pdfDocument;

    annotationStorage.onSetModified = () => {
      window.addEventListener("beforeunload", beforeUnload);

      if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
        this._annotationStorageModified = true;
      }
    };
    annotationStorage.onResetModified = () => {
      window.removeEventListener("beforeunload", beforeUnload);

      if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
        delete this._annotationStorageModified;
      }
    };
    annotationStorage.onAnnotationEditor = typeStr => {
      this._hasAnnotationEditors = !!typeStr;
      this.setTitle();
    };
  },

  setInitialView(
    storedHash,
    { rotation, sidebarView, scrollMode, spreadMode } = {}
  ) {
    const setRotation = angle => {
      if (isValidRotation(angle)) {
        this.pdfViewer.pagesRotation = angle;
      }
    };
    const setViewerModes = (scroll, spread) => {
      if (isValidScrollMode(scroll)) {
        this.pdfViewer.scrollMode = scroll;
      }
      if (isValidSpreadMode(spread)) {
        this.pdfViewer.spreadMode = spread;
      }
    };
    this.isInitialViewSet = true;
    this.pdfSidebar?.setInitialView(sidebarView);

    setViewerModes(scrollMode, spreadMode);

    if (this.initialBookmark) {
      setRotation(this.initialRotation);
      delete this.initialRotation;

      this.pdfLinkService.setHash(this.initialBookmark);
      this.initialBookmark = null;
    } else if (storedHash) {
      setRotation(rotation);

      this.pdfLinkService.setHash(storedHash);
    }

    // Ensure that the correct page number is displayed in the UI,
    // even if the active page didn't change during document load.
    this.toolbar?.setPageNumber(
      this.pdfViewer.currentPageNumber,
      this.pdfViewer.currentPageLabel
    );
    this.secondaryToolbar?.setPageNumber(this.pdfViewer.currentPageNumber);

    if (!this.pdfViewer.currentScaleValue) {
      // Scale was not initialized: invalid bookmark or scale was not specified.
      // Setting the default one.
      this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;
    }
  },

  /**
   * @private
   */
  _cleanup() {
    if (!this.pdfDocument) {
      return; // run cleanup when document is loaded
    }
    this.pdfViewer.cleanup();
    this.pdfThumbnailViewer?.cleanup();

    this.pdfDocument.cleanup(
      /* keepLoadedFonts = */ AppOptions.get("fontExtraProperties")
    );
  },

  forceRendering() {
    this.pdfRenderingQueue.printing = !!this.printService;
    this.pdfRenderingQueue.isThumbnailViewEnabled =
      this.pdfSidebar?.visibleView === SidebarView.THUMBS;
    this.pdfRenderingQueue.renderHighestPriority();
  },

  beforePrint() {
    this._printAnnotationStoragePromise = this.pdfScriptingManager
      .dispatchWillPrint()
      .catch(() => {
        /* Avoid breaking printing; ignoring errors. */
      })
      .then(() => this.pdfDocument?.annotationStorage.print);

    if (this.printService) {
      // There is no way to suppress beforePrint/afterPrint events,
      // but PDFPrintService may generate double events -- this will ignore
      // the second event that will be coming from native window.print().
      return;
    }

    if (!this.supportsPrinting) {
      this._otherError("pdfjs-printing-not-supported");
      return;
    }

    // The beforePrint is a sync method and we need to know layout before
    // returning from this method. Ensure that we can get sizes of the pages.
    if (!this.pdfViewer.pageViewsReady) {
      this.l10n.get("pdfjs-printing-not-ready").then(msg => {
        // eslint-disable-next-line no-alert
        window.alert(msg);
      });
      return;
    }

    this.printService = PDFPrintServiceFactory.createPrintService({
      pdfDocument: this.pdfDocument,
      pagesOverview: this.pdfViewer.getPagesOverview(),
      printContainer: this.appConfig.printContainer,
      printResolution: AppOptions.get("printResolution"),
      printAnnotationStoragePromise: this._printAnnotationStoragePromise,
    });
    this.forceRendering();
    // Disable the editor-indicator during printing (fixes bug 1790552).
    this.setTitle();

    this.printService.layout();

    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: "editing",
        data: {
          type: "print",
          stats: this.pdfDocument?.annotationStorage.editorStats,
        },
      });
    }
  },

  afterPrint() {
    if (this._printAnnotationStoragePromise) {
      this._printAnnotationStoragePromise.then(() => {
        this.pdfScriptingManager.dispatchDidPrint();
      });
      this._printAnnotationStoragePromise = null;
    }

    if (this.printService) {
      this.printService.destroy();
      this.printService = null;

      this.pdfDocument?.annotationStorage.resetModified();
    }
    this.forceRendering();
    // Re-enable the editor-indicator after printing (fixes bug 1790552).
    this.setTitle();
  },

  rotatePages(delta) {
    this.pdfViewer.pagesRotation += delta;
    // Note that the thumbnail viewer is updated, and rendering is triggered,
    // in the 'rotationchanging' event handler.
  },

  requestPresentationMode() {
    this.pdfPresentationMode?.request();
  },

  triggerPrinting() {
    if (this.supportsPrinting) {
      window.print();
    }
  },

  bindEvents() {
    if (this._eventBusAbortController) {
      return;
    }
    const ac = (this._eventBusAbortController = new AbortController());
    const opts = { signal: ac.signal };

    const {
      eventBus,
      externalServices,
      pdfDocumentProperties,
      pdfViewer,
      preferences,
    } = this;

    eventBus._on("document-container-download", onDocumentContainerDownload.bind(this), opts);
    eventBus._on("document-container-retry", onDocumentContainerRetry.bind(this), opts);
    eventBus._on("document-container-extract", onDocumentContainerExtract.bind(this), opts);
    eventBus._on("thumbnail-reordered", onThumbnailReordered.bind(this), opts);
    eventBus._on("resize", onResize.bind(this), opts);
    eventBus._on("hashchange", onHashchange.bind(this), opts);
    eventBus._on("beforeprint", this.beforePrint.bind(this), opts);
    eventBus._on("afterprint", this.afterPrint.bind(this), opts);
    eventBus._on("pagerender", onPageRender.bind(this), opts);
    eventBus._on("pagerendered", onPageRendered.bind(this), opts);
    eventBus._on("updateviewarea", onUpdateViewarea.bind(this), opts);
    eventBus._on("pagechanging", onPageChanging.bind(this), opts);
    eventBus._on("scalechanging", onScaleChanging.bind(this), opts);
    eventBus._on("rotationchanging", onRotationChanging.bind(this), opts);
    eventBus._on("sidebarviewchanged", onSidebarViewChanged.bind(this), opts);
    eventBus._on("pagemode", onPageMode.bind(this), opts);
    eventBus._on("namedaction", onNamedAction.bind(this), opts);
    eventBus._on(
      "presentationmodechanged",
      evt => (pdfViewer.presentationModeState = evt.state),
      opts
    );
    eventBus._on(
      "presentationmode",
      this.requestPresentationMode.bind(this),
      opts
    );
    eventBus._on(
      "switchannotationeditormode",
      evt => (pdfViewer.annotationEditorMode = evt),
      opts
    );
    eventBus._on("print", this.triggerPrinting.bind(this), opts);
    eventBus._on("download", this.downloadOrSave.bind(this), opts);
    eventBus._on("firstpage", () => (this.page = 1), opts);
    eventBus._on("lastpage", () => (this.page = this.pagesCount), opts);
    eventBus._on("nextpage", () => pdfViewer.nextPage(), opts);
    eventBus._on("previouspage", () => pdfViewer.previousPage(), opts);
    eventBus._on("zoomin", this.zoomIn.bind(this), opts);
    eventBus._on("zoomout", this.zoomOut.bind(this), opts);
    eventBus._on("zoomreset", this.zoomReset.bind(this), opts);
    eventBus._on("pagenumberchanged", onPageNumberChanged.bind(this), opts);
    eventBus._on(
      "scalechanged",
      evt => (pdfViewer.currentScaleValue = evt.value),
      opts
    );
    eventBus._on("rotatecw", this.rotatePages.bind(this, 90), opts);
    eventBus._on("rotateccw", this.rotatePages.bind(this, -90), opts);
    eventBus._on(
      "optionalcontentconfig",
      evt => (pdfViewer.optionalContentConfigPromise = evt.promise),
      opts
    );
    eventBus._on(
      "switchscrollmode",
      evt => (pdfViewer.scrollMode = evt.mode),
      opts
    );
    eventBus._on(
      "scrollmodechanged",
      onViewerModesChanged.bind(this, "scrollMode"),
      opts
    );
    eventBus._on(
      "switchspreadmode",
      evt => (pdfViewer.spreadMode = evt.mode),
      opts
    );
    eventBus._on(
      "spreadmodechanged",
      onViewerModesChanged.bind(this, "spreadMode"),
      opts
    );
    eventBus._on(
      "imagealttextsettings",
      onImageAltTextSettings.bind(this),
      opts
    );
    eventBus._on(
      "documentproperties",
      () => pdfDocumentProperties?.open(),
      opts
    );
    eventBus._on("findfromurlhash", onFindFromUrlHash.bind(this), opts);
    eventBus._on(
      "updatefindmatchescount",
      onUpdateFindMatchesCount.bind(this),
      opts
    );
    eventBus._on(
      "updatefindcontrolstate",
      onUpdateFindControlState.bind(this),
      opts
    );

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      eventBus._on("fileinputchange", onFileInputChange.bind(this), opts);
      eventBus._on("openfile", onOpenFile.bind(this), opts);
    }
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      eventBus._on(
        "annotationeditorstateschanged",
        evt => externalServices.updateEditorStates(evt),
        opts
      );
      eventBus._on(
        "reporttelemetry",
        evt => externalServices.reportTelemetry(evt.details),
        opts
      );
    }
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("TESTING || MOZCENTRAL")
    ) {
      eventBus._on(
        "setpreference",
        evt => preferences.set(evt.name, evt.value),
        opts
      );
    }

    document.getElementById("classify-documents-button").addEventListener("click", this.searchDocumentsInFile.bind(this));
    document.getElementById("add-container-button").addEventListener("click", this.createDocumentContainer.bind(this));
    document.getElementById("extract-data-from-documents").addEventListener("click", this.extractDataForAllDocuments.bind(this));
    document.getElementById("edit-pdf").addEventListener("click", this.editPDF.bind(this));
    document.getElementById("edit-mode-cancel").addEventListener("click", this.undoChanges.bind(this));
    document.getElementById("edit-mode-save").addEventListener("click", this.applyChanges.bind(this));
    document.getElementById("extract-data-from-documents-option").addEventListener("click", this.extractDataForSelectedDocuments.bind(this));
    document.getElementById("delete-document-option").addEventListener("click", this.deleteSelectedDocuments.bind(this));
    document.getElementById("download-document-option").addEventListener("click", this.downloadSelectedDocuments.bind(this));
    document.getElementById("add-to-invoice-tracking-option").addEventListener("click", this.addToInvoiceTracking.bind(this));

    this.bindDropdownEvents();
  },

  bindDropdownEvents() {
    // Select all dropdown buttons and their corresponding dropdown menus
    const btns = document.querySelectorAll('.dropdown-action');
    const dropMenus = document.querySelectorAll('.drop-menu');

    // Function to remove 'active' class from all dropdowns
    const removeActive = () => {
        btns.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-expanded', 'false');
        });
        dropMenus.forEach(dropmenu => dropmenu.classList.remove('active'));
        // Also remove 'active' from any dropdown-item.has-submenu
        document.querySelectorAll('.dropdown-item.has-submenu').forEach(item => {
            item.classList.remove('active');
            const submenu = item.querySelector('.submenu');
            if (submenu) submenu.classList.remove('active');
            const trigger = item.querySelector('a');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
    };

    // Add click event listeners to each dropdown button
    btns.forEach(btn => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent click from bubbling up

            const targetMenu = document.querySelector(btn.dataset.target);

            // Toggle active class
            const isActive = btn.classList.contains('active');
            if (isActive) {
                // If already active, remove active classes
                btn.classList.remove('active');
                targetMenu.classList.remove('active');
                btn.setAttribute('aria-expanded', 'false');
            } else {
                // Remove active from others and activate this dropdown
                removeActive();
                btn.classList.add('active');
                targetMenu.classList.add('active');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Close dropdowns when clicking outside
    window.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-action') && !e.target.closest('.drop-menu')) {
            removeActive();
        }
    });

    // Optional: Close dropdowns when pressing the Escape key
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            removeActive();
        }
    });

    const submenuTriggers = document.querySelectorAll('.dropdown-item.has-submenu > a');

    submenuTriggers.forEach(trigger => {
        trigger.addEventListener('click', (event) => {
            event.preventDefault(); // Prevent default link behavior
            event.stopPropagation(); // Prevent click from bubbling up

            const parentItem = trigger.parentElement;
            const submenu = parentItem.querySelector('.submenu');

            const isActive = parentItem.classList.contains('active');
            if (isActive) {
                // If submenu is active, deactivate it
                parentItem.classList.remove('active');
                submenu.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
            } else {
                // Close any other active submenus
                document.querySelectorAll('.dropdown-item.has-submenu.active').forEach(item => {
                    item.classList.remove('active');
                    item.querySelector('.submenu').classList.remove('active');
                    item.querySelector('a').setAttribute('aria-expanded', 'false');
                });

                // Activate this submenu
                parentItem.classList.add('active');
                submenu.classList.add('active');
                trigger.setAttribute('aria-expanded', 'true');
            }
        });
    });

    document.querySelectorAll('.drop-menu a').forEach(option => {
      option.addEventListener('click', () => {
          removeActive();
      });
  });
  },

  bindWindowEvents() {
    if (this._windowAbortController) {
      return;
    }
    this._windowAbortController = new AbortController();

    const {
      eventBus,
      appConfig: { mainContainer },
      pdfViewer,
      _windowAbortController: { signal },
    } = this;

    function addWindowResolutionChange(evt = null) {
      if (evt) {
        pdfViewer.refresh();
      }
      const mediaQueryList = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`
      );
      mediaQueryList.addEventListener("change", addWindowResolutionChange, {
        once: true,
        signal,
      });
    }
    addWindowResolutionChange();

    window.addEventListener("wheel", onWheel.bind(this), {
      passive: false,
      signal,
    });
    window.addEventListener("touchstart", onTouchStart.bind(this), {
      passive: false,
      signal,
    });
    window.addEventListener("touchmove", onTouchMove.bind(this), {
      passive: false,
      signal,
    });
    window.addEventListener("touchend", onTouchEnd.bind(this), {
      passive: false,
      signal,
    });
    window.addEventListener("click", onClick.bind(this), { signal });
    window.addEventListener("keydown", onKeyDown.bind(this), { signal });
    window.addEventListener("keyup", onKeyUp.bind(this), { signal });
    window.addEventListener(
      "resize",
      () => eventBus.dispatch("resize", { source: window }),
      { signal }
    );
    window.addEventListener(
      "hashchange",
      () => {
        eventBus.dispatch("hashchange", {
          source: window,
          hash: document.location.hash.substring(1),
        });
      },
      { signal }
    );
    window.addEventListener(
      "beforeprint",
      () => eventBus.dispatch("beforeprint", { source: window }),
      { signal }
    );
    window.addEventListener(
      "afterprint",
      () => eventBus.dispatch("afterprint", { source: window }),
      { signal }
    );
    window.addEventListener(
      "updatefromsandbox",
      evt => {
        eventBus.dispatch("updatefromsandbox", {
          source: window,
          detail: evt.detail,
        });
      },
      { signal }
    );

    if (
      (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) &&
      !("onscrollend" in document.documentElement)
    ) {
      return;
    }
    if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
      // Using the values lastScrollTop and lastScrollLeft is a workaround to
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1881974.
      // TODO: remove them once the bug is fixed.
      ({ scrollTop: this._lastScrollTop, scrollLeft: this._lastScrollLeft } =
        mainContainer);
    }

    const scrollend = () => {
      if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
        ({ scrollTop: this._lastScrollTop, scrollLeft: this._lastScrollLeft } =
          mainContainer);
      }

      this._isScrolling = false;
      mainContainer.addEventListener("scroll", scroll, {
        passive: true,
        signal,
      });
      mainContainer.removeEventListener("scrollend", scrollend);
      mainContainer.removeEventListener("blur", scrollend);
    };
    const scroll = () => {
      if (this._isCtrlKeyDown) {
        return;
      }
      if (
        (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) &&
        this._lastScrollTop === mainContainer.scrollTop &&
        this._lastScrollLeft === mainContainer.scrollLeft
      ) {
        return;
      }

      mainContainer.removeEventListener("scroll", scroll);
      this._isScrolling = true;
      mainContainer.addEventListener("scrollend", scrollend, { signal });
      mainContainer.addEventListener("blur", scrollend, { signal });
    };
    mainContainer.addEventListener("scroll", scroll, {
      passive: true,
      signal,
    });
  },

  unbindEvents() {
    this._eventBusAbortController?.abort();
    this._eventBusAbortController = null;
  },

  unbindWindowEvents() {
    this._windowAbortController?.abort();
    this._windowAbortController = null;
  },

  /**
   * @ignore
   */
  async testingClose() {
    this.unbindEvents();
    this.unbindWindowEvents();

    this._globalAbortController?.abort();
    this._globalAbortController = null;

    this.findBar?.close();

    await Promise.all([this.l10n?.destroy(), this.close()]);
  },

  _accumulateTicks(ticks, prop) {
    // If the direction changed, reset the accumulated ticks.
    if ((this[prop] > 0 && ticks < 0) || (this[prop] < 0 && ticks > 0)) {
      this[prop] = 0;
    }
    this[prop] += ticks;
    const wholeTicks = Math.trunc(this[prop]);
    this[prop] -= wholeTicks;
    return wholeTicks;
  },

  _accumulateFactor(previousScale, factor, prop) {
    if (factor === 1) {
      return 1;
    }
    // If the direction changed, reset the accumulated factor.
    if ((this[prop] > 1 && factor < 1) || (this[prop] < 1 && factor > 1)) {
      this[prop] = 1;
    }

    const newFactor =
      Math.floor(previousScale * factor * this[prop] * 100) /
      (100 * previousScale);
    this[prop] = factor / newFactor;

    return newFactor;
  },

  /**
   * Should be called *after* all pages have loaded, or if an error occurred,
   * to unblock the "load" event; see https://bugzilla.mozilla.org/show_bug.cgi?id=1618553
   * @private
   */
  _unblockDocumentLoadEvent() {
    document.blockUnblockOnload?.(false);

    // Ensure that this method is only ever run once.
    this._unblockDocumentLoadEvent = () => {};
  },

  /**
   * Used together with the integration-tests, to enable awaiting full
   * initialization of the scripting/sandbox.
   */
  get scriptingReady() {
    return this.pdfScriptingManager.ready;
  },

  showLoading() {
    const modalOverlay = document.getElementById('modal-overlay');
    modalOverlay.style.display = 'flex';
  },

  hideLoading() {
    const modalOverlay = document.getElementById('modal-overlay');
    modalOverlay.style.display = 'none';
  },

  startProcessing() {
    this.showLoading();

    // Call endpoint to classify documents
  },

  showGenericMessage(message, buttonText = "Close") {
    const popup = document.getElementById("generic-popup");
    const messageElement = document.getElementById("popup-message");
    const closeButton = document.getElementById("popup-close");
  
    messageElement.textContent = message;
    closeButton.textContent = buttonText;
  
    popup.style.display = "flex";
  
    closeButton.onclick = function () {
      popup.style.display = "none";
    };
  }
};

initCom(PDFViewerApplication);

if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
  PDFPrintServiceFactory.initGlobals(PDFViewerApplication);
}

if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
  const HOSTED_VIEWER_ORIGINS = [
    "null",
    "http://mozilla.github.io",
    "https://mozilla.github.io",
  ];
  // eslint-disable-next-line no-var
  var validateFileURL = function (file) {
    if (!file) {
      return;
    }
    try {
      const viewerOrigin = new URL(window.location.href).origin || "null";
      if (HOSTED_VIEWER_ORIGINS.includes(viewerOrigin)) {
        // Hosted or local viewer, allow for any file locations
        return;
      }
      const fileOrigin = new URL(file, window.location.href).origin;
      // Removing of the following line will not guarantee that the viewer will
      // start accepting URLs from foreign origin -- CORS headers on the remote
      // server must be properly configured.
      if (fileOrigin !== viewerOrigin) {
        throw new Error("file origin does not match viewer's");
      }
    } catch (ex) {
      PDFViewerApplication._documentError("pdfjs-loading-error", {
        message: ex.message,
      });
      throw ex;
    }
  };

  // eslint-disable-next-line no-var
  var onFileInputChange = function (evt) {
    if (this.pdfViewer?.isInPresentationMode) {
      return; // Opening a new PDF file isn't supported in Presentation Mode.
    }
    const file = evt.fileInput.files[0];

    this.open({
      url: URL.createObjectURL(file),
      originalUrl: file.name,
    });
  };

  // eslint-disable-next-line no-var
  var onOpenFile = function (evt) {
    this._openFileInput?.click();
  };
}

function onPageRender({ pageNumber }) {
  // If the page is (the most) visible when it starts rendering,
  // ensure that the page number input loading indicator is displayed.
  if (pageNumber === this.page) {
    this.toolbar?.updateLoadingIndicatorState(true);
  }
}

function onPageRendered({ pageNumber, error }) {
  // If the page is still visible when it has finished rendering,
  // ensure that the page number input loading indicator is hidden.
  if (pageNumber === this.page) {
    this.toolbar?.updateLoadingIndicatorState(false);
  }

  // Use the rendered page to set the corresponding thumbnail image.
  if (this.pdfSidebar?.visibleView === SidebarView.THUMBS) {
    const pageView = this.pdfViewer.getPageView(/* index = */ pageNumber - 1);
    const thumbnailView = this.pdfThumbnailViewer?.getThumbnail(
      /* index = */ pageNumber - 1
    );
    if (pageView) {
      thumbnailView?.setImage(pageView);
    }
  }

  if (error) {
    this._otherError("pdfjs-rendering-error", error);
  }
}

function onPageMode({ mode }) {
  // Handle the 'pagemode' hash parameter, see also `PDFLinkService_setHash`.
  let view;
  switch (mode) {
    case "thumbs":
      view = SidebarView.THUMBS;
      break;
    case "bookmarks":
    case "outline": // non-standard
      view = SidebarView.OUTLINE;
      break;
    case "attachments": // non-standard
      view = SidebarView.ATTACHMENTS;
      break;
    case "layers": // non-standard
      view = SidebarView.LAYERS;
      break;
    case "none":
      view = SidebarView.NONE;
      break;
    default:
      console.error('Invalid "pagemode" hash parameter: ' + mode);
      return;
  }
  this.pdfSidebar?.switchView(view, /* forceOpen = */ true);
}

function onNamedAction(evt) {
  // Processing a couple of named actions that might be useful, see also
  // `PDFLinkService.executeNamedAction`.
  switch (evt.action) {
    case "GoToPage":
      this.appConfig.toolbar?.pageNumber.select();
      break;

    case "Find":
      if (!this.supportsIntegratedFind) {
        this.findBar?.toggle();
      }
      break;

    case "Print":
      this.triggerPrinting();
      break;

    case "SaveAs":
      this.downloadOrSave();
      break;
  }
}

function onSidebarViewChanged({ view }) {
  this.pdfRenderingQueue.isThumbnailViewEnabled = view === SidebarView.THUMBS;

  if (this.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    this.store?.set("sidebarView", view).catch(() => {
      // Unable to write to storage.
    });
  }
}

function onUpdateViewarea({ location }) {
  if (this.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    this.store
      ?.setMultiple({
        page: location.pageNumber,
        zoom: location.scale,
        scrollLeft: location.left,
        scrollTop: location.top,
        rotation: location.rotation,
      })
      .catch(() => {
        // Unable to write to storage.
      });
  }
  if (this.appConfig.secondaryToolbar) {
    this.appConfig.secondaryToolbar.viewBookmarkButton.href =
      this.pdfLinkService.getAnchorUrl(location.pdfOpenParams);
  }
}

function onViewerModesChanged(name, evt) {
  if (this.isInitialViewSet && !this.pdfViewer.isInPresentationMode) {
    // Only update the storage when the document has been loaded *and* rendered.
    this.store?.set(name, evt.mode).catch(() => {
      // Unable to write to storage.
    });
  }
}

async function onThumbnailReordered({ source, newPDFUrl, documentsData, flatPages }) {
  
}

async function onDocumentContainerExtract({ source, docId, pageNumbers }) {
  try {
    const state = this.pdfThumbnailViewer?.getDocumentState(docId);
    if (state == 'processing') {
      this.showGenericMessage("Please wait until the process has finished.");
      return;
    }

    const docsAndPages = this.getCurrentDocumentsAndPages();
    const docData = docsAndPages.find(d => d.docId === docId);
    if (!docData) {
      console.error(`No document found for docId: ${docId}`);
      return;
    }

    await this.processDocument(docId, docData, (progressValue) => {
      this.progress(progressValue);
    });

    console.log(`Retry for document ${docId} finished successfully.`);
  } catch (error) {
    console.error(`Retry for document ${docId} failed:`, error);
  }
}

async function onDocumentContainerRetry({ source, docId }) {
  try {
    const docsAndPages = this.getCurrentDocumentsAndPages();
    const docData = docsAndPages.find(d => d.docId === docId);
    if (!docData) {
      console.error(`No document found for docId: ${docId}`);
      return;
    }

    await this.processDocument(docId, docData, (progressValue) => {
      this.progress(progressValue);
    });

    console.log(`Retry for document ${docId} finished successfully.`);
  } catch (error) {
    console.error(`Retry for document ${docId} failed:`, error);
  }
}

async function onDocumentContainerDownload({ source, docId, pageNumbers }) {
  const blob = await PDFViewerApplication.extractPagesFromPdf(pageNumbers);

  const docName = this.pdfThumbnailViewer?.getDocumentName(docId);
  const formattedName = this.pdfThumbnailViewer?.formatToFilename(docName);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${formattedName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function onResize() {
  const { pdfDocument, pdfViewer, pdfRenderingQueue } = this;

  if (pdfRenderingQueue.printing && window.matchMedia("print").matches) {
    // Work-around issue 15324 by ignoring "resize" events during printing.
    return;
  }

  if (!pdfDocument) {
    return;
  }
  const currentScaleValue = pdfViewer.currentScaleValue;
  if (
    currentScaleValue === "auto" ||
    currentScaleValue === "page-fit" ||
    currentScaleValue === "page-width"
  ) {
    // Note: the scale is constant for 'page-actual'.
    pdfViewer.currentScaleValue = currentScaleValue;
  }
  pdfViewer.update();
}

function onHashchange(evt) {
  const hash = evt.hash;
  if (!hash) {
    return;
  }
  if (!this.isInitialViewSet) {
    this.initialBookmark = hash;
  } else if (!this.pdfHistory?.popStateInProgress) {
    this.pdfLinkService.setHash(hash);
  }
}

function onPageNumberChanged(evt) {
  const { pdfViewer } = this;
  // Note that for `<input type="number">` HTML elements, an empty string will
  // be returned for non-number inputs; hence we simply do nothing in that case.
  if (evt.value !== "") {
    this.pdfLinkService.goToPage(evt.value);
  }

  // Ensure that the page number input displays the correct value, even if the
  // value entered by the user was invalid (e.g. a floating point number).
  if (
    evt.value !== pdfViewer.currentPageNumber.toString() &&
    evt.value !== pdfViewer.currentPageLabel
  ) {
    this.toolbar?.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel
    );
  }
}

function onImageAltTextSettings() {
  this.imageAltTextSettings?.open({
    enableGuessAltText: AppOptions.get("enableGuessAltText"),
    enableNewAltTextWhenAddingImage: AppOptions.get(
      "enableNewAltTextWhenAddingImage"
    ),
  });
}

function onFindFromUrlHash(evt) {
  this.eventBus.dispatch("find", {
    source: evt.source,
    type: "",
    query: evt.query,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
    matchDiacritics: true,
  });
}

function onUpdateFindMatchesCount({ matchesCount }) {
  if (this.supportsIntegratedFind) {
    this.externalServices.updateFindMatchesCount(matchesCount);
  } else {
    this.findBar?.updateResultsCount(matchesCount);
  }
}

function onUpdateFindControlState({
  state,
  previous,
  entireWord,
  matchesCount,
  rawQuery,
}) {
  if (this.supportsIntegratedFind) {
    this.externalServices.updateFindControlState({
      result: state,
      findPrevious: previous,
      entireWord,
      matchesCount,
      rawQuery,
    });
  } else {
    this.findBar?.updateUIState(state, previous, matchesCount);
  }
}

function onScaleChanging(evt) {
  this.toolbar?.setPageScale(evt.presetValue, evt.scale);

  this.pdfViewer.update();
}

function onRotationChanging(evt) {
  if (this.pdfThumbnailViewer) {
    this.pdfThumbnailViewer.pagesRotation = evt.pagesRotation;
  }

  this.forceRendering();
  // Ensure that the active page doesn't change during rotation.
  this.pdfViewer.currentPageNumber = evt.pageNumber;
}

function onPageChanging({ pageNumber, pageLabel }) {
  this.toolbar?.setPageNumber(pageNumber, pageLabel);
  this.secondaryToolbar?.setPageNumber(pageNumber);

  if (this.pdfSidebar?.visibleView === SidebarView.THUMBS) {
    this.pdfThumbnailViewer?.scrollThumbnailIntoView(pageNumber);
  }

  // Show/hide the loading indicator in the page number input element.
  const currentPage = this.pdfViewer.getPageView(/* index = */ pageNumber - 1);
  this.toolbar?.updateLoadingIndicatorState(
    currentPage?.renderingState === RenderingStates.RUNNING
  );
}

function onWheel(evt) {
  const {
    pdfViewer,
    supportsMouseWheelZoomCtrlKey,
    supportsMouseWheelZoomMetaKey,
    supportsPinchToZoom,
  } = this;

  if (pdfViewer.isInPresentationMode) {
    return;
  }

  // Pinch-to-zoom on a trackpad maps to a wheel event with ctrlKey set to true
  // https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent#browser_compatibility
  // Hence if ctrlKey is true but ctrl key hasn't been pressed then we can
  // infer that we have a pinch-to-zoom.
  // But the ctrlKey could have been pressed outside of the browser window,
  // hence we try to do some magic to guess if the scaleFactor is likely coming
  // from a pinch-to-zoom or not.

  // It is important that we query deltaMode before delta{X,Y}, so that
  // Firefox doesn't switch to DOM_DELTA_PIXEL mode for compat with other
  // browsers, see https://bugzilla.mozilla.org/show_bug.cgi?id=1392460.
  const deltaMode = evt.deltaMode;

  // The following formula is a bit strange but it comes from:
  // https://searchfox.org/mozilla-central/rev/d62c4c4d5547064487006a1506287da394b64724/widget/InputData.cpp#618-626
  let scaleFactor = Math.exp(-evt.deltaY / 100);

  const isBuiltInMac =
    typeof PDFJSDev !== "undefined" &&
    PDFJSDev.test("MOZCENTRAL") &&
    FeatureTest.platform.isMac;
  const isPinchToZoom =
    evt.ctrlKey &&
    !this._isCtrlKeyDown &&
    deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
    evt.deltaX === 0 &&
    (Math.abs(scaleFactor - 1) < 0.05 || isBuiltInMac) &&
    evt.deltaZ === 0;
  const origin = [evt.clientX, evt.clientY];

  if (
    isPinchToZoom ||
    (evt.ctrlKey && supportsMouseWheelZoomCtrlKey) ||
    (evt.metaKey && supportsMouseWheelZoomMetaKey)
  ) {
    // Only zoom the pages, not the entire viewer.
    evt.preventDefault();
    // NOTE: this check must be placed *after* preventDefault.
    if (
      this._isScrolling ||
      document.visibilityState === "hidden" ||
      this.overlayManager.active
    ) {
      return;
    }

    if (isPinchToZoom && supportsPinchToZoom) {
      scaleFactor = this._accumulateFactor(
        pdfViewer.currentScale,
        scaleFactor,
        "_wheelUnusedFactor"
      );
      this.updateZoom(null, scaleFactor, origin);
    } else {
      const delta = normalizeWheelEventDirection(evt);

      let ticks = 0;
      if (
        deltaMode === WheelEvent.DOM_DELTA_LINE ||
        deltaMode === WheelEvent.DOM_DELTA_PAGE
      ) {
        // For line-based devices, use one tick per event, because different
        // OSs have different defaults for the number lines. But we generally
        // want one "clicky" roll of the wheel (which produces one event) to
        // adjust the zoom by one step.
        //
        // If we're getting fractional lines (I can't think of a scenario
        // this might actually happen), be safe and use the accumulator.
        ticks =
          Math.abs(delta) >= 1
            ? Math.sign(delta)
            : this._accumulateTicks(delta, "_wheelUnusedTicks");
      } else {
        // pixel-based devices
        const PIXELS_PER_LINE_SCALE = 30;
        ticks = this._accumulateTicks(
          delta / PIXELS_PER_LINE_SCALE,
          "_wheelUnusedTicks"
        );
      }

      this.updateZoom(ticks, null, origin);
    }
  }
}

function onTouchStart(evt) {
  if (this.pdfViewer.isInPresentationMode || evt.touches.length < 2) {
    return;
  }
  evt.preventDefault();

  if (evt.touches.length !== 2 || this.overlayManager.active) {
    this._touchInfo = null;
    return;
  }

  let [touch0, touch1] = evt.touches;
  if (touch0.identifier > touch1.identifier) {
    [touch0, touch1] = [touch1, touch0];
  }
  this._touchInfo = {
    touch0X: touch0.pageX,
    touch0Y: touch0.pageY,
    touch1X: touch1.pageX,
    touch1Y: touch1.pageY,
  };
}

function onTouchMove(evt) {
  if (!this._touchInfo || evt.touches.length !== 2) {
    return;
  }

  const { pdfViewer, _touchInfo, supportsPinchToZoom } = this;
  let [touch0, touch1] = evt.touches;
  if (touch0.identifier > touch1.identifier) {
    [touch0, touch1] = [touch1, touch0];
  }
  const { pageX: page0X, pageY: page0Y } = touch0;
  const { pageX: page1X, pageY: page1Y } = touch1;
  const {
    touch0X: pTouch0X,
    touch0Y: pTouch0Y,
    touch1X: pTouch1X,
    touch1Y: pTouch1Y,
  } = _touchInfo;

  if (
    Math.abs(pTouch0X - page0X) <= 1 &&
    Math.abs(pTouch0Y - page0Y) <= 1 &&
    Math.abs(pTouch1X - page1X) <= 1 &&
    Math.abs(pTouch1Y - page1Y) <= 1
  ) {
    // Touches are really too close and it's hard do some basic
    // geometry in order to guess something.
    return;
  }

  _touchInfo.touch0X = page0X;
  _touchInfo.touch0Y = page0Y;
  _touchInfo.touch1X = page1X;
  _touchInfo.touch1Y = page1Y;

  if (pTouch0X === page0X && pTouch0Y === page0Y) {
    // First touch is fixed, if the vectors are collinear then we've a pinch.
    const v1X = pTouch1X - page0X;
    const v1Y = pTouch1Y - page0Y;
    const v2X = page1X - page0X;
    const v2Y = page1Y - page0Y;
    const det = v1X * v2Y - v1Y * v2X;
    // 0.02 is approximatively sin(0.15deg).
    if (Math.abs(det) > 0.02 * Math.hypot(v1X, v1Y) * Math.hypot(v2X, v2Y)) {
      return;
    }
  } else if (pTouch1X === page1X && pTouch1Y === page1Y) {
    // Second touch is fixed, if the vectors are collinear then we've a pinch.
    const v1X = pTouch0X - page1X;
    const v1Y = pTouch0Y - page1Y;
    const v2X = page0X - page1X;
    const v2Y = page0Y - page1Y;
    const det = v1X * v2Y - v1Y * v2X;
    if (Math.abs(det) > 0.02 * Math.hypot(v1X, v1Y) * Math.hypot(v2X, v2Y)) {
      return;
    }
  } else {
    const diff0X = page0X - pTouch0X;
    const diff1X = page1X - pTouch1X;
    const diff0Y = page0Y - pTouch0Y;
    const diff1Y = page1Y - pTouch1Y;
    const dotProduct = diff0X * diff1X + diff0Y * diff1Y;
    if (dotProduct >= 0) {
      // The two touches go in almost the same direction.
      return;
    }
  }

  evt.preventDefault();

  const origin = [(page0X + page1X) / 2, (page0Y + page1Y) / 2];
  const distance = Math.hypot(page0X - page1X, page0Y - page1Y) || 1;
  const pDistance = Math.hypot(pTouch0X - pTouch1X, pTouch0Y - pTouch1Y) || 1;
  if (supportsPinchToZoom) {
    const newScaleFactor = this._accumulateFactor(
      pdfViewer.currentScale,
      distance / pDistance,
      "_touchUnusedFactor"
    );
    this.updateZoom(null, newScaleFactor, origin);
  } else {
    const PIXELS_PER_LINE_SCALE = 30;
    const ticks = this._accumulateTicks(
      (distance - pDistance) / PIXELS_PER_LINE_SCALE,
      "_touchUnusedTicks"
    );
    this.updateZoom(ticks, null, origin);
  }
}

function onTouchEnd(evt) {
  if (!this._touchInfo) {
    return;
  }

  evt.preventDefault();
  this._touchInfo = null;
  this._touchUnusedTicks = 0;
  this._touchUnusedFactor = 1;
}

function onClick(evt) {
  if (!this.secondaryToolbar?.isOpen) {
    return;
  }
  const appConfig = this.appConfig;
  if (
    this.pdfViewer.containsElement(evt.target) ||
    (appConfig.toolbar?.container.contains(evt.target) &&
      // TODO: change the `contains` for an equality check when the bug:
      //  https://bugzilla.mozilla.org/show_bug.cgi?id=1921984
      // is fixed.
      !appConfig.secondaryToolbar?.toggleButton.contains(evt.target))
  ) {
    this.secondaryToolbar.close();
  }
}

function onKeyUp(evt) {
  // evt.ctrlKey is false hence we use evt.key.
  if (evt.key === "Control") {
    this._isCtrlKeyDown = false;
  }
}

function onKeyDown(evt) {
  this._isCtrlKeyDown = evt.key === "Control";

  if (this.overlayManager.active) {
    return;
  }
  const { eventBus, pdfViewer } = this;
  const isViewerInPresentationMode = pdfViewer.isInPresentationMode;

  let handled = false,
    ensureViewerFocused = false;
  const cmd =
    (evt.ctrlKey ? 1 : 0) |
    (evt.altKey ? 2 : 0) |
    (evt.shiftKey ? 4 : 0) |
    (evt.metaKey ? 8 : 0);

  // First, handle the key bindings that are independent whether an input
  // control is selected or not.
  if (cmd === 1 || cmd === 8 || cmd === 5 || cmd === 12) {
    // either CTRL or META key with optional SHIFT.
    switch (evt.keyCode) {
      case 70: // f
        if (!this.supportsIntegratedFind && !evt.shiftKey) {
          this.findBar?.open();
          handled = true;
        }
        break;
      case 71: // g
        if (!this.supportsIntegratedFind) {
          const { state } = this.findController;
          if (state) {
            const newState = {
              source: window,
              type: "again",
              findPrevious: cmd === 5 || cmd === 12,
            };
            eventBus.dispatch("find", { ...state, ...newState });
          }
          handled = true;
        }
        break;
      case 61: // FF/Mac '='
      case 107: // FF '+' and '='
      case 187: // Chrome '+'
      case 171: // FF with German keyboard
        this.zoomIn();
        handled = true;
        break;
      case 173: // FF/Mac '-'
      case 109: // FF '-'
      case 189: // Chrome '-'
        this.zoomOut();
        handled = true;
        break;
      case 48: // '0'
      case 96: // '0' on Numpad of Swedish keyboard
        if (!isViewerInPresentationMode) {
          // keeping it unhandled (to restore page zoom to 100%)
          setTimeout(() => {
            // ... and resetting the scale after browser adjusts its scale
            this.zoomReset();
          });
          handled = false;
        }
        break;

      case 38: // up arrow
        if (isViewerInPresentationMode || this.page > 1) {
          this.page = 1;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 40: // down arrow
        if (isViewerInPresentationMode || this.page < this.pagesCount) {
          this.page = this.pagesCount;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
    }
  }

  if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC || CHROME")) {
    // CTRL or META without shift
    if (cmd === 1 || cmd === 8) {
      switch (evt.keyCode) {
        case 83: // s
          eventBus.dispatch("download", { source: window });
          handled = true;
          break;

        case 79: // o
          if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
            eventBus.dispatch("openfile", { source: window });
            handled = true;
          }
          break;
      }
    }
  }

  // CTRL+ALT or Option+Command
  if (cmd === 3 || cmd === 10) {
    switch (evt.keyCode) {
      case 80: // p
        this.requestPresentationMode();
        handled = true;
        this.externalServices.reportTelemetry({
          type: "buttons",
          data: { id: "presentationModeKeyboard" },
        });
        break;
      case 71: // g
        // focuses input#pageNumber field
        if (this.appConfig.toolbar) {
          this.appConfig.toolbar.pageNumber.select();
          handled = true;
        }
        break;
    }
  }

  if (handled) {
    if (ensureViewerFocused && !isViewerInPresentationMode) {
      pdfViewer.focus();
    }
    evt.preventDefault();
    return;
  }

  // Some shortcuts should not get handled if a control/input element
  // is selected.
  const curElement = getActiveOrFocusedElement();
  const curElementTagName = curElement?.tagName.toUpperCase();
  if (
    curElementTagName === "INPUT" ||
    curElementTagName === "TEXTAREA" ||
    curElementTagName === "SELECT" ||
    (curElementTagName === "BUTTON" &&
      (evt.keyCode === /* Enter = */ 13 || evt.keyCode === /* Space = */ 32)) ||
    curElement?.isContentEditable
  ) {
    // Make sure that the secondary toolbar is closed when Escape is pressed.
    if (evt.keyCode !== /* Esc = */ 27) {
      return;
    }
  }

  // No control key pressed at all.
  if (cmd === 0) {
    let turnPage = 0,
      turnOnlyIfPageFit = false;
    switch (evt.keyCode) {
      case 38: // up arrow
        if (this.supportsCaretBrowsingMode) {
          this.moveCaret(/* isUp = */ true, /* select = */ false);
          handled = true;
          break;
        }
      /* falls through */
      case 33: // pg up
        // vertical scrolling using arrow/pg keys
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
        turnPage = -1;
        break;
      case 8: // backspace
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true;
        }
        turnPage = -1;
        break;
      case 37: // left arrow
        if (this.supportsCaretBrowsingMode) {
          return;
        }
        // horizontal scrolling using arrow keys
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
      /* falls through */
      case 75: // 'k'
      case 80: // 'p'
        turnPage = -1;
        break;
      case 27: // esc key
        if (this.secondaryToolbar?.isOpen) {
          this.secondaryToolbar.close();
          handled = true;
        }
        if (!this.supportsIntegratedFind && this.findBar?.opened) {
          this.findBar.close();
          handled = true;
        }
        break;
      case 40: // down arrow
        if (this.supportsCaretBrowsingMode) {
          this.moveCaret(/* isUp = */ false, /* select = */ false);
          handled = true;
          break;
        }
      /* falls through */
      case 34: // pg down
        // vertical scrolling using arrow/pg keys
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
        turnPage = 1;
        break;
      case 13: // enter key
      case 32: // spacebar
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true;
        }
        turnPage = 1;
        break;
      case 39: // right arrow
        if (this.supportsCaretBrowsingMode) {
          return;
        }
        // horizontal scrolling using arrow keys
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
      /* falls through */
      case 74: // 'j'
      case 78: // 'n'
        turnPage = 1;
        break;

      case 36: // home
        if (isViewerInPresentationMode || this.page > 1) {
          this.page = 1;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 35: // end
        if (isViewerInPresentationMode || this.page < this.pagesCount) {
          this.page = this.pagesCount;
          handled = true;
          ensureViewerFocused = true;
        }
        break;

      case 83: // 's'
        this.pdfCursorTools?.switchTool(CursorTool.SELECT);
        break;
      case 72: // 'h'
        this.pdfCursorTools?.switchTool(CursorTool.HAND);
        break;

      case 82: // 'r'
        this.rotatePages(90);
        break;

      case 115: // F4
        this.pdfSidebar?.toggle();
        break;
    }

    if (
      turnPage !== 0 &&
      (!turnOnlyIfPageFit || pdfViewer.currentScaleValue === "page-fit")
    ) {
      if (turnPage > 0) {
        pdfViewer.nextPage();
      } else {
        pdfViewer.previousPage();
      }
      handled = true;
    }
  }

  // shift-key
  if (cmd === 4) {
    switch (evt.keyCode) {
      case 13: // enter key
      case 32: // spacebar
        if (
          !isViewerInPresentationMode &&
          pdfViewer.currentScaleValue !== "page-fit"
        ) {
          break;
        }
        pdfViewer.previousPage();

        handled = true;
        break;

      case 38: // up arrow
        this.moveCaret(/* isUp = */ true, /* select = */ true);
        handled = true;
        break;
      case 40: // down arrow
        this.moveCaret(/* isUp = */ false, /* select = */ true);
        handled = true;
        break;
      case 82: // 'r'
        this.rotatePages(-90);
        break;
    }
  }

  if (!handled && !isViewerInPresentationMode) {
    // 33=Page Up  34=Page Down  35=End    36=Home
    // 37=Left     38=Up         39=Right  40=Down
    // 32=Spacebar
    if (
      (evt.keyCode >= 33 && evt.keyCode <= 40) ||
      (evt.keyCode === 32 && curElementTagName !== "BUTTON")
    ) {
      ensureViewerFocused = true;
    }
  }

  if (ensureViewerFocused && !pdfViewer.containsElement(curElement)) {
    // The page container is not focused, but a page navigation key has been
    // pressed. Change the focus to the viewer container to make sure that
    // navigation by keyboard works as expected.
    pdfViewer.focus();
  }

  if (handled) {
    evt.preventDefault();
  }
}

function beforeUnload(evt) {
  evt.preventDefault();
  evt.returnValue = "";
  return false;
}

export { PDFViewerApplication, ViewType, EditorState };
