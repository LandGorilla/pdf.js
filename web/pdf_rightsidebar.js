export class PDFRightSidebar {
    constructor(options) {
      this.outerContainer = options.outerContainer;
      this.rightSidebarContainer = options.rightSidebarContainer;
      this.rightSidebarResizer = options.rightSidebarResizer;
  
      this.isResizingRight = false;
      this.lastDownXRight = 0;
  
      this._bindEvents();
    }
  
    _bindEvents() {
      this.rightSidebarResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.isResizingRight = true;
        this.lastDownXRight = e.clientX;
        this.outerContainer.classList.add('sidebarResizingRight');
      }, true);
  
      document.addEventListener('mousemove', (e) => {
        if (!this.isResizingRight) return;
  
        const deltaX = this.lastDownXRight - e.clientX;
        this.lastDownXRight = e.clientX;
  
        const currentWidth = parseFloat(
          window.getComputedStyle(this.rightSidebarContainer).width
        );
        const newWidth = currentWidth + deltaX;
  
        // Adjust minimum/maximum width as desired
        if (newWidth > 100 && newWidth < 600) {
          this.rightSidebarContainer.style.width = newWidth + 'px';
          this.outerContainer.style.setProperty('--right-sidebar-width', newWidth + 'px');
        }
      }, true);
  
      document.addEventListener('mouseup', () => {
        if (!this.isResizingRight) return;
        this.isResizingRight = false;
        this.outerContainer.classList.remove('sidebarResizingRight');
      }, true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const outerContainer = document.getElementById('outerContainer');
    const rightSidebarContainer = document.getElementById('rightSidebarContainer');
    const rightSidebarResizer = document.getElementById('rightSidebarResizer');
  
    const pdfRightSidebar = new PDFRightSidebar({
      outerContainer,
      rightSidebarContainer,
      rightSidebarResizer
    });
  });

// class PDFRightSidebar {
//     /**
//      * @param {Object} options
//      * @param {HTMLElement} options.outerContainer - The main outer container of the viewer.
//      * @param {HTMLElement} options.rightSidebarContainer - The container element for the right sidebar.
//      * @param {HTMLElement} options.toggleButton - The button to toggle the right sidebar.
//      */
//     constructor({ outerContainer, rightSidebarContainer, toggleButton }) {
//         this.outerContainer = outerContainer;
//         this.rightSidebarContainer = rightSidebarContainer;
//         this.toggleButton = toggleButton;
//         this.isOpen = false;

//         this._addEventListeners();
//     }

//     open() {
//         if (this.isOpen) {
//             return;
//         }
//         this.isOpen = true;
//         this.outerContainer.classList.add("rightSidebarOpen");
//     }

//     close() {
//         if (!this.isOpen) {
//             return;
//         }
//         this.isOpen = false;
//         this.outerContainer.classList.remove("rightSidebarOpen");
//     }

//     toggle() {
//         if (this.isOpen) {
//             this.close();
//         } else {
//             this.open();
//         }
//     }

//     _addEventListeners() {
//         this.toggleButton.addEventListener("click", () => {
//             this.toggle();
//         });
//     }
// }

// // Example usage:
// document.addEventListener("DOMContentLoaded", () => {
//     const outerContainer = document.getElementById("outerContainer");
//     const rightSidebarContainer = document.getElementById("rightSidebarContainer");
//     const toggleButton = document.getElementById("rightSidebarToggleButton");

//     const rightSidebar = new PDFRightSidebar({
//         outerContainer,
//         rightSidebarContainer,
//         toggleButton
//     });
// });